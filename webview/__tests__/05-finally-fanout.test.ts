import { describe, expect, it } from "vitest";

import type { DisplayGraph } from "../model/display-graph";
import { toDisplayGraph } from "../model/display-graph";
import { fanoutFinallyRegions } from "../model/finally-fanout";
import { loadGolden } from "./helpers/golden";

const NAMES = [
  "a-finally-fanout-shipOrder",
  "b-nested-regions-pipeline",
  "c-loops-scan",
  "c-loops-drain",
  "c-loops-bailOut",
  "d-confidence-route",
  "e-all-kinds-everything",
] as const;

function plain(name: string): DisplayGraph {
  return toDisplayGraph(loadGolden(name));
}

/** Tập cặp `(sourceId_from, sourceId_to)` đã khử trùng lặp. */
function sourcePairs(graph: DisplayGraph): Set<string> {
  const bySourceId = new Map(graph.nodes.map((n) => [n.id, n.sourceId]));
  return new Set(
    graph.edges.map((e) => `${bySourceId.get(e.from) ?? e.from}->${bySourceId.get(e.to) ?? e.to}`),
  );
}

/** Tập sourceId đến được từ entry, đi theo edge của chính graph đó. */
function reachableSourceIds(graph: DisplayGraph): Set<string> {
  const bySourceId = new Map(graph.nodes.map((n) => [n.id, n.sourceId]));
  const adj = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) adj.get(e.from)?.push(e.to);

  const entry = graph.nodes.find((n) => n.node.kind === "entry");
  if (entry === undefined) throw new Error("graph không có entry");

  const seen = new Set<string>([entry.id]);
  const stack = [entry.id];
  while (stack.length > 0) {
    for (const next of adj.get(stack.pop() as string) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return new Set([...seen].map((id) => bySourceId.get(id) ?? id));
}

describe("fanoutFinallyRegions - BA BẤT BIẾN 'thuần trình bày' (TODO.md mục 3)", () => {
  it.each(NAMES)("%s: chiếu về sourceId cho ĐÚNG tập cặp edge gốc", (name) => {
    // Phát biểu đúng là ĐẲNG THỨC TẬP HỢP, không phải "bảo toàn số edge": số edge TĂNG,
    // và phải tăng - đó là bản chất của việc tách hub.
    const before = plain(name);
    expect(sourcePairs(fanoutFinallyRegions(before))).toEqual(sourcePairs(before));
  });

  it.each(NAMES)("%s: reachability từ entry theo sourceId không đổi", (name) => {
    const before = plain(name);
    expect(reachableSourceIds(fanoutFinallyRegions(before))).toEqual(reachableSourceIds(before));
  });

  it.each(NAMES)("%s: round-trip - gộp theo sourceId tái tạo đúng input", (name) => {
    const before = plain(name);
    const after = fanoutFinallyRegions(before);
    expect(new Set(after.nodes.map((n) => n.sourceId))).toEqual(
      new Set(before.nodes.map((n) => n.sourceId)),
    );
    expect(sourcePairs(after)).toEqual(sourcePairs(before));
    expect(after.warnings).toEqual(before.warnings);
  });

  it.each(NAMES)("%s: mỗi sourceId ánh xạ về đúng một FlowNode", (name) => {
    const after = fanoutFinallyRegions(plain(name));
    const seen = new Map<string, unknown>();
    for (const n of after.nodes) {
      const prev = seen.get(n.sourceId);
      if (prev !== undefined) expect(n.node).toBe(prev);
      seen.set(n.sourceId, n.node);
    }
  });

  it.each(NAMES)("%s: id hiển thị là duy nhất, edge chỉ nối id có thật", (name) => {
    const after = fanoutFinallyRegions(plain(name));
    const ids = after.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(ids);
    for (const e of after.edges) {
      expect(known.has(e.from), `${name}: from ${e.from}`).toBe(true);
      expect(known.has(e.to), `${name}: to ${e.to}`).toBe(true);
    }
  });

  it.each(NAMES)("%s: không đột biến input", (name) => {
    const before = plain(name);
    const snapshot = JSON.stringify(before);
    fanoutFinallyRegions(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("fanoutFinallyRegions - nhân bản CẢ VÙNG, không chỉ marker", () => {
  it("shipOrder: 5 cạnh vào -> 5 bản sao vùng, mỗi bản 1 cạnh vào", () => {
    const after = fanoutFinallyRegions(plain("a-finally-fanout-shipOrder"));
    const markers = after.nodes.filter((n) => n.node.kind === "finally");
    expect(markers).toHaveLength(5);

    const inbound = new Map<string, number>();
    for (const e of after.edges) inbound.set(e.to, (inbound.get(e.to) ?? 0) + 1);
    for (const m of markers) expect(inbound.get(m.id), m.id).toBe(1);
  });

  it("shipOrder: THÂN vùng cũng được nhân bản - nếu không, hub chỉ tụt xuống một node", () => {
    // `n_13` là `console.log("audit");`, parentId trỏ về marker `n_5`. Nhân bản marker mà
    // để 5 bản sao cùng trỏ vào một `n_13` thì không giải quyết gì.
    const after = fanoutFinallyRegions(plain("a-finally-fanout-shipOrder"));
    const bodies = after.nodes.filter((n) => n.sourceId === "n_13");
    expect(bodies).toHaveLength(5);

    const inbound = new Map<string, number>();
    for (const e of after.edges) inbound.set(e.to, (inbound.get(e.to) ?? 0) + 1);
    for (const b of bodies) expect(inbound.get(b.id), b.id).toBe(1);
  });

  it("shipOrder: mỗi bản sao thân GIỮ CẢ 2 cạnh ra - over-approximation §7 được bảo toàn", () => {
    const after = fanoutFinallyRegions(plain("a-finally-fanout-shipOrder"));
    const outbound = new Map<string, number>();
    for (const e of after.edges) outbound.set(e.from, (outbound.get(e.from) ?? 0) + 1);
    for (const b of after.nodes.filter((n) => n.sourceId === "n_13")) {
      expect(outbound.get(b.id), b.id).toBe(2);
    }
  });

  it("nhãn bản sao dạng `finally (k/n)` theo §14.2", () => {
    const after = fanoutFinallyRegions(plain("a-finally-fanout-shipOrder"));
    const labels = after.nodes
      .filter((n) => n.node.kind === "finally")
      .map((n) => n.displayLabel)
      .sort();
    expect(labels).toEqual([
      "finally (1/5)",
      "finally (2/5)",
      "finally (3/5)",
      "finally (4/5)",
      "finally (5/5)",
    ]);
  });

  it.each(NAMES)("%s: MỌI bản sao marker có đúng 1 cạnh vào - hub đã tách hết", (name) => {
    // Bất biến này là định nghĩa của "fanout đã làm xong việc", và nó không phụ thuộc con
    // số in-degree cụ thể (vùng lồng nhau làm in-degree đổi khi vùng trong fanout trước).
    const after = fanoutFinallyRegions(plain(name));
    const inbound = new Map<string, number>();
    for (const e of after.edges) inbound.set(e.to, (inbound.get(e.to) ?? 0) + 1);
    for (const m of after.nodes.filter((n) => n.node.kind === "finally")) {
      expect(inbound.get(m.id), `${name}/${m.id} (${m.displayLabel})`).toBe(1);
    }
  });

  it("graph không có finally thì không đổi gì", () => {
    for (const name of ["c-loops-scan", "c-loops-drain", "d-confidence-route"] as const) {
      const before = plain(name);
      const after = fanoutFinallyRegions(before);
      expect(after.nodes.map((n) => n.id), name).toEqual(before.nodes.map((n) => n.id));
      expect(after.edges.length, name).toBe(before.edges.length);
    }
  });
});

describe("fanoutFinallyRegions - vùng lồng nhau", () => {
  it("pipeline: thân đi theo vùng của nó - số bản sao thân = số bản sao marker", () => {
    const after = fanoutFinallyRegions(plain("b-nested-regions-pipeline"));
    // n_7 = marker finally TRONG, n_13 = thân của nó (parentId = n_7).
    const markers = after.nodes.filter((n) => n.sourceId === "n_7").length;
    const bodies = after.nodes.filter((n) => n.sourceId === "n_13").length;
    expect(markers).toBeGreaterThan(1);
    expect(bodies).toBe(markers);
  });

  it("pipeline: vùng NGOÀI fanout theo in-degree SAU khi vùng trong đã fanout", () => {
    // Xử lý tuần tự: vùng trong nhân trước, k bản sao thân của nó đều trỏ vào marker ngoài
    // -> in-degree của marker ngoài TĂNG, và số bản sao của nó tăng theo. Đây là tăng
    // trưởng nhân, có chủ ý ghi lại (TODO.md 3b) chứ không phải bug.
    const before = plain("b-nested-regions-pipeline");
    const after = fanoutFinallyRegions(before);

    const inboundBefore = new Map<string, number>();
    for (const e of before.edges) inboundBefore.set(e.to, (inboundBefore.get(e.to) ?? 0) + 1);

    const outerCopies = after.nodes.filter((n) => n.sourceId === "n_5").length;
    expect(outerCopies).toBeGreaterThan(inboundBefore.get("n_5") ?? 0);
  });

  it("pipeline: dù nhân nhiều tầng, ba bất biến vẫn giữ", () => {
    const before = plain("b-nested-regions-pipeline");
    const after = fanoutFinallyRegions(before);
    expect(sourcePairs(after)).toEqual(sourcePairs(before));
    expect(reachableSourceIds(after)).toEqual(reachableSourceIds(before));
  });
});
