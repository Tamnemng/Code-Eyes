// webview/state.ts
// Trạng thái xem. Thuần: không chạm DOM, không chạm `acquireVsCodeApi`.
//
// Sống qua vòng dispose/restore khi tab ẩn rồi hiện lại, bằng `getState`/`setState` chứ không
// bằng `retainContextWhenHidden` (giữ context cho graph 1000 node là trả RAM cho một tab
// người dùng không xem). Giới hạn: chỉ trong một session - xem TODO.md mục 2.

import type { DisplaySettings } from "./settings";
import { defaultSettings, restoreSettings } from "./settings";

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
    transform: { x: 0, y: 0, scale: 1 },
    settings: defaultSettings(),
  };
}

/** Hình dạng đem đi `setState` - `Set` không qua được JSON nên đổi thành mảng. */
export function serializeState(state: ViewState): unknown {
  return {
    version: 1,
    graphKey: state.graphKey ?? null,
    collapsedIds: [...state.collapsedIds].sort(),
    selectedSourceId: state.selectedSourceId ?? null,
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
