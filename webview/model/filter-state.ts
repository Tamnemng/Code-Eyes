// Chính sách state khi cùng graph nguồn được render lại.
// Filter update là trạng thái tạm trong session: id vắng mặt không bị xoá để nó sống lại
// khi người dùng nới constraint. Reload/persistence bình thường vẫn lọc id mồ côi.

import { pruneCollapsedIds } from "./collapse";
import type { DisplayGraph } from "./display-graph";
import type { ViewState } from "../state";

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
