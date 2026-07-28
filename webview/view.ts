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

import type { FlowGraph } from "../shared/types";
import type { Layout } from "./layout/run-elk";
import { runLayout } from "./layout/run-elk";
import { markBackEdges } from "./model/back-edges";
import { RENDER_GUARD, USER_THRESHOLD, initialCollapsedIds } from "./model/auto-collapse";
import { applyCollapse } from "./model/collapse";
import { pruneCollapsedIds } from "./model/collapse";
import type { DisplayGraph } from "./model/display-graph";
import { sourceNodeCount, toDisplayGraph } from "./model/display-graph";
import { FANOUT_ENABLED, fanoutFinallyRegions } from "./model/finally-fanout";
import { renderDetail } from "./render/detail";
import { attachInteractions, type InteractHandles } from "./render/interact";
import { renderGraph } from "./render/svg";
import type { DisplaySettings } from "./settings";
import { LIMITS, affectsLayout, clampSettings, defaultSettings } from "./settings";
import type { ViewState } from "./state";
import { graphKeyOf, initialState } from "./state";

export interface ViewOptions {
  /** Người dùng muốn nhảy tới node trong editor gốc. Nhận `sourceId`. */
  onReveal: (sourceId: string) => void;
  /** Trạng thái đổi - bên gọi đem đi `setState`. */
  onStateChange: (state: ViewState) => void;
  /** Trạng thái phục hồi từ `getState`, nếu có. */
  restored?: ViewState;
}

export interface View {
  setGraph: (graph: FlowGraph) => void;
  showError: (message: string) => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function button(label: string, className = ""): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (className !== "") element.className = className;
  return element;
}

/** Một hàng slider trong bảng tuỳ chỉnh. */
function slider(
  label: string,
  limits: { min: number; max: number; step: number },
  value: number,
  onInput: (next: number) => void,
): { row: HTMLElement; input: HTMLInputElement; readout: HTMLElement } {
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
  return { row, input, readout };
}

