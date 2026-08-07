// webview/state.ts
// Trạng thái xem. Thuần: không chạm DOM, không chạm `acquireVsCodeApi`.
//
// Sống qua vòng dispose/restore khi tab ẩn rồi hiện lại, bằng `getState`/`setState` chứ không
// bằng `retainContextWhenHidden` (giữ context cho graph 1000 node là trả RAM cho một tab
// người dùng không xem). Giới hạn: chỉ trong một session - xem TODO.md mục 2.

import type { DisplaySettings } from "./settings";
import { defaultSettings, restoreSettings } from "./settings";
import type { TraceDecision, TraceScalar } from "../filter/guidedTrace";

export interface TraceTrailItem {
  graphKey: string;
  functionName: string;
  summary: string;
}

export type TraceUndoAction =
  | { graphKey: string; kind: "decision"; nodeId: string }
  | {
      graphKey: string;
      kind: "runtime";
      variable: string;
      hadPrevious: boolean;
      previous?: TraceScalar;
    };

export interface TraceSessionState {
  active: boolean;
  input: string;
  decisions: Record<string, Record<string, TraceDecision>>;
  runtimeValues: Record<string, Record<string, TraceScalar>>;
  trail: TraceTrailItem[];
  actions: TraceUndoAction[];
}

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface ViewState {
  /**
   * Graph mà trạng thái này thuộc về: `<filePath>#<functionName>`.
   *
   * Cần để phân biệt "người dùng đã tự mở hết vùng finally" với "đây là graph mới, chưa ai
   * chạm vào". Không có nó thì cả hai đều là `collapsedIds` rỗng, và mỗi lần tab hiện lại sẽ
   * thu gọn lại đúng những vùng người dùng vừa mở ra.
   */
  graphKey: string | undefined;
  /** `sourceId` của các node đang thu gọn. KHÔNG phải id hiển thị - xem `collapse.ts`. */
  collapsedIds: Set<string>;
  /** `sourceId` của node đang chọn, hoặc `undefined`. */
  selectedSourceId: string | undefined;
  /** Ràng buộc filter của graph hiện tại. Key/value đều là source text/string literal. */
  constraints: Record<string, string>;
  /** Bật các override true/false cho condition phụ thuộc dữ liệu query/runtime. */
  mockQueryEnabled: boolean;
  /** Phiên debug giả lập; giữ qua navigation để body đi tiếp sang callee. */
  trace: TraceSessionState;
  transform: Transform;
  /** Tuỳ chỉnh hiển thị (cỡ node, cỡ chữ, độ dày cạnh, bảng màu). Xem `settings.ts`. */
  settings: DisplaySettings;
}

