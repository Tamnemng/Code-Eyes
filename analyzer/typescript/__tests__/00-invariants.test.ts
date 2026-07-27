import { describe, expect, it } from "vitest";

import { analyzeFixture, readFixture } from "./helpers/analyze";
import { CATALOG, cursorToken } from "./helpers/catalog";
import { backEdges, countKind, cycleNodes, dumpGraph, matchNodes } from "./helpers/graph";
import type { FlowGraph, FlowNode } from "../../../shared/types";

const KINDS_ALLOWED_TO_CARRY_CONDITION = new Set(["condition", "switch-case", "loop"]);

function ids(nodes: FlowNode[]): Set<string> {
  return new Set(nodes.map((n) => n.id));
}

function reachableFromEntry(graph: FlowGraph): Set<string> {
  const entry = graph.nodes.find((n) => n.kind === "entry");
  if (!entry) return new Set();
  const out = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = out.get(e.from);
    if (list) list.push(e.to);
    else out.set(e.from, [e.to]);
  }
  const seen = new Set<string>([entry.id]);
  const stack = [entry.id];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const next of out.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

// Bất biến áp dụng cho MỌI graph - chạy trên toàn bộ fixture catalog.
describe.each(CATALOG)("invariants: $file :: $fn", (testCase) => {
  const { file, fn, allowUnreachable = [], allowAcyclicLoop = false } = testCase;
  const graph = (): FlowGraph => analyzeFixture(file, cursorToken(testCase));

  it("gắn đúng metadata của hàm", () => {
    const g = graph();
    expect(g.functionName).toBe(fn);
    expect(g.language).toBe("typescript");
    expect(g.filePath.replace(/\\/g, "/")).toContain(`fixtures/${file}`);
  });

  it("có đúng một entry và một exit", () => {
    const g = graph();
    expect(g.nodes.filter((n) => n.kind === "entry"), dumpGraph(g)).toHaveLength(1);
    expect(g.nodes.filter((n) => n.kind === "exit"), dumpGraph(g)).toHaveLength(1);
  });

  it("entry không có edge vào, exit không có edge ra", () => {
    const g = graph();
    const entry = g.nodes.find((n) => n.kind === "entry") as FlowNode;
    const exit = g.nodes.find((n) => n.kind === "exit") as FlowNode;
    expect(g.edges.filter((e) => e.to === entry.id), dumpGraph(g)).toHaveLength(0);
    expect(g.edges.filter((e) => e.from === exit.id), dumpGraph(g)).toHaveLength(0);
  });

  it("id duy nhất và đúng định dạng n_<số>", () => {
    const g = graph();
    const seen = new Set<string>();
    for (const n of g.nodes) {
      expect(n.id, dumpGraph(g)).toMatch(/^n_\d+$/);
      expect(seen.has(n.id), `id trùng: ${n.id}\n${dumpGraph(g)}`).toBe(false);
      seen.add(n.id);
    }
  });

  it("mọi đầu mút của edge đều tồn tại", () => {
    const g = graph();
    const known = ids(g.nodes);
    for (const e of g.edges) {
      expect(known.has(e.from), `edge.from lạ: ${e.from}\n${dumpGraph(g)}`).toBe(true);
      expect(known.has(e.to), `edge.to lạ: ${e.to}\n${dumpGraph(g)}`).toBe(true);
    }
  });

  it("không có edge trùng lặp (cùng from/to/label)", () => {
    const g = graph();
    const seen = new Set<string>();
    for (const e of g.edges) {
      const key = `${e.from}->${e.to}:${e.label ?? ""}`;
      expect(seen.has(key), `edge trùng: ${key}\n${dumpGraph(g)}`).toBe(false);
      seen.add(key);
    }
  });

  it("mọi node đều đến được từ entry (trừ node unreachable đã khai báo)", () => {
    const g = graph();
    const reachable = reachableFromEntry(g);
    const exempt = ids(allowUnreachable.flatMap((m) => matchNodes(g, m)));
    for (const n of g.nodes) {
      if (exempt.has(n.id)) continue;
      expect(reachable.has(n.id), `node không đến được từ entry: ${n.id} ${n.label}\n${dumpGraph(g)}`).toBe(true);
    }
  });

  it("mọi node không phải exit đều có edge ra (trừ node unreachable đã khai báo)", () => {
    const g = graph();
    const withOutgoing = new Set(g.edges.map((e) => e.from));
    const exempt = ids(allowUnreachable.flatMap((m) => matchNodes(g, m)));
    for (const n of g.nodes) {
      if (n.kind === "exit" || exempt.has(n.id)) continue;
      expect(withOutgoing.has(n.id), `node cụt: ${n.id} ${n.kind} ${n.label}\n${dumpGraph(g)}`).toBe(true);
    }
  });

  it("KHÔNG emit nhãn loop-back (back edge phải suy ra bằng DFS)", () => {
    const g = graph();
    const offenders = g.edges.filter((e) => e.label === "loop-back");
    expect(offenders, `SEMANTICS §4: nhãn loop-back bị cấm\n${dumpGraph(g)}`).toHaveLength(0);
  });

  it("cấu trúc vòng lặp suy ra được: mỗi loop nằm trên chu trình, không có chu trình mồ côi", () => {
    const g = graph();
    const loops = g.nodes.filter((n) => n.kind === "loop").map((n) => n.id);
    const back = backEdges(g);
    const cycles = back.map((e) => cycleNodes(g, e));

    // Thân vòng lặp không bao giờ hoàn thành bình thường thì KHÔNG có cạnh ngược, và đó
    // là kết quả đúng (SEMANTICS §4). Chỉ những case khai báo tường minh được miễn.
    if (!allowAcyclicLoop) {
      expect(
        back.length,
        `Số cạnh ngược (${back.length}) phải >= số vòng lặp (${loops.length})\n${dumpGraph(g)}`,
      ).toBeGreaterThanOrEqual(countKind(g, "loop"));

      for (const loopId of loops) {
        expect(
          cycles.some((c) => c.has(loopId)),
          `Vòng lặp ${loopId} không nằm trên chu trình nào - cạnh ngược đã mất\n${dumpGraph(g)}`,
        ).toBe(true);
      }
    }

    for (const [i, cycle] of cycles.entries()) {
      const e = back[i] as (typeof back)[number];
      expect(
        loops.some((id) => cycle.has(id)),
        `Chu trình mồ côi (không có node loop): ${e.from} -> ${e.to}\n${dumpGraph(g)}`,
      ).toBe(true);
    }
  });

  it("range truy vết được về source thật", () => {
    const g = graph();
    const lineCount = readFixture(file).split("\n").length;
    for (const n of g.nodes) {
      const r = n.range;
      expect(r.startLine, `${n.id} startLine`).toBeGreaterThanOrEqual(1);
      expect(r.endLine, `${n.id} endLine`).toBeLessThanOrEqual(lineCount);
      expect(r.endLine, `${n.id} endLine >= startLine`).toBeGreaterThanOrEqual(r.startLine);
      expect(r.startCol, `${n.id} startCol`).toBeGreaterThanOrEqual(0);
      expect(r.endCol, `${n.id} endCol`).toBeGreaterThanOrEqual(0);
      if (r.startLine === r.endLine) {
        expect(r.endCol, `${n.id} endCol >= startCol trên cùng dòng`).toBeGreaterThanOrEqual(r.startCol);
      }
    }
  });

  it("confidence hợp lệ và parsed chỉ nằm trên node điều kiện", () => {
    const g = graph();
    for (const n of g.nodes) {
      expect(["certain", "unknown"]).toContain(n.confidence);
      if (n.condition !== undefined) {
        expect(
          KINDS_ALLOWED_TO_CARRY_CONDITION.has(n.kind),
          `node kind="${n.kind}" không được mang condition\n${dumpGraph(g)}`,
        ).toBe(true);
        expect(n.condition.raw.length, `${n.id} condition.raw rỗng`).toBeGreaterThan(0);
      }
      if (n.kind === "condition") {
        expect(n.condition, `node condition thiếu field condition\n${dumpGraph(g)}`).toBeDefined();
      }
    }
  });

  it("parentId trỏ tới node có thật và không tự trỏ vào mình", () => {
    const g = graph();
    const known = ids(g.nodes);
    for (const n of g.nodes) {
      if (n.parentId === undefined) continue;
      expect(known.has(n.parentId), `parentId lạ: ${n.parentId}\n${dumpGraph(g)}`).toBe(true);
      expect(n.parentId).not.toBe(n.id);
    }
  });

  it("node có code (trừ exit) và warnings là chuỗi không rỗng", () => {
    const g = graph();
    for (const n of g.nodes) {
      if (n.kind === "exit") continue;
      expect(n.code.length, `${n.id} ${n.kind} code rỗng\n${dumpGraph(g)}`).toBeGreaterThan(0);
      expect(n.label.length, `${n.id} ${n.kind} label rỗng\n${dumpGraph(g)}`).toBeGreaterThan(0);
    }
    for (const w of g.warnings) {
      expect(typeof w).toBe("string");
      expect(w.length).toBeGreaterThan(0);
    }
  });

  it("deterministic: phân tích hai lần cho kết quả giống hệt", () => {
    expect(graph()).toEqual(graph());
  });
});
