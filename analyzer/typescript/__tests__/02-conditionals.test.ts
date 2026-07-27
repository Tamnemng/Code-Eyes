import { describe, expect, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph, node } from "./helpers/graph";

const FILE = "02-conditionals.ts";

describe("if / if-else / else-if", () => {
  it("if không có else: edge false đi thẳng tới statement kế tiếp", () => {
    const g = analyzeFixture(FILE, "classifyPositive");

    expectGraph(g, {
      nodeCount: 6,
      edgeCount: 6,
      kinds: { entry: 1, statement: 1, condition: 1, return: 2, exit: 1 },
      edges: [
        ["entry", "none", "statement:const kind"],
        ["statement:const kind", "none", "condition:n > 0"],
        ["condition:n > 0", "true", 'return:"positive"'],
        ["condition:n > 0", "false", 'return:"non-positive"'],
        ['return:"positive"', "none", "exit"],
        ['return:"non-positive"', "none", "exit"],
      ],
      warningCount: 0,
    });

    // `n > 0` là so sánh số -> không parse được
    const cond = node(g, "condition:n > 0");
    expect(cond.condition?.raw).toBe("n > 0");
    expect(cond.condition?.parsed).toBeUndefined();
    expect(cond.confidence).toBe("unknown");
  });

  it("if-else: hai nhánh hội tụ vào node kế tiếp", () => {
    const g = analyzeFixture(FILE, "pickBranch");

    expectGraph(g, {
      nodeCount: 7,
      edgeCount: 7,
      kinds: { entry: 1, statement: 3, condition: 1, return: 1, exit: 1 },
      edges: [
        ["entry", "none", "statement:let out"],
        ["statement:let out", "none", 'condition:flag === "yes"'],
        ['condition:flag === "yes"', "true", 'statement:out = "accepted"'],
        ['condition:flag === "yes"', "false", 'statement:out = "rejected"'],
        ['statement:out = "accepted"', "none", "return:return out"],
        ['statement:out = "rejected"', "none", "return:return out"],
        ["return:return out", "none", "exit"],
      ],
      warningCount: 0,
    });

    const cond = node(g, 'condition:flag === "yes"');
    expect(cond.condition?.parsed).toEqual({ variable: "flag", operator: "==", value: "yes" });
    expect(cond.confidence).toBe("certain");
  });

  it("else-if lồng nhau: KHÔNG tạo node riêng cho khối else", () => {
    const g = analyzeFixture(FILE, "grade");

    expectGraph(g, {
      nodeCount: 9,
      edgeCount: 11,
      kinds: { entry: 1, condition: 3, return: 4, exit: 1, statement: 0 },
      edges: [
        ["entry", "none", "condition:score >= 90"],
        ["condition:score >= 90", "true", 'condition:bonus === "gold"'],
        ['condition:bonus === "gold"', "true", 'return:"A+"'],
        ['condition:bonus === "gold"', "false", 'return:"A"'],
        // edge false của if ngoài trỏ THẲNG vào điều kiện của else-if
        ["condition:score >= 90", "false", "condition:score >= 80"],
        ["condition:score >= 80", "true", 'return:"B"'],
        ["condition:score >= 80", "false", 'return:"C"'],
        ['return:"A+"', "none", "exit"],
        ['return:"A"', "none", "exit"],
        ['return:"B"', "none", "exit"],
        ['return:"C"', "none", "exit"],
      ],
      warningCount: 0,
    });
  });
});
