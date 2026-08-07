// webview/view.ts
// Ghép toàn bộ pipeline hiển thị. Dùng chung bởi webview thật (`main.ts`) và dev harness
// (`dev/main.ts`) - nhờ vậy debug layout không phải khởi động lại Extension Development Host.
//
// Pipeline (mỗi khâu là hàm thuần, test riêng):
//   FlowGraph -> toDisplayGraph -> [fanoutFinallyRegions?] -> markBackEdges
//             -> applyCollapse -> toElkGraph -> ELK -> SVG
//
// HIỆU NĂNG - ba đường vẽ khác nhau, đừng gộp lại:
//   1. đổi graph / collapse / cỡ node / cỡ chữ -> chạy ELK rồi dựng lại SVG  (đắt)
//   2. đổi node đang chọn                      -> đổi class TẠI CHỖ          (rẻ)
//   3. đổi độ dày cạnh / bảng màu              -> đổi CSS variable           (gần như free)
// Trước đây mọi thứ đi đường 1: bấm chọn một node trên hàm 714 node = chạy lại ELK 6.4 giây.

import type {
  CalleeLink,
  FunctionTraceInfo,
  GitNodeChange,
  GraphNavigation,
} from "../shared/protocol";
import type { FlowGraph } from "../shared/types";
import { collectFilterCandidates, type FilterCandidate } from "../filter/candidates";
import { filterGraph, filterStats } from "../filter/filterGraph";
import {
  runGuidedTrace,
  type GuidedTraceResult,
  type TraceDecision,
  type TraceScalar,
} from "../filter/guidedTrace";
import {
  collectQueryMockCandidates,
  isQueryMockKey,
} from "../filter/queryMocks";
import { DEFAULT_DETAIL_WIDTH, detailWidthFromPointer } from "./detail-pane";
import { messagesFor } from "./i18n";
import type { Layout } from "./layout/run-elk";
import { runLayout } from "./layout/run-elk";
import { markBackEdges } from "./model/back-edges";
import { RENDER_GUARD, USER_THRESHOLD, initialCollapsedIds } from "./model/auto-collapse";
import { applyCollapse } from "./model/collapse";
import type { DisplayGraph } from "./model/display-graph";
import { sourceNodeCount, toDisplayGraph } from "./model/display-graph";
import {
  appliedConstraintValue,
  filterInputValue,
  reconcileSameGraphState,
} from "./model/filter-state";
import { FANOUT_ENABLED, fanoutFinallyRegions } from "./model/finally-fanout";
import { renderDetail } from "./render/detail";
import { attachInteractions, type InteractHandles } from "./render/interact";
import { renderGraph } from "./render/svg";
import type { DisplaySettings, Locale, Palette } from "./settings";
import { LIMITS, affectsLayout, clampSettings, defaultSettings } from "./settings";
import type { ViewState } from "./state";
import { graphKeyOf, initialState, undoTraceAction } from "./state";

export interface ViewOptions {
  /** Người dùng muốn nhảy tới node trong editor gốc. Nhận `sourceId`. */
  onReveal: (sourceId: string) => void;
  onOpenCallee: (targetId: string) => void;
  onNavigateBack: () => void;
  /** Trạng thái đổi - bên gọi đem đi `setState`. */
  onStateChange: (state: ViewState) => void;
  /** Trạng thái phục hồi từ `getState`, nếu có. */
  restored?: ViewState;
}

export interface GraphContext {
  callees?: readonly CalleeLink[];
  navigation?: GraphNavigation;
  gitChanges?: readonly GitNodeChange[];
  trace?: FunctionTraceInfo;
}

export interface View {
  setGraph: (graph: FlowGraph, context?: GraphContext) => void;
  showError: (message: string) => void;
}

interface FilterControl {
  candidate: FilterCandidate;
  mockedCondition: boolean;
  enabled: HTMLInputElement;
  variableLabel: HTMLElement;
  value: HTMLInputElement;
  suggestionToggle: HTMLButtonElement | undefined;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function button(label: string, className = ""): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (className !== "") element.className = className;
  return element;
}

function selectOption(select: HTMLSelectElement, value: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  select.append(option);
  return option;
}

function parseTraceScalar(raw: string): TraceScalar {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || ["string", "number", "boolean"].includes(typeof parsed)) {
      return parsed as TraceScalar;
    }
  } catch {
    // Text thường như RECEIVED được xem là string; JSON object/array bị từ chối ở dưới.
  }
  return trimmed;
}

/** Một hàng slider trong bảng tuỳ chỉnh. */
function slider(
  label: string,
  limits: { min: number; max: number; step: number },
  value: number,
  onInput: (next: number) => void,
): { row: HTMLElement; name: HTMLElement; input: HTMLInputElement; readout: HTMLElement } {
  const row = document.createElement("label");
  row.className = "cf-setting";
  const name = document.createElement("span");
  name.className = "cf-setting-name";
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(limits.min);
  input.max = String(limits.max);
  input.step = String(limits.step);
  input.value = String(value);
  const readout = document.createElement("span");
  readout.className = "cf-setting-value";
  readout.textContent = String(value);
  input.addEventListener("input", () => {
    const next = Number(input.value);
    readout.textContent = String(next);
    onInput(next);
  });
  row.append(name, input, readout);
  return { row, name, input, readout };
}

