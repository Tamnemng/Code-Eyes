import { describe, expect, it } from "vitest";

import { toDisplayGraph } from "../model/display-graph";
import { loadGolden } from "./helpers/golden";

const ALL_GOLDEN = [
  "a-finally-fanout-shipOrder",
  "b-nested-regions-pipeline",
  "c-loops-scan",
  "c-loops-drain",
  "c-loops-bailOut",
  "d-confidence-route",
  "e-all-kinds-everything",
] as const;

describe("toDisplayGraph", () => {
  it.each(ALL_GOLDEN)("%s: là ánh xạ đồng nhất, sourceId = id gốc", (name) => {
    const graph = loadGolden(name);
    const display = toDisplayGraph(graph);

    expect(display.nodes).toHaveLength(graph.nodes.length);
    expect(display.edges).toHaveLength(graph.edges.length);
    expect(display.nodes.map((n) => n.id)).toEqual(graph.nodes.map((n) => n.id));
    expect(display.nodes.map((n) => n.sourceId)).toEqual(graph.nodes.map((n) => n.id));
    expect(display.nodes.map((n) => n.displayLabel)).toEqual(graph.nodes.map((n) => n.label));
  });

  it("giữ nguyên node gốc chứ không sao chép từng field", () => {
    const graph = loadGolden("d-confidence-route");
    const display = toDisplayGraph(graph);
    for (const [i, dn] of display.nodes.entries()) {
      // Cùng tham chiếu: không có chỗ nào để field bị rơi khi schema thêm field mới.
      expect(dn.node).toBe(graph.nodes[i]);
    }
  });

  it("chưa đánh dấu back edge nào - đó là việc của markBackEdges", () => {
    const display = toDisplayGraph(loadGolden("c-loops-scan"));
    expect(display.edges.filter((e) => e.isBackEdge)).toHaveLength(0);
  });

  it("giữ warnings và tên hàm", () => {
    const graph = loadGolden("d-confidence-route");
    const display = toDisplayGraph(graph);
    expect(display.warnings).toEqual(graph.warnings);
    expect(display.functionName).toBe("route");
  });
});
