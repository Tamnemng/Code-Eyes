import { describe, expect, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph, node } from "./helpers/graph";

const FILE = "10-async-await.ts";

describe("async / await", () => {
  it("await là statement thường, KHÔNG tạo nhánh", () => {
    const g = analyzeFixture(FILE, "fetchLabel");

    expectGraph(g, {
      nodeCount: 6,
      edgeCount: 6,
      kinds: { entry: 1, statement: 1, condition: 1, return: 2, exit: 1, call: 0 },
      edges: [
        ["entry", "none", "statement:const url"],
        ["statement:const url", "none", 'condition:data.kind === "ok"'],
        ['condition:data.kind === "ok"', "true", "return:return data.label"],
        ['condition:data.kind === "ok"', "false", 'return:"none"'],
        ["return:return data.label", "none", "exit"],
        ['return:"none"', "none", "exit"],
      ],
      warningCount: 0,
    });

    // cả ba statement (2 cái có await) vẫn gộp chung một node
    const merged = node(g, "statement");
    expect(merged.code).toContain("await fetch(url)");
    expect(merged.code).toContain("await res.json()");
    expect(merged.confidence).toBe("certain");

    // property access vẫn parse được thành variable
    const cond = node(g, "condition");
    expect(cond.condition?.parsed).toEqual({
      variable: "data.kind",
      operator: "==",
      value: "ok",
    });
  });

  it("for await ... of xử lý như for-of", () => {
    const g = analyzeFixture(FILE, "sumAll");

    expectGraph(g, {
      nodeCount: 6,
      edgeCount: 6,
      kinds: { entry: 1, statement: 2, loop: 1, return: 1, exit: 1, condition: 0 },
      edges: [
        ["statement:let total = 0", "none", "loop:for await (const chunk of load(ids))"],
        ["loop:for await (const chunk of load(ids))", "true", "statement:total += chunk.size"],
        ["statement:total += chunk.size", "none", "loop:for await (const chunk of load(ids))"],
        ["loop:for await (const chunk of load(ids))", "false", "return:return total"],
      ],
      backEdges: 1,
      warningCount: 0,
    });
  });
});