export function createView(root: HTMLElement, options: ViewOptions): View {
  root.replaceChildren();
  root.classList.add("cf-root");
  const runtimeStyle = document.getElementById("cf-runtime-settings");
  if (!(runtimeStyle instanceof HTMLStyleElement)) {
    throw new Error("thiếu #cf-runtime-settings để áp dụng settings dưới CSP nghiêm");
  }
  let messages = messagesFor(options.restored?.settings.locale ?? defaultSettings().locale);

  const toolbar = document.createElement("header");
  toolbar.className = "cf-toolbar";
  const navigation = document.createElement("nav");
  navigation.className = "cf-navigation";
  const backButton = button("←", "cf-back");
  backButton.hidden = true;
  backButton.title = messages.back;
  backButton.setAttribute("aria-label", messages.back);
  backButton.addEventListener("click", options.onNavigateBack);
  const breadcrumbs = document.createElement("span");
  breadcrumbs.className = "cf-breadcrumbs";
  navigation.append(breadcrumbs);
  const heading = document.createElement("span");
  heading.className = "cf-title";
  heading.textContent = "CodeFlow";
  const stats = document.createElement("span");
  stats.className = "cf-stats";
  stats.textContent = "";
  const expandButton = button("⊞");
  expandButton.title = messages.expandAll;
  expandButton.setAttribute("aria-label", messages.expandAll);
  const collapseButton = button("⊟");
  collapseButton.title = messages.collapseDefault;
  collapseButton.setAttribute("aria-label", messages.collapseDefault);
  const resetButton = button("⟳");
  resetButton.title = messages.resetView;
  resetButton.setAttribute("aria-label", messages.resetView);

  const filterReadout = document.createElement("span");
  filterReadout.className = "cf-filter-readout";
  filterReadout.hidden = true;
  const gitLegend = document.createElement("span");
  gitLegend.className = "cf-git-legend";
  gitLegend.title = "Git diff vs HEAD";
  gitLegend.hidden = true;
  const traceToggle = button("▶", "cf-trace-toggle");
  traceToggle.title = messages.trace.open;
  traceToggle.setAttribute("aria-label", messages.trace.open);
  const filterBox = document.createElement("details");
  filterBox.className = "cf-filter";
  const filterSummary = document.createElement("summary");
  filterSummary.title = messages.filterTitle;
  filterSummary.setAttribute("aria-label", messages.filterTitle);
  const filterIcon = document.createElement("span");
  filterIcon.className = "cf-filter-icon";
  filterIcon.setAttribute("aria-hidden", "true");
  filterSummary.append(filterIcon);
  const filterBody = document.createElement("div");
  filterBody.className = "cf-filter-body";
  const filterHeading = document.createElement("strong");
  filterHeading.textContent = messages.filterHeading;
  const filterHelp = document.createElement("p");
  filterHelp.className = "cf-filter-help";
  filterHelp.textContent = messages.filterHelp;
  const mockQueryToggle = document.createElement("label");
  mockQueryToggle.className = "cf-filter-mock-toggle";
  const mockQueryCheckbox = document.createElement("input");
  mockQueryCheckbox.type = "checkbox";
  mockQueryCheckbox.setAttribute("role", "switch");
  const mockQueryText = document.createElement("span");
  const mockQueryLabel = document.createElement("strong");
  mockQueryLabel.textContent = messages.mockQueryLabel;
  const mockQueryHelp = document.createElement("small");
  mockQueryHelp.textContent = messages.mockQueryHelp;
  mockQueryText.append(mockQueryLabel, mockQueryHelp);
  mockQueryToggle.append(mockQueryCheckbox, mockQueryText);
  const filterRows = document.createElement("div");
  filterRows.className = "cf-filter-rows";
  const filterActions = document.createElement("div");
  filterActions.className = "cf-filter-actions";
  const clearFilterButton = button(messages.clear);
  const applyFilterButton = button(messages.applyFilter);
  filterActions.append(clearFilterButton, applyFilterButton);
  filterBody.append(filterHeading, filterHelp, mockQueryToggle, filterRows, filterActions);
  filterBox.append(filterSummary, filterBody);

  const settingsBox = document.createElement("details");
  settingsBox.className = "cf-settings";
  const settingsSummary = document.createElement("summary");
  settingsSummary.textContent = "⚙";
  const settingsBody = document.createElement("div");
  settingsSummary.title = messages.settingsTitle;
  settingsSummary.setAttribute("aria-label", messages.settingsTitle);
  settingsBody.className = "cf-settings-body";
  settingsBox.append(settingsSummary, settingsBody);

  toolbar.append(
    backButton,
    heading,
    stats,
    filterReadout,
    gitLegend,
    traceToggle,
    filterBox,
    settingsBox,
    expandButton,
    collapseButton,
    resetButton,
  );

  const tracePanel = document.createElement("section");
  tracePanel.className = "cf-trace-panel";
  tracePanel.hidden = true;
  const traceHeader = document.createElement("div");
  traceHeader.className = "cf-trace-header";
  const traceHeading = document.createElement("strong");
  traceHeading.textContent = messages.trace.title;
  const traceClose = button("×", "cf-trace-close");
  traceClose.title = messages.trace.stop;
  traceHeader.append(traceHeading, traceClose);
  const traceHelp = document.createElement("p");
  traceHelp.className = "cf-trace-help";
  traceHelp.textContent = messages.trace.help;
  const traceInputLabel = document.createElement("label");
  traceInputLabel.className = "cf-trace-input-label";
  const traceInputName = document.createElement("span");
  traceInputName.textContent = messages.trace.inputLabel;
  const traceInput = document.createElement("textarea");
  traceInput.rows = 7;
  traceInput.spellcheck = false;
  traceInputLabel.append(traceInputName, traceInput);
  const traceActions = document.createElement("div");
  traceActions.className = "cf-trace-actions";
  const traceStart = button(messages.trace.start, "cf-primary");
  const traceBack = button(`← ${messages.trace.backStep}`);
  const traceReset = button(messages.trace.reset);
  const traceStop = button(messages.trace.stop);
  traceActions.append(traceStart, traceBack, traceReset, traceStop);
  const traceError = document.createElement("p");
  traceError.className = "cf-trace-error";
  traceError.hidden = true;
  const traceResult = document.createElement("div");
  traceResult.className = "cf-trace-result";
  tracePanel.append(
    traceHeader,
    traceHelp,
    traceInputLabel,
    traceActions,
    traceError,
    traceResult,
  );

  const warnings = document.createElement("details");
  warnings.className = "cf-warnings";
  warnings.hidden = true;

  const body = document.createElement("div");
  body.className = "cf-body";
  const canvas = document.createElementNS(SVG_NS, "svg");
  canvas.setAttribute("class", "cf-canvas");
  const surface = document.createElementNS(SVG_NS, "g");
  canvas.append(surface);
  const detailResizer = document.createElement("div");
  detailResizer.className = "cf-detail-resizer";
  detailResizer.setAttribute("role", "separator");
  detailResizer.setAttribute("aria-orientation", "vertical");
  detailResizer.setAttribute("aria-label", messages.detailResize);
  detailResizer.tabIndex = 0;
  detailResizer.hidden = true;
  const detail = document.createElement("aside");
  detail.className = "cf-detail";
  detail.hidden = true;
  body.append(canvas, detailResizer, detail);

  root.append(toolbar, tracePanel, warnings, body, navigation);

  let state: ViewState = options.restored ?? initialState();
  /** Graph sau fanout + back edge, TRƯỚC collapse. Nguồn để collapse lại. */
  let base: DisplayGraph | undefined;
  let interactions: InteractHandles | undefined;
  /** Tăng mỗi lần chạy layout; kết quả ELK về muộn hơn lượt hiện tại thì bỏ. */
  let generation = 0;
  /** Layout đã tính + khoá mô tả nó được tính từ đâu, để không chạy ELK lại vô ích. */
  let cachedLayout: Layout | undefined;
  let cachedKey = "";
  let detailWidth = DEFAULT_DETAIL_WIDTH;
  let calleeLinks: readonly CalleeLink[] = [];
  let sourceGraph: FlowGraph | undefined;
  let sourceContext: GraphContext | undefined;
  let gitChanges = new Map<string, GitNodeChange>();
  let filterControls: FilterControl[] = [];
  let openSuggestionControl: HTMLElement | undefined;
  let closeOpenSuggestions: (() => void) | undefined;
  let renderSourceGraph: (() => void) | undefined;
  let traceGraphKey = "";
  let traceCanNavigateBack = false;

  mockQueryCheckbox.checked = state.mockQueryEnabled;

  const persist = (): void => options.onStateChange(state);

  traceInput.value = state.trace.input;
  tracePanel.hidden = !state.trace.active;

  const paintGitLegend = (): void => {
    const changes = [...gitChanges.values()];
    const counts = {
      added: changes.filter((change) => change.addedLines > 0).length,
      modified: changes.filter((change) => change.modifiedLines > 0).length,
      deleted: changes.filter((change) => change.deletedLines > 0).length,
    };
    gitLegend.replaceChildren();
    for (const [kind, symbol] of [
      ["added", "+"],
      ["modified", "~"],
      ["deleted", "−"],
    ] as const) {
      if (counts[kind] === 0) continue;
      const item = document.createElement("span");
      item.className = `cf-git-legend-${kind}`;
      item.textContent = `${symbol}${counts[kind]}`;
      gitLegend.append(item);
    }
    gitLegend.hidden = gitLegend.childElementCount === 0;
  };

  // Hai popover cùng neo ở góc phải toolbar nên tuyệt đối không được mở chồng nhau.
  // Dùng `toggle` thay vì chỉ bắt click trên summary để cả thay đổi bằng bàn phím cũng nhất quán.
  filterBox.addEventListener("toggle", () => {
    if (filterBox.open) settingsBox.open = false;
    else closeOpenSuggestions?.();
  });
  settingsBox.addEventListener("toggle", () => {
    if (!settingsBox.open) return;
    filterBox.open = false;
    closeOpenSuggestions?.();
  });

  root.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (
      openSuggestionControl !== undefined &&
      target instanceof Node &&
      !openSuggestionControl.contains(target)
    ) {
      closeOpenSuggestions?.();
    }
  });

  /** Mọi thứ ẢNH HƯỞNG layout. Selection và màu sắc cố tình KHÔNG có trong này. */
  const layoutKeyOf = (settings: DisplaySettings): string =>
    [
      state.graphKey ?? "",
      [...state.collapsedIds].sort().join(","),
      settings.nodeScale,
      settings.fontSize,
    ].join("|");

  /** Đường 3: chỉ CSS variable, không vẽ lại gì. */
  const applyCssSettings = (): void => {
    // Stylesheet này mang nonce trong extension host. Sửa textContent không tạo style
    // attribute, nên vẫn tuân CSP không `unsafe-inline`.
    runtimeStyle.textContent =
      `.cf-root { --cf-edge-width: ${state.settings.edgeWidth}; ` +
      `--cf-text-node: ${state.settings.fontSize}px; ` +
      `--cf-detail-width: ${detailWidth}px; }`;
    root.dataset["cfPalette"] = state.settings.palette;
  };

  const fitCachedLayout = (): void => {
    const layout = cachedLayout;
    if (layout === undefined) return;
    requestAnimationFrame(() => interactions?.fit(layout.width, layout.height));
  };

  const closeDetail = (): void => {
    if (state.selectedSourceId === undefined) return;
    state = { ...state, selectedSourceId: undefined };
    persist();
    applySelection();
  };

  const paintDetail = (refitWhenVisibilityChanges: boolean): void => {
    const visible =
      base !== undefined &&
      state.selectedSourceId !== undefined &&
      base.nodes.some((node) => node.sourceId === state.selectedSourceId);
    const visibilityChanged = detail.hidden === visible;
    detail.hidden = !visible;
    detailResizer.hidden = !visible;
    if (visible && base !== undefined) {
      renderDetail(detail, base, state.selectedSourceId, {
        onJump: options.onReveal,
        onClose: closeDetail,
        callees: calleeLinks,
        onOpenCallee: options.onOpenCallee,
        locale: state.settings.locale,
        gitChange:
          state.selectedSourceId === undefined
            ? undefined
            : gitChanges.get(state.selectedSourceId),
      });
    } else {
      detail.replaceChildren();
    }
    if (visibilityChanged && refitWhenVisibilityChanges) fitCachedLayout();
  };

  /** Đường 2: đổi highlight tại chỗ. Không chạy ELK, không dựng lại DOM. */
  const applySelection = (): void => {
    const selected = state.selectedSourceId;
    const selectedDisplayIds = new Set(
      selected === undefined
        ? []
        : (base?.nodes ?? []).filter((n) => n.sourceId === selected).map((n) => n.id),
    );
    // `Array.from` chứ không duyệt trực tiếp NodeList: tsconfig chỉ bật lib DOM, không
    // DOM.Iterable - và bật thêm lib chỉ để có vòng for thì không đáng.
    for (const node of Array.from(surface.querySelectorAll<SVGGElement>(".cf-node"))) {
      node.classList.toggle("cf-selected", node.dataset["sourceId"] === selected);
    }
    for (const edge of Array.from(surface.querySelectorAll<SVGPolylineElement>(".cf-edge"))) {
      const from = edge.getAttribute("data-from") ?? "";
      const to = edge.getAttribute("data-to") ?? "";
      edge.classList.toggle(
        "cf-edge-active",
        selectedDisplayIds.has(from) || selectedDisplayIds.has(to),
      );
    }
    paintDetail(true);
  };

  /** Đường 1: chạy ELK (nếu cần) rồi dựng lại SVG. */
  const renderGraphView = (fit: boolean): void => {
    if (base === undefined) return;
    const current = ++generation;
    const view = applyCollapse(base, state.collapsedIds);
    const key = layoutKeyOf(state.settings);

    const visible = view.graph.nodes.length;
    stats.textContent = messages.stats(
      sourceNodeCount(base),
      base.edges.length,
      visible,
      base.nodes.length,
      visible > RENDER_GUARD,
    );

    paintDetail(false);

    const paint = (layout: Layout): void => {
      if (current !== generation) return; // Lượt cũ về muộn - bỏ, không vẽ đè lượt mới.
      cachedLayout = layout;
      cachedKey = key;
      renderGraph(surface, view.graph, layout, {
        hiddenCounts: view.hiddenCounts,
        selectedSourceId: state.selectedSourceId,
        settings: state.settings,
        gitChanges,
        onSelect: (sourceId) => {
          if (state.selectedSourceId === sourceId) return;
          state = { ...state, selectedSourceId: sourceId };
          persist();
          applySelection(); // <- đường 2, KHÔNG phải đường 1
        },
        onToggleCollapse: (sourceId) => {
          const next = new Set(state.collapsedIds);
          if (next.has(sourceId)) next.delete(sourceId);
          else next.add(sourceId);
          state = { ...state, collapsedIds: next };
          persist();
          renderGraphView(false); // collapse đổi tập node -> buộc phải layout lại
        },
      });
      applyCssSettings();
      if (fit) interactions?.fit(layout.width, layout.height);
    };

    if (cachedLayout !== undefined && cachedKey === key) {
      paint(cachedLayout); // Layout không đổi -> dùng lại, chỉ dựng lại DOM.
      return;
    }
    canvas.classList.add("cf-busy");
    // Hoãn một frame TRƯỚC khi gọi ELK: `elk.bundled.js` tính trên main thread (worker nhúng
    // chạy đồng bộ), nên nếu gọi ngay thì nó block trước khi trạng thái "đang dựng" được vẽ
    // và người dùng thấy y như treo. Đo được: 0.65s (642 node) đến 5.9s (1050 node).
    requestAnimationFrame(() => {
      void runLayout(view.graph, state.settings).then(
        (layout) => {
          canvas.classList.remove("cf-busy");
          paint(layout);
        },
        (error: unknown) => {
          canvas.classList.remove("cf-busy");
          stats.textContent = messages.layoutFailed(String(error));
        },
      );
    });
  };

  // ---- filter theo condition.parsed ----

  const populateFilterControls = (graph: FlowGraph): void => {
    closeOpenSuggestions?.();
    filterRows.replaceChildren();
    filterControls = [];
    const regularCandidates = collectFilterCandidates(graph).map((candidate) => ({
      candidate,
      mockedCondition: false,
      displayLabel: candidate.variable,
      title: messages.candidateConfidence(candidate.certainNodes, candidate.unknownNodes),
    }));
    const queryCandidates = state.mockQueryEnabled
      ? collectQueryMockCandidates(graph).map((mock) => ({
          candidate: {
            variable: mock.key,
            values: ["false", "true"],
            certainNodes: 1,
            unknownNodes: 0,
          },
          mockedCondition: true,
          displayLabel: mock.label,
          title: messages.mockConditionAtLine(mock.line),
        }))
      : [];
    const candidates = [...regularCandidates, ...queryCandidates];
    if (candidates.length === 0) {
      const empty = document.createElement("p");
      empty.className = "cf-filter-empty";
      empty.textContent = messages.filterEmpty;
      filterRows.append(empty);
      applyFilterButton.disabled = true;
      clearFilterButton.disabled = Object.keys(state.constraints).length === 0;
      return;
    }

    applyFilterButton.disabled = false;
    clearFilterButton.disabled = Object.keys(state.constraints).length === 0;
    let mockSectionAdded = false;
    candidates.forEach(({ candidate, mockedCondition, displayLabel, title }) => {
      if (mockedCondition && !mockSectionAdded) {
        const section = document.createElement("strong");
        section.className = "cf-filter-section";
        section.textContent = messages.mockQueryLabel;
        filterRows.append(section);
        mockSectionAdded = true;
      }
      const row = document.createElement("label");
      row.className = mockedCondition ? "cf-filter-row cf-filter-row-mock" : "cf-filter-row";
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      const active = Object.prototype.hasOwnProperty.call(state.constraints, candidate.variable);
      enabled.checked = active;
      enabled.setAttribute("aria-label", messages.enableConstraint(candidate.variable));

      const variable = document.createElement("code");
      variable.textContent = displayLabel;
      variable.title = title;

      const value = document.createElement("input");
      value.type = "text";
      value.value = filterInputValue(
        state.constraints,
        candidate.variable,
        candidate.values[0] ?? "",
      );
      value.disabled = !active;
      value.placeholder = messages.filterPlaceholder(candidate.values.length);
      value.setAttribute("aria-label", messages.valueFor(candidate.variable));

      const valueControl = document.createElement("span");
      valueControl.className = "cf-filter-value-control";
      valueControl.append(value);
      let suggestionToggle: HTMLButtonElement | undefined;

      if (candidate.values.length > 0) {
        // Native datalist lọc option theo text đang có. Combobox custom giữ nguyên text hiện tại
        // nhưng mỗi lần mở vẫn hiển thị TOÀN BỘ giá trị mà analyzer tìm được.
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "cf-filter-suggestion-toggle";
        toggle.disabled = !active;
        toggle.textContent = "▾";
        toggle.setAttribute("aria-label", messages.openSuggestions(candidate.variable));
        toggle.setAttribute("aria-expanded", "false");
        suggestionToggle = toggle;

        const suggestions = document.createElement("span");
        suggestions.className = "cf-filter-suggestions";
        suggestions.setAttribute("role", "listbox");
        suggestions.hidden = true;
        for (const candidateValue of candidate.values) {
          const option = document.createElement("button");
          option.type = "button";
          option.className = "cf-filter-suggestion";
          option.setAttribute("role", "option");
          option.textContent = candidateValue;
          option.addEventListener("click", () => {
            value.value = candidateValue;
            closeOpenSuggestions?.();
            value.focus();
          });
          suggestions.append(option);
        }

        const openSuggestions = (): void => {
          if (value.disabled) return;
          closeOpenSuggestions?.();
          suggestions.hidden = false;
          toggle.setAttribute("aria-expanded", "true");
          openSuggestionControl = valueControl;
          closeOpenSuggestions = () => {
            suggestions.hidden = true;
            toggle.setAttribute("aria-expanded", "false");
            if (openSuggestionControl === valueControl) openSuggestionControl = undefined;
            closeOpenSuggestions = undefined;
          };
        };
        value.addEventListener("click", openSuggestions);
        value.addEventListener("keydown", (event) => {
          if (event.key === "ArrowDown") {
            openSuggestions();
            event.preventDefault();
          } else if (event.key === "Escape") {
            closeOpenSuggestions?.();
          }
        });
        toggle.addEventListener("click", () => {
          if (suggestions.hidden) openSuggestions();
          else closeOpenSuggestions?.();
        });
        valueControl.append(toggle, suggestions);
        enabled.addEventListener("change", () => {
          toggle.disabled = !enabled.checked;
          if (!enabled.checked) closeOpenSuggestions?.();
        });
      }
      row.append(enabled, variable, valueControl);

      enabled.addEventListener("change", () => {
        value.disabled = !enabled.checked;
        if (enabled.checked) value.focus();
      });
      value.addEventListener("input", () => {
        if (!enabled.checked) {
          enabled.checked = true;
          value.disabled = false;
        }
      });
      filterControls.push({
        candidate,
        mockedCondition,
        enabled,
        variableLabel: variable,
        value,
        suggestionToggle,
      });
      filterRows.append(row);
    });
  };

  mockQueryCheckbox.addEventListener("change", () => {
    const enabled = mockQueryCheckbox.checked;
    const constraints = enabled
      ? state.constraints
      : Object.fromEntries(
          Object.entries(state.constraints).filter(([key]) => !isQueryMockKey(key)),
        );
    state = { ...state, mockQueryEnabled: enabled, constraints };
    persist();
    if (sourceGraph !== undefined) populateFilterControls(sourceGraph);
    if (!enabled) renderSourceGraph?.();
  });

  applyFilterButton.addEventListener("click", () => {
    const constraints: Record<string, string> = {};
    for (const control of filterControls) {
      const value = appliedConstraintValue(control.enabled.checked, control.value.value);
      if (value !== undefined) {
        constraints[control.candidate.variable] = value;
      }
    }
    state = { ...state, constraints };
    persist();
    filterBox.open = false;
    renderSourceGraph?.();
  });

  clearFilterButton.addEventListener("click", () => {
    state = { ...state, constraints: {} };
    persist();
    filterBox.open = false;
    renderSourceGraph?.();
  });

  // ---- bảng tuỳ chỉnh hiển thị ----

  const applySettings = (next: Partial<DisplaySettings>): void => {
    const merged = clampSettings({ ...state.settings, ...next });
    const needsLayout = affectsLayout(state.settings, merged);
    state = { ...state, settings: merged };
    persist();
    if (needsLayout) renderGraphView(false);
    else applyCssSettings();
  };

  const nodeScaleRow = slider(
    messages.nodeScale,
    LIMITS.nodeScale,
    state.settings.nodeScale,
    (value) => applySettings({ nodeScale: value }),
  );
  const fontRow = slider(messages.fontSize, LIMITS.fontSize, state.settings.fontSize, (value) =>
    applySettings({ fontSize: value }),
  );
  const edgeRow = slider(messages.edgeWidth, LIMITS.edgeWidth, state.settings.edgeWidth, (value) =>
    applySettings({ edgeWidth: value }),
  );

  const paletteRow = document.createElement("label");
  paletteRow.className = "cf-setting";
  const paletteName = document.createElement("span");
  paletteName.className = "cf-setting-name";
  paletteName.textContent = messages.palette;
  const paletteSelect = document.createElement("select");
  const paletteOptions: Record<Palette, HTMLOptionElement> = {
    default: selectOption(paletteSelect, "default"),
    soft: selectOption(paletteSelect, "soft"),
    contrast: selectOption(paletteSelect, "contrast"),
  };
  paletteSelect.value = state.settings.palette;
  paletteSelect.addEventListener("change", () => {
    applySettings({ palette: clampSettings({ palette: paletteSelect.value as Palette }).palette });
  });
  paletteRow.append(paletteName, paletteSelect);

  const languageRow = document.createElement("label");
  languageRow.className = "cf-setting";
  const languageName = document.createElement("span");
  languageName.className = "cf-setting-name";
  languageName.textContent = messages.language;
  const languageSelect = document.createElement("select");
  const localeOptions: Record<Locale, HTMLOptionElement> = {
    vi: selectOption(languageSelect, "vi"),
    en: selectOption(languageSelect, "en"),
  };
  languageSelect.value = state.settings.locale;
  languageRow.append(languageName, languageSelect);

  const resetSettings = button(messages.resetSettings, "cf-setting-reset");
  resetSettings.addEventListener("click", () => {
    const base = defaultSettings();
    nodeScaleRow.input.value = String(base.nodeScale);
    nodeScaleRow.readout.textContent = String(base.nodeScale);
    fontRow.input.value = String(base.fontSize);
    fontRow.readout.textContent = String(base.fontSize);
    edgeRow.input.value = String(base.edgeWidth);
    edgeRow.readout.textContent = String(base.edgeWidth);
    paletteSelect.value = base.palette;
    languageSelect.value = base.locale;
    applySettings(base);
    applyUiLanguage();
  });

  settingsBody.append(
    nodeScaleRow.row,
    fontRow.row,
    edgeRow.row,
    paletteRow,
    languageRow,
    resetSettings,
  );

  const applyUiLanguage = (): void => {
    messages = messagesFor(state.settings.locale);
    document.documentElement.lang = state.settings.locale;

    backButton.title = messages.back;
    backButton.setAttribute("aria-label", messages.back);
    expandButton.title = messages.expandAll;
    expandButton.setAttribute("aria-label", messages.expandAll);
    collapseButton.title = messages.collapseDefault;
    collapseButton.setAttribute("aria-label", messages.collapseDefault);
    resetButton.title = messages.resetView;
    resetButton.setAttribute("aria-label", messages.resetView);
    traceToggle.title = messages.trace.open;
    traceToggle.setAttribute("aria-label", messages.trace.open);
    traceHeading.textContent = messages.trace.title;
    traceClose.title = messages.trace.stop;
    traceHelp.textContent = messages.trace.help;
    traceInputName.textContent = messages.trace.inputLabel;
    traceStart.textContent = messages.trace.start;
    traceBack.textContent = `← ${messages.trace.backStep}`;
    traceReset.textContent = messages.trace.reset;
    traceStop.textContent = messages.trace.stop;
    filterSummary.title = messages.filterTitle;
    filterSummary.setAttribute("aria-label", messages.filterTitle);
    filterHeading.textContent = messages.filterHeading;
    filterHelp.textContent = messages.filterHelp;
    mockQueryLabel.textContent = messages.mockQueryLabel;
    mockQueryHelp.textContent = messages.mockQueryHelp;
    clearFilterButton.textContent = messages.clear;
    applyFilterButton.textContent = messages.applyFilter;
    settingsSummary.title = messages.settingsTitle;
    settingsSummary.setAttribute("aria-label", messages.settingsTitle);
    detailResizer.setAttribute("aria-label", messages.detailResize);

    nodeScaleRow.name.textContent = messages.nodeScale;
    fontRow.name.textContent = messages.fontSize;
    edgeRow.name.textContent = messages.edgeWidth;
    paletteName.textContent = messages.palette;
    paletteOptions.default.textContent = messages.paletteDefault;
    paletteOptions.soft.textContent = messages.paletteSoft;
    paletteOptions.contrast.textContent = messages.paletteContrast;
    languageName.textContent = messages.language;
    localeOptions.vi.textContent = messages.vietnamese;
    localeOptions.en.textContent = messages.english;
    resetSettings.textContent = messages.resetSettings;

    const filterEmpty = filterRows.querySelector<HTMLElement>(".cf-filter-empty");
    if (filterEmpty !== null) filterEmpty.textContent = messages.filterEmpty;
    for (const control of filterControls) {
      control.enabled.setAttribute(
        "aria-label",
        messages.enableConstraint(control.candidate.variable),
      );
      if (!control.mockedCondition) {
        control.variableLabel.title = messages.candidateConfidence(
          control.candidate.certainNodes,
          control.candidate.unknownNodes,
        );
      }
      control.value.placeholder = messages.filterPlaceholder(control.candidate.values.length);
      control.value.setAttribute("aria-label", messages.valueFor(control.candidate.variable));
      control.suggestionToggle?.setAttribute(
        "aria-label",
        messages.openSuggestions(control.candidate.variable),
      );
    }

    if (sourceGraph !== undefined) {
      renderSourceGraph?.();
    }
  };

  languageSelect.addEventListener("change", () => {
    const locale = clampSettings({ locale: languageSelect.value as Locale }).locale;
    languageSelect.value = locale;
    applySettings({ locale });
    applyUiLanguage();
  });
  applyUiLanguage();

  // ---- tương tác ----

  interactions = attachInteractions(canvas, surface, state.transform, {
    onChange: (transform) => {
      state = { ...state, transform };
      persist();
    },
  });

  let resizingDetail = false;
  const resizeDetailAt = (pointerX: number): void => {
    const rect = body.getBoundingClientRect();
    detailWidth = detailWidthFromPointer(rect.left, rect.right, pointerX);
    applyCssSettings();
  };
  detailResizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    resizingDetail = true;
    root.classList.add("cf-resizing-detail");
    event.preventDefault();
  });
  window.addEventListener("pointermove", (event) => {
    if (resizingDetail) resizeDetailAt(event.clientX);
  });
  window.addEventListener("pointerup", () => {
    if (!resizingDetail) return;
    resizingDetail = false;
    root.classList.remove("cf-resizing-detail");
    fitCachedLayout();
  });
  detailResizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const delta = event.key === "ArrowLeft" ? 20 : -20;
    const rect = body.getBoundingClientRect();
    resizeDetailAt(rect.right - detailWidth - delta);
    fitCachedLayout();
    event.preventDefault();
  });

  resetButton.addEventListener("click", () => {
    if (cachedLayout !== undefined) interactions?.fit(cachedLayout.width, cachedLayout.height);
  });
  expandButton.addEventListener("click", () => {
    state = { ...state, collapsedIds: new Set() };
    persist();
    renderGraphView(false);
  });
  collapseButton.addEventListener("click", () => {
    if (base === undefined) return;
    state = { ...state, collapsedIds: initialCollapsedIds(base) };
    persist();
    renderGraphView(false);
  });

  const setTraceDecision = (graphKey: string, nodeId: string, decision: TraceDecision): void => {
    const existing = state.trace.decisions[graphKey]?.[nodeId];
    let stored = decision;
    if (decision.kind === "branch" && existing?.kind === "branch") {
      stored = { kind: "branches", outcomes: [existing.outcome, decision.outcome] };
    } else if (decision.kind === "branch" && existing?.kind === "branches") {
      stored = { kind: "branches", outcomes: [...existing.outcomes, decision.outcome] };
    }
    state = {
      ...state,
      trace: {
        ...state.trace,
        decisions: {
          ...state.trace.decisions,
          [graphKey]: { ...state.trace.decisions[graphKey], [nodeId]: stored },
        },
        actions: [...state.trace.actions, { graphKey, kind: "decision", nodeId }],
      },
    };
    persist();
    renderSourceGraph?.();
  };

  const paintTraceResult = (
    result: GuidedTraceResult | undefined,
    graph: FlowGraph,
    graphKey: string,
  ): void => {
    traceResult.replaceChildren();
    tracePanel.classList.toggle("cf-trace-active", state.trace.active);
    traceToggle.classList.toggle("cf-trace-toggle-active", state.trace.active);
    traceStart.disabled = state.trace.active;
    traceBack.disabled =
      !state.trace.active ||
      (!state.trace.actions.some((action) => action.graphKey === graphKey) &&
        !traceCanNavigateBack);
    traceReset.disabled = !state.trace.active;
    traceStop.disabled = !state.trace.active;
    if (!state.trace.active || result === undefined) return;

    if (state.trace.trail.length > 0) {
      const trailTitle = document.createElement("strong");
      trailTitle.textContent = messages.trace.trail;
      const trail = document.createElement("ol");
      trail.className = "cf-trace-trail";
      for (const item of state.trace.trail) {
        const row = document.createElement("li");
        row.textContent = `${item.functionName}: ${item.summary}`;
        trail.append(row);
      }
      traceResult.append(trailTitle, trail);
    }

    const status = document.createElement("div");
    status.className = `cf-trace-status cf-trace-status-${result.status}`;
    if (result.status === "awaiting" && result.question !== undefined) {
      const badge = document.createElement("strong");
      badge.textContent = messages.trace.awaiting;
      const location = document.createElement("span");
      location.textContent = ` · ${graph.functionName}:${result.question.line}`;
      const code = document.createElement("code");
      code.textContent = result.question.code;
      status.append(badge, location, code);

      if (result.question.variable !== undefined) {
        const runtimeRow = document.createElement("div");
        runtimeRow.className = "cf-trace-runtime-row";
        const runtimeInput = document.createElement("input");
        runtimeInput.type = "text";
        runtimeInput.placeholder = messages.trace.enterValue(result.question.variable);
        runtimeInput.setAttribute(
          "aria-label",
          messages.trace.enterValue(result.question.variable),
        );
        const runtimeButton = button(messages.trace.useValue, "cf-primary");
        const applyRuntimeValue = (): void => {
          const variable = result.question?.variable;
          if (variable === undefined) return;
          const frameValues = state.trace.runtimeValues[graphKey] ?? {};
          const hadPrevious = Object.prototype.hasOwnProperty.call(frameValues, variable);
          const previous = frameValues[variable];
          state = {
            ...state,
            trace: {
              ...state.trace,
              runtimeValues: {
                ...state.trace.runtimeValues,
                [graphKey]: {
                  ...state.trace.runtimeValues[graphKey],
                  [variable]: parseTraceScalar(runtimeInput.value),
                },
              },
              actions: [
                ...state.trace.actions,
                {
                  graphKey,
                  kind: "runtime",
                  variable,
                  hadPrevious,
                  ...(hadPrevious ? { previous } : {}),
                },
              ],
            },
          };
          persist();
          renderSourceGraph?.();
        };
        runtimeButton.addEventListener("click", applyRuntimeValue);
        runtimeInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") applyRuntimeValue();
        });
        runtimeRow.append(runtimeInput, runtimeButton);
        status.append(runtimeRow);
      }

      const optionsRow = document.createElement("div");
      optionsRow.className = "cf-trace-options";
      for (const option of result.question.options) {
        const choice = button(option.label);
        choice.addEventListener("click", () => {
          const decision: TraceDecision =
            result.question?.kind === "condition"
              ? { kind: "branch", outcome: option.id === "true" ? "true" : "false" }
              : { kind: "edge", targetId: option.targetId ?? option.id };
          setTraceDecision(graphKey, result.question?.nodeId ?? "", decision);
        });
        optionsRow.append(choice);
      }
      const mockNote = document.createElement("small");
      mockNote.className = "cf-trace-mock-note";
      mockNote.textContent = messages.trace.mocked;
      status.append(optionsRow, mockNote);
    } else if (result.status === "callee" && result.calleeNodeId !== undefined) {
      const callees = calleeLinks.filter((callee) => callee.nodeId === result.calleeNodeId);
      const callee = callees[callees.length - 1];
      if (callee !== undefined) {
        const explanation = document.createElement("p");
        explanation.textContent = result.terminal?.code ?? result.terminal?.label ?? "";
        const continueButton = button(messages.trace.continueInto(callee.label), "cf-primary");
        continueButton.addEventListener("click", () => {
          const trail = [
            ...state.trace.trail.filter((item) => item.graphKey !== graphKey),
            {
              graphKey,
              functionName: graph.functionName,
              summary: `return → ${callee.label}`,
            },
          ];
          state = { ...state, trace: { ...state.trace, trail } };
          persist();
          options.onOpenCallee(callee.targetId);
        });
        status.append(explanation, continueButton);
      }
    } else {
      let label = messages.trace.returned;
      if (result.status === "thrown") label = messages.trace.thrown;
      else if (result.status === "broken") label = messages.trace.broken;
      else if (result.status === "loop") label = messages.trace.loop;
      status.textContent = label;
      if (result.terminal !== undefined) {
        const code = document.createElement("code");
        code.textContent = result.terminal.code || result.terminal.label;
        status.append(code);
      }
    }
    traceResult.append(status);

    const values = Object.entries(result.values).slice(-24);
    if (values.length > 0) {
      const known = document.createElement("details");
      known.className = "cf-trace-values";
      const summary = document.createElement("summary");
      summary.textContent = `${messages.trace.knownValues} (${Object.keys(result.values).length})`;
      const list = document.createElement("dl");
      for (const [name, value] of values) {
        const key = document.createElement("dt");
        key.textContent = name;
        const rendered = document.createElement("dd");
        rendered.textContent = JSON.stringify(value);
        list.append(key, rendered);
      }
      known.append(summary, list);
      traceResult.append(known);
    }
  };

  traceToggle.addEventListener("click", () => {
    tracePanel.hidden = !tracePanel.hidden;
    if (!tracePanel.hidden) traceInput.focus();
  });
  traceClose.addEventListener("click", () => {
    tracePanel.hidden = true;
  });
  traceInput.addEventListener("input", () => {
    state = { ...state, trace: { ...state.trace, input: traceInput.value } };
    persist();
  });
  traceBack.addEventListener("click", () => {
    const undone = undoTraceAction(state.trace, traceGraphKey);
    if (undone !== undefined) {
      state = { ...state, trace: undone };
      persist();
      renderSourceGraph?.();
      return;
    }
    if (!traceCanNavigateBack) return;
    state = {
      ...state,
      trace: { ...state.trace, trail: state.trace.trail.slice(0, -1) },
    };
    persist();
    options.onNavigateBack();
  });
  const startTrace = (): void => {
    try {
      JSON.parse(traceInput.value);
    } catch {
      traceError.textContent = messages.trace.invalidJson;
      traceError.hidden = false;
      return;
    }
    traceError.hidden = true;
    state = {
      ...state,
      trace: {
        active: true,
        input: traceInput.value,
        decisions: {},
        runtimeValues: {},
        trail: [],
        actions: [],
      },
    };
    persist();
    renderSourceGraph?.();
  };
  traceStart.addEventListener("click", startTrace);
  traceReset.addEventListener("click", startTrace);
  traceStop.addEventListener("click", () => {
    state = { ...state, trace: { ...state.trace, active: false } };
    persist();
    renderSourceGraph?.();
  });

  const renderWarnings = (filtered: FlowGraph): void => {
    warnings.replaceChildren();
    const notes = [...filtered.warnings];
    if (
      base !== undefined &&
      (sourceNodeCount(base) > USER_THRESHOLD || base.nodes.length > RENDER_GUARD)
    ) {
      notes.unshift(
        messages.largeGraphWarning(
          sourceNodeCount(base),
          USER_THRESHOLD,
          base.nodes.length,
          RENDER_GUARD,
        ),
      );
    }
    warnings.hidden = notes.length === 0;
    if (notes.length === 0) return;

    const warningSummary = document.createElement("summary");
    warningSummary.textContent = messages.warningCount(notes.length);
    const list = document.createElement("ul");
    for (const note of notes) {
      const item = document.createElement("li");
      item.textContent = note;
      list.append(item);
    }
    warnings.append(warningSummary, list);
  };

  renderSourceGraph = () => {
    const next = sourceGraph;
    if (next === undefined) return;
    const context = sourceContext;
    calleeLinks = context?.callees ?? [];
    gitChanges = new Map((context?.gitChanges ?? []).map((change) => [change.nodeId, change]));
    paintGitLegend();
    const graphNavigation = context?.navigation ?? {
      breadcrumbs: [next.functionName],
      canGoBack: false,
    };
    traceGraphKey = graphKeyOf(next.filePath, next.functionName);
    traceCanNavigateBack = graphNavigation.canGoBack;
    backButton.hidden = !graphNavigation.canGoBack;
    breadcrumbs.textContent = graphNavigation.breadcrumbs.join(" → ");

    const key = traceGraphKey;
    const sameGraph = state.graphKey === key;
    if (!sameGraph) {
      const trace = state.trace;
      state = {
        ...initialState(),
        graphKey: key,
        settings: state.settings,
        trace,
      };
    }

    // Graph nguồn là nguồn sự thật cho state. Node bị filter ẩn vẫn hợp lệ, nên collapse /
    // selection của nó không bị prune; bỏ constraint thì trạng thái quay lại.
    if (sameGraph) {
      state = reconcileSameGraphState(state, toDisplayGraph(next), false);
    }

    // Constraint persistence có thể đến từ source cũ cùng graphKey. Chỉ giữ biến analyzer
    // hiện vẫn công bố; không giữ key mồ côi sống lại trên source khác.
    const candidates = collectFilterCandidates(next);
    const knownVariables = new Set([
      ...candidates.map((candidate) => candidate.variable),
      ...collectQueryMockCandidates(next).map((candidate) => candidate.key),
    ]);
    const constraints = Object.fromEntries(
      Object.entries(state.constraints).filter(([variable]) => knownVariables.has(variable)),
    );
    state = { ...state, constraints };

    const filtered = filterGraph(next, state.constraints);
    let displayedGraph = filtered;
    let guided: GuidedTraceResult | undefined;
    if (state.trace.active) {
      try {
        const bodyValue: unknown = JSON.parse(state.trace.input);
        guided = runGuidedTrace({
          graph: next,
          parameters: context?.trace?.parameters ?? [],
          aliases: context?.trace?.aliases,
          body: bodyValue,
          decisions: state.trace.decisions[key],
          runtimeValues: state.trace.runtimeValues[key],
          terminalCalleeNodeIds: new Set(calleeLinks.map((callee) => callee.nodeId)),
        });
        displayedGraph = guided.graph;
        traceError.hidden = true;
      } catch {
        traceError.textContent = messages.trace.invalidJson;
        traceError.hidden = false;
      }
    }
    const display = toDisplayGraph(displayedGraph);
    base = markBackEdges(FANOUT_ENABLED ? fanoutFinallyRegions(display) : display);
    if (!sameGraph) state = { ...state, collapsedIds: initialCollapsedIds(base) };

    const summary = filterStats(next, filtered);
    const hasConstraints = Object.keys(state.constraints).length > 0;
    filterReadout.hidden = state.trace.active || !hasConstraints;
    filterReadout.textContent = messages.hiddenNodes(summary.hidden, summary.total);
    filterBox.classList.toggle("cf-filter-active", hasConstraints);
    populateFilterControls(next);
    mockQueryCheckbox.checked = state.mockQueryEnabled;
    paintTraceResult(guided, next, key);

    persist();
    cachedLayout = undefined;
    cachedKey = "";

    renderWarnings(displayedGraph);

    renderGraphView(true);
  };

  applyCssSettings();

  return {
    setGraph: (next, context) => {
      sourceGraph = next;
      sourceContext = context;
      renderSourceGraph?.();
    },

    showError: (message) => {
      sourceGraph = undefined;
      sourceContext = undefined;
      base = undefined;
      cachedLayout = undefined;
      cachedKey = "";
      heading.textContent = messages.graphError;
      stats.textContent = "";
      filterReadout.hidden = true;
      gitLegend.hidden = true;
      filterBox.open = false;
      filterBox.classList.remove("cf-filter-active");
      filterRows.replaceChildren();
      mockQueryCheckbox.checked = false;
      warnings.hidden = true;
      surface.replaceChildren();
      detail.replaceChildren();
      const error = document.createElement("p");
      error.className = "cf-error";
      error.textContent = message;
      detail.append(error);
    },
  };
}
