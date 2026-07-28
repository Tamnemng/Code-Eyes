import { describe, expect, it } from "vitest";

import { loadGolden } from "../../webview/__tests__/helpers/golden";
import { collectFilterCandidates } from "../candidates";

describe("collectFilterCandidates", () => {
  it("gom biến và giá trị từ condition.parsed của graph analyzer thật", () => {
    expect(collectFilterCandidates(loadGolden("g-filter-routeClient"))).toEqual([
      {
        variable: "clientCode",
        values: ["A", "B", "C", "D", "E"],
        certainNodes: 5,
        unknownNodes: 0,
      },
    ]);
  });

  it("giữ biến unknown + parsed vì §12 cho phép prune một chiều", () => {
    expect(collectFilterCandidates(loadGolden("g-filter-asymmetric"))).toEqual([
      {
        variable: "clientCode",
        values: ["A"],
        certainNodes: 0,
        unknownNodes: 1,
      },
    ]);
  });

  it("không bịa candidate từ raw condition không có parsed", () => {
    expect(collectFilterCandidates(loadGolden("g-filter-complexSwitch"))).toEqual([]);
  });

  it("lists every && variable, optional access, and enum switch cases", () => {
    expect(collectFilterCandidates(loadGolden("g-filter-compoundWarehouse"))).toEqual([
      {
        variable: "currentUser.clientCode",
        values: ["SAINTGOBAIN"],
        certainNodes: 0,
        unknownNodes: 1,
      },
      {
        variable: "whseid",
        values: ["510"],
        certainNodes: 0,
        unknownNodes: 1,
      },
    ]);

    expect(collectFilterCandidates(loadGolden("g-filter-optionalClient"))).toEqual([
      {
        variable: "currentUser.clientCode",
        values: ["TTC"],
        certainNodes: 1,
        unknownNodes: 0,
      },
    ]);

    expect(collectFilterCandidates(loadGolden("g-filter-routeTask"))).toEqual([
      {
        variable: "data.taskType",
        values: [
          "ETaskType.RECEIVE_BY_LPN",
          "ETaskType.RECEIVE_BY_UPC",
          "ETaskType.UPDATE_RECEIPT_BY_UPC",
        ],
        certainNodes: 3,
        unknownNodes: 0,
      },
    ]);
  });
});
