import { describe, expect, it } from "vitest";

import { markBackEdges } from "../model/back-edges";
import { toDisplayGraph } from "../model/display-graph";
import { loadGolden } from "./helpers/golden";

function backEdgesOf(name: string): ReadonlyArray<{ from: string; to: string }> {
  const marked = markBackEdges(toDisplayGraph(loadGolden(name)));
  return marked.edges.filter((e) => e.isBackEdge).map((e) => ({ from: e.from, to: e.to }));
}

describe("markBackEdges - ba case biên SEMANTICS §4", () => {
  it("scan: NHIỀU cạnh ngược = 1 đường chảy cuối thân + 2 continue nhắm header", () => {
    expect(backEdgesOf("c-loops-scan")).toHaveLength(3);
  });

  it("drain: do-while có ĐÚNG 1 cạnh ngược, và nó KHÔNG xuất phát từ node loop", () => {
    const graph = loadGolden("c-loops-drain");
    const back = backEdgesOf("c-loops-drain");
    expect(back).toHaveLength(1);

    // Header chu trình của do-while là node ĐẦU THÂN, không phải node `loop` (ở cuối).
    // Cạnh ngược vì thế là edge `true` CỦA node loop trỏ về đầu thân.
    const loop = graph.nodes.find((n) => n.kind === "loop");
    if (loop === undefined) throw new Error("golden drain phải có node loop");
    expect(back[0]?.from).toBe(loop.id);
  });

  it("bailOut: thân không hoàn thành bình thường -> 0 cạnh ngược, không crash", () => {
    // SEMANTICS §4: `for { try { break outer } finally {} }` - thân chạy tối đa một lần.
    // Bất biến "mỗi loop nằm trên một chu trình" GÃY ở đây và đó là kết quả đúng.
    const graph = loadGolden("c-loops-bailOut");
    expect(graph.nodes.filter((n) => n.kind === "loop")).toHaveLength(1);
    expect(backEdgesOf("c-loops-bailOut")).toHaveLength(0);
  });

  it("everything: loop có 1 continue -> 2 cạnh ngược", () => {
    expect(backEdgesOf("e-all-kinds-everything")).toHaveLength(2);
  });
});

describe("markBackEdges - tính chất chung", () => {
  const NAMES = [
    "a-finally-fanout-shipOrder",
    "b-nested-regions-pipeline",
    "c-loops-scan",
    "c-loops-drain",
    "c-loops-bailOut",
    "d-confidence-route",
    "e-all-kinds-everything",
  ] as const;

  it.each(NAMES)("%s: không thêm/bớt node hay edge, chỉ gắn cờ", (name) => {
    const display = toDisplayGraph(loadGolden(name));
    const marked = markBackEdges(display);
    expect(marked.nodes).toEqual(display.nodes);
    expect(marked.edges.map((e) => `${e.from}->${e.to}:${e.label ?? ""}`)).toEqual(
      display.edges.map((e) => `${e.from}->${e.to}:${e.label ?? ""}`),
    );
  });

  it.each(NAMES)("%s: không đột biến input", (name) => {
    const display = toDisplayGraph(loadGolden(name));
    const before = JSON.stringify(display.edges);
    markBackEdges(display);
    expect(JSON.stringify(display.edges)).toBe(before);
  });

  it("graph không có vòng lặp thì không có cạnh ngược", () => {
    expect(backEdgesOf("d-confidence-route")).toHaveLength(0);
    expect(backEdgesOf("a-finally-fanout-shipOrder")).toHaveLength(0);
  });

  it("số cạnh ngược >= số node loop, trừ case acyclic đã khai báo", () => {
    for (const name of ["c-loops-scan", "c-loops-drain", "e-all-kinds-everything"] as const) {
      const graph = loadGolden(name);
      const loops = graph.nodes.filter((n) => n.kind === "loop").length;
      expect(backEdgesOf(name).length, name).toBeGreaterThanOrEqual(loops);
    }
  });

  it("mọi cạnh ngược đều nằm trên một chu trình thật (đích đến được nguồn)", () => {
    for (const name of ["c-loops-scan", "c-loops-drain", "e-all-kinds-everything"] as const) {
      const display = toDisplayGraph(loadGolden(name));
      const adj = new Map<string, string[]>(display.nodes.map((n) => [n.id, []]));
      for (const e of display.edges) adj.get(e.from)?.push(e.to);

      for (const back of markBackEdges(display).edges.filter((e) => e.isBackEdge)) {
        const seen = new Set<string>([back.to]);
        const stack = [back.to];
        while (stack.length > 0) {
          for (const next of adj.get(stack.pop() as string) ?? []) {
            if (seen.has(next)) continue;
            seen.add(next);
            stack.push(next);
          }
        }
        expect(seen.has(back.from), `${name}: ${back.from}->${back.to} không trên chu trình`).toBe(
          true,
        );
      }
    }
  });
});