export function createView(root: HTMLElement, options: ViewOptions): View {
  root.replaceChildren();
  root.classList.add("cf-root");

  const toolbar = document.createElement("header");
  toolbar.className = "cf-toolbar";
  const heading = document.createElement("span");
  heading.className = "cf-title";
  const stats = document.createElement("span");
  stats.className = "cf-stats";
  const expandButton = button("Mở hết");
  const collapseButton = button("Thu gọn mặc định");
  const resetButton = button("Reset view");

  const settingsBox = document.createElement("details");
  settingsBox.className = "cf-settings";
  const settingsSummary = document.createElement("summary");
  settingsSummary.textContent = "Hiển thị";
  const settingsBody = document.createElement("div");
  settingsBody.className = "cf-settings-body";
  settingsBox.append(settingsSummary, settingsBody);

  toolbar.append(heading, stats, settingsBox, expandButton, collapseButton, resetButton);

  const warnings = document.createElement("details");
  warnings.className = "cf-warnings";
  warnings.hidden = true;

  const body = document.createElement("div");
  body.className = "cf-body";
  const canvas = document.createElementNS(SVG_NS, "svg");
  canvas.setAttribute("class", "cf-canvas");
  const surface = document.createElementNS(SVG_NS, "g");
  canvas.append(surface);
  const detail = document.createElement("aside");
  detail.className = "cf-detail";
  body.append(canvas, detail);

  root.append(toolbar, warnings, body);

  let state: ViewState = options.restored ?? initialState();
  /** Graph sau fanout + back edge, TRƯỚC collapse. Nguồn để collapse lại. */
  let base: DisplayGraph | undefined;
  let interactions: InteractHandles | undefined;
  /** Tăng mỗi lần chạy layout; kết quả ELK về muộn hơn lượt hiện tại thì bỏ. */
  let generation = 0;
  /** Layout đã tính + khoá mô tả nó được tính từ đâu, để không chạy ELK lại vô ích. */
  let cachedLayout: Layout | undefined;
  let cachedKey = "";

  const persist = (): void => options.onStateChange(state);

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
    canvas.style.setProperty("--cf-edge-width", String(state.settings.edgeWidth));
    canvas.style.setProperty("--cf-text-node", `${state.settings.fontSize}px`);
    root.dataset["cfPalette"] = state.settings.palette;
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
    if (base !== undefined) {
      renderDetail(detail, base, state.selectedSourceId, { onJump: options.onReveal });
    }
  };

  /** Đường 1: chạy ELK (nếu cần) rồi dựng lại SVG. */
  const renderGraphView = (fit: boolean): void => {
    if (base === undefined) return;
    const current = ++generation;
    const view = applyCollapse(base, state.collapsedIds);
    const key = layoutKeyOf(state.settings);

    const visible = view.graph.nodes.length;
    stats.textContent =
      `${sourceNodeCount(base)} node · ${base.edges.length} edge` +
      (visible === base.nodes.length ? "" : ` · hiện ${visible}/${base.nodes.length}`) +
      (visible > RENDER_GUARD ? " · graph lớn, layout có thể chậm" : "");

    renderDetail(detail, base, state.selectedSourceId, { onJump: options.onReveal });

    const paint = (layout: Layout): void => {
      if (current !== generation) return; // Lượt cũ về muộn - bỏ, không vẽ đè lượt mới.
      cachedLayout = layout;
      cachedKey = key;
      renderGraph(surface, view.graph, layout, {
        hiddenCounts: view.hiddenCounts,
        selectedSourceId: state.selectedSourceId,
        settings: state.settings,
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
          stats.textContent = `layout thất bại: ${String(error)}`;
        },
      );
    });
  };

  // ---- bảng tuỳ chỉnh hiển thị ----

  const applySettings = (next: Partial<DisplaySettings>): void => {
    const merged = clampSettings({ ...state.settings, ...next });
    const needsLayout = affectsLayout(state.settings, merged);
    state = { ...state, settings: merged };
    persist();
    if (needsLayout) renderGraphView(false);
    else applyCssSettings();
  };

  const nodeScaleRow = slider("Cỡ node", LIMITS.nodeScale, state.settings.nodeScale, (value) =>
    applySettings({ nodeScale: value }),
  );
  const fontRow = slider("Cỡ chữ", LIMITS.fontSize, state.settings.fontSize, (value) =>
    applySettings({ fontSize: value }),
  );
  const edgeRow = slider("Đường nối", LIMITS.edgeWidth, state.settings.edgeWidth, (value) =>
    applySettings({ edgeWidth: value }),
  );

  const paletteRow = document.createElement("label");
  paletteRow.className = "cf-setting";
  const paletteName = document.createElement("span");
  paletteName.className = "cf-setting-name";
  paletteName.textContent = "Bảng màu";
  const paletteSelect = document.createElement("select");
  for (const [value, label] of [
    ["default", "Mặc định"],
    ["soft", "Dịu"],
    ["contrast", "Tương phản cao"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    paletteSelect.append(option);
  }
  paletteSelect.value = state.settings.palette;
  paletteSelect.addEventListener("change", () => {
    applySettings({ palette: clampSettings({ palette: paletteSelect.value as never }).palette });
  });
  paletteRow.append(paletteName, paletteSelect);

  const resetSettings = button("Về mặc định", "cf-setting-reset");
  resetSettings.addEventListener("click", () => {
    const base = defaultSettings();
    nodeScaleRow.input.value = String(base.nodeScale);
    nodeScaleRow.readout.textContent = String(base.nodeScale);
    fontRow.input.value = String(base.fontSize);
    fontRow.readout.textContent = String(base.fontSize);
    edgeRow.input.value = String(base.edgeWidth);
    edgeRow.readout.textContent = String(base.edgeWidth);
    paletteSelect.value = base.palette;
    applySettings(base);
  });

  settingsBody.append(nodeScaleRow.row, fontRow.row, edgeRow.row, paletteRow, resetSettings);

  // ---- tương tác ----

  interactions = attachInteractions(canvas, surface, state.transform, {
    onChange: (transform) => {
      state = { ...state, transform };
      persist();
    },
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

  applyCssSettings();

  return {
    setGraph: (next) => {
      const key = graphKeyOf(next.filePath, next.functionName);
      const display = toDisplayGraph(next);
      base = markBackEdges(FANOUT_ENABLED ? fanoutFinallyRegions(display) : display);

      if (state.graphKey === key) {
        // Cùng graph (tab ẩn rồi hiện lại): giữ nguyên trạng thái người dùng, chỉ lọc id đã
        // biến mất. Không áp lại mặc định - làm thế là thu gọn lại đúng cái họ vừa mở.
        state = {
          ...state,
          collapsedIds: pruneCollapsedIds(base, state.collapsedIds),
          selectedSourceId: base.nodes.some((n) => n.sourceId === state.selectedSourceId)
            ? state.selectedSourceId
            : undefined,
        };
      } else {
        state = {
          ...initialState(),
          graphKey: key,
          collapsedIds: initialCollapsedIds(base),
          settings: state.settings, // Tuỳ chỉnh hiển thị theo NGƯỜI, không theo graph.
        };
      }
      persist();
      cachedLayout = undefined;
      cachedKey = "";

      heading.textContent = next.functionName;

      warnings.replaceChildren();
      const notes = [...next.warnings];
      if (sourceNodeCount(base) > USER_THRESHOLD || base.nodes.length > RENDER_GUARD) {
        notes.unshift(
          `Graph lớn (${sourceNodeCount(base)} node > ${USER_THRESHOLD}, hoặc ` +
            `${base.nodes.length} node vẽ > ${RENDER_GUARD}) - đã thu gọn về tầng ngoài cùng. ` +
            "Lưu ý: collapse chỉ phủ try/catch/finally nên trên nhiều hàm nó không giúp gì " +
            "(xem TODO.md mục 1).",
        );
      }
      warnings.hidden = notes.length === 0;
      if (notes.length > 0) {
        const summary = document.createElement("summary");
        summary.textContent = `${notes.length} cảnh báo`;
        const list = document.createElement("ul");
        for (const note of notes) {
          const item = document.createElement("li");
          item.textContent = note;
          list.append(item);
        }
        warnings.append(summary, list);
      }

      renderGraphView(true);
    },

    showError: (message) => {
      base = undefined;
      cachedLayout = undefined;
      cachedKey = "";
      heading.textContent = "Không dựng được graph";
      stats.textContent = "";
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
