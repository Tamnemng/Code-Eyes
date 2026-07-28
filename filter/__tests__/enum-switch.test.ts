import { describe, expect, it } from "vitest";

import { loadGolden } from "../../webview/__tests__/helpers/golden";
import { filterGraph } from "../filterGraph";

describe("filterGraph enum switch", () => {
  it("filters enum switch cases through data.taskType", () => {
    const result = filterGraph(loadGolden("g-filter-routeTask"), {
      "data.taskType": "ETaskType.RECEIVE_BY_UPC",
    });
    const labels = new Set(result.nodes.map((node) => node.label));

    expect(labels.has('return "upc";')).toBe(true);
    expect(labels.has('return "lpn";')).toBe(false);
    expect(labels.has('return "update";')).toBe(false);
  });
});