export function graphKeyOf(filePath: string, functionName: string): string {
  return `${filePath}#${functionName}`;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function initialState(): ViewState {
  return {
    graphKey: undefined,
    collapsedIds: new Set(),
    selectedSourceId: undefined,
    constraints: {},
    mockQueryEnabled: false,
    trace: {
      active: false,
      input: "{\n  \"taskType\": \"\"\n}",
      decisions: {},
      runtimeValues: {},
      trail: [],
      actions: [],
    },
    transform: { x: 0, y: 0, scale: 1 },
    settings: defaultSettings(),
  };
}

/** Hình dạng đem đi `setState` - `Set` không qua được JSON nên đổi thành mảng. */
export function serializeState(state: ViewState): unknown {
  const constraints = Object.fromEntries(
    Object.entries(state.constraints).sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    version: 2,
    graphKey: state.graphKey ?? null,
    collapsedIds: [...state.collapsedIds].sort(),
    selectedSourceId: state.selectedSourceId ?? null,
    constraints,
    mockQueryEnabled: state.mockQueryEnabled,
    trace: state.trace,
    transform: state.transform,
    settings: state.settings,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Hoàn tác đúng một câu trả lời/mock trong graph hiện tại; undefined nghĩa là caller cần back frame. */
export function undoTraceAction(
  trace: TraceSessionState,
  graphKey: string,
): TraceSessionState | undefined {
  let actionIndex = -1;
  for (let index = trace.actions.length - 1; index >= 0; index -= 1) {
    if (trace.actions[index]?.graphKey === graphKey) {
      actionIndex = index;
      break;
    }
  }
  if (actionIndex < 0) return undefined;
  const action = trace.actions[actionIndex];
  if (action === undefined) return undefined;
  const actions = trace.actions.filter((_, index) => index !== actionIndex);
  const decisions = { ...trace.decisions };
  const runtimeValues = { ...trace.runtimeValues };

  if (action.kind === "decision") {
    const frame = { ...decisions[action.graphKey] };
    const current = frame[action.nodeId];
    if (current?.kind === "branches" && current.outcomes.length > 2) {
      frame[action.nodeId] = { kind: "branches", outcomes: current.outcomes.slice(0, -1) };
    } else if (current?.kind === "branches" && current.outcomes[0] !== undefined) {
      frame[action.nodeId] = { kind: "branch", outcome: current.outcomes[0] };
    } else {
      delete frame[action.nodeId];
    }
    decisions[action.graphKey] = frame;
  } else {
    const frame = { ...runtimeValues[action.graphKey] };
    if (action.hadPrevious) frame[action.variable] = action.previous ?? null;
    else delete frame[action.variable];
    runtimeValues[action.graphKey] = frame;
  }
  return { ...trace, actions, decisions, runtimeValues };
}

function restoreTraceDecision(value: unknown): TraceDecision | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value["kind"] === "branch" &&
    (value["outcome"] === "true" || value["outcome"] === "false")
  ) {
    return { kind: "branch", outcome: value["outcome"] };
  }
  if (
    value["kind"] === "branches" &&
    Array.isArray(value["outcomes"]) &&
    value["outcomes"].every((item) => item === "true" || item === "false")
  ) {
    return { kind: "branches", outcomes: value["outcomes"] };
  }
  if (value["kind"] === "edge" && typeof value["targetId"] === "string") {
    return { kind: "edge", targetId: value["targetId"] };
  }
  return undefined;
}

function restoreTrace(raw: unknown, fallback: TraceSessionState): TraceSessionState {
  if (!isRecord(raw)) return fallback;
  const trace: TraceSessionState = {
    active: typeof raw["active"] === "boolean" ? raw["active"] : false,
    input: typeof raw["input"] === "string" ? raw["input"] : fallback.input,
    decisions: {},
    runtimeValues: {},
    trail: [],
    actions: [],
  };
  const decisions = raw["decisions"];
  if (isRecord(decisions)) {
    for (const [graphKey, graphDecisions] of Object.entries(decisions)) {
      if (!isRecord(graphDecisions)) continue;
      const restored: Record<string, TraceDecision> = {};
      for (const [nodeId, decision] of Object.entries(graphDecisions)) {
        const parsed = restoreTraceDecision(decision);
        if (parsed !== undefined) restored[nodeId] = parsed;
      }
      trace.decisions[graphKey] = restored;
    }
  }
  const runtimeValues = raw["runtimeValues"];
  if (isRecord(runtimeValues)) {
    for (const [graphKey, graphValues] of Object.entries(runtimeValues)) {
      if (!isRecord(graphValues)) continue;
      const restored: Record<string, TraceScalar> = {};
      for (const [name, value] of Object.entries(graphValues)) {
        if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
          restored[name] = value as TraceScalar;
        }
      }
      trace.runtimeValues[graphKey] = restored;
    }
  }
  const trail = raw["trail"];
  if (Array.isArray(trail)) {
    trace.trail = trail.flatMap((item) =>
      isRecord(item) &&
      typeof item["graphKey"] === "string" &&
      typeof item["functionName"] === "string" &&
      typeof item["summary"] === "string"
        ? [
            {
              graphKey: item["graphKey"],
              functionName: item["functionName"],
              summary: item["summary"],
            },
          ]
        : [],
    );
  }
  const actions = raw["actions"];
  if (Array.isArray(actions)) {
    trace.actions = actions.flatMap((item): TraceUndoAction[] => {
      if (!isRecord(item) || typeof item["graphKey"] !== "string") return [];
      if (item["kind"] === "decision" && typeof item["nodeId"] === "string") {
        return [{ graphKey: item["graphKey"], kind: "decision", nodeId: item["nodeId"] }];
      }
      if (
        item["kind"] === "runtime" &&
        typeof item["variable"] === "string" &&
        typeof item["hadPrevious"] === "boolean"
      ) {
        const previous = item["previous"];
        if (
          item["hadPrevious"] &&
          !(previous === null || ["string", "number", "boolean"].includes(typeof previous))
        ) {
          return [];
        }
        return [
          {
            graphKey: item["graphKey"],
            kind: "runtime",
            variable: item["variable"],
            hadPrevious: item["hadPrevious"],
            ...(item["hadPrevious"] ? { previous: previous as TraceScalar } : {}),
          },
        ];
      }
      return [];
    });
  }
  return trace;
}

/**
 * Phục hồi từ dữ liệu KHÔNG TIN ĐƯỢC: nó do bản webview TRƯỚC ghi ra, có thể là schema cũ
 * hoặc rác. Sai một field thì bỏ field đó và dùng mặc định, KHÔNG throw - làm chết webview vì
 * một trạng thái xem cũ là đánh đổi tệ.
 *
 * `collapsedIds` phục hồi ở đây có thể trỏ vào node KHÔNG CÒN TỒN TẠI (người dùng đã sửa code,
 * graph mới có tập id khác). Việc lọc là của `pruneCollapsedIds`, chạy khi đã có graph.
 */
export function restoreState(raw: unknown): ViewState {
  const state = initialState();
  if (!isRecord(raw)) return state;

  const graphKey = raw["graphKey"];
  if (typeof graphKey === "string") state.graphKey = graphKey;

  const ids = raw["collapsedIds"];
  if (Array.isArray(ids)) {
    for (const id of ids) if (typeof id === "string") state.collapsedIds.add(id);
  }

  const selected = raw["selectedSourceId"];
  if (typeof selected === "string") state.selectedSourceId = selected;

  const constraints = raw["constraints"];
  if (isRecord(constraints)) {
    for (const [variable, value] of Object.entries(constraints)) {
      if (variable !== "" && typeof value === "string") state.constraints[variable] = value;
    }
  }

  state.mockQueryEnabled =
    typeof raw["mockQueryEnabled"] === "boolean" ? raw["mockQueryEnabled"] : false;
  state.trace = restoreTrace(raw["trace"], state.trace);

  const transform = raw["transform"];
  if (isRecord(transform)) {
    state.transform = {
      x: numberOr(transform["x"], 0),
      y: numberOr(transform["y"], 0),
      scale: clampScale(numberOr(transform["scale"], 1)),
    };
  }

  state.settings = restoreSettings(raw["settings"]);

  return state;
}
