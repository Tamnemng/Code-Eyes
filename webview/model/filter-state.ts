// Chính sách state khi cùng graph nguồn được render lại.
// Filter update là trạng thái tạm trong session: id vắng mặt không bị xoá để nó sống lại
// khi người dùng nới constraint. Reload/persistence bình thường vẫn lọc id mồ côi.

import { pruneCollapsedIds } from "./collapse";
import type { DisplayGraph } from "./display-graph";
import type { ViewState } from "../state";

/** Khôi phục constraint đã apply; nếu chưa có thì hiện sẵn gợi ý đầu tiên. */
export function filterInputValue(
  constraints: ViewState["constraints"],
  variable: string,
  defaultValue = "",
): string {
  return constraints[variable] ?? defaultValue;
}

/** Checkbox rỗng không tạo constraint `""` khiến switch rơi nhầm vào default. */
export function appliedConstraintValue(enabled: boolean, value: string): string | undefined {
  const normalized = value.trim();
  return enabled && normalized !== "" ? normalized : undefined;
}

export function reconcileSameGraphState(
  state: ViewState,
  graph: DisplayGraph,
  preserveTransient: boolean,
): ViewState {
  if (preserveTransient) return state;
  return {
    ...state,
    collapsedIds: pruneCollapsedIds(graph, state.collapsedIds),
    selectedSourceId: graph.nodes.some((node) => node.sourceId === state.selectedSourceId)
      ? state.selectedSourceId
      : undefined,
  };
}
