import { describe, expect, it } from "vitest";

import { filterGraph } from "../../filter/filterGraph";
import { toDisplayGraph } from "../model/display-graph";
import {
  appliedConstraintValue,
  filterInputValue,
  reconcileSameGraphState,
} from "../model/filter-state";
import { initialState } from "../state";
import { loadGolden } from "./helpers/golden";

describe("reconcileSameGraphState", () => {
  it("filter-update giữ collapsedIds và selection đang tạm vắng mặt", () => {
    const input = loadGolden("g-filter-routeClient");
    const tryNode = input.nodes.find((node) => node.kind === "try");
    if (tryNode === undefined) throw new Error("fixture thiếu vùng try trong nhánh C");
    const graph = toDisplayGraph(filterGraph(input, { clientCode: "A" }));
    expect(graph.nodes.some((node) => node.sourceId === tryNode.id)).toBe(false);
    const state = {
      ...initialState(),
      graphKey: "same",
      collapsedIds: new Set([tryNode.id]),
      selectedSourceId: tryNode.id,
    };

    const next = reconcileSameGraphState(state, graph, true);
    expect(next.collapsedIds).toEqual(state.collapsedIds);
    expect(next.selectedSourceId).toBe(tryNode.id);

    const restored = reconcileSameGraphState(next, toDisplayGraph(input), true);
    expect(restored.collapsedIds.has(tryNode.id)).toBe(true);
    expect(restored.selectedSourceId).toBe(tryNode.id);
  });

  it("graph reload bình thường lọc id persistence mồ côi", () => {
    const graph = toDisplayGraph(loadGolden("g-filter-asymmetric"));
    const alive = graph.nodes[0]?.sourceId;
    if (alive === undefined) throw new Error("fixture rỗng");
    const state = {
      ...initialState(),
      graphKey: "same",
      collapsedIds: new Set(["n_missing", alive]),
      selectedSourceId: "n_missing",
    };

    const next = reconcileSameGraphState(state, graph, false);
    expect(next.collapsedIds).toEqual(new Set([alive]));
    expect(next.selectedSourceId).toBeUndefined();
  });
});

describe("filter value controls", () => {
  it("hiện option đầu tiên mặc định và ưu tiên constraint đã apply", () => {
    expect(
      filterInputValue(
        {},
        "taskType",
        "ETaskType.RECEIVE_BY_LPN",
      ),
    ).toBe("ETaskType.RECEIVE_BY_LPN");
    expect(
      filterInputValue(
        { taskType: "ETaskType.RECEIVE_BY_UPC" },
        "taskType",
        "ETaskType.RECEIVE_BY_LPN",
      ),
    ).toBe("ETaskType.RECEIVE_BY_UPC");
  });

  it("không apply checkbox rỗng và trim giá trị đã nhập", () => {
    expect(appliedConstraintValue(true, "   ")).toBeUndefined();
    expect(appliedConstraintValue(false, "A")).toBeUndefined();
    expect(appliedConstraintValue(true, "  A  ")).toBe("A");
  });
});
