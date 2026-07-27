import { describe, expect, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph, node } from "./helpers/graph";

const FILE = "03-ternary.ts";

describe("toán tử ba ngôi", () => {
  it("tạo node condition + một node cho mỗi nhánh, rồi hội tụ", () => {
    const g = analyzeFixture(FILE, "pickColor");

    expectGraph(g, {
      nodeCount: 6,
      edgeCount: 6,
      kinds: { entry: 1, condition: 1, statement: 2, return: 1, exit: 1 },
      edges: [
        ["entry", "none", 'condition:kind === "urgent"'],
        ['condition:kind === "urgent"', "true", 'statement:"RED"'],
        ['condition:kind === "urgent"', "false", 'statement:"GRAY"'],
        ['statement:"RED"', "none", "return:return color"],
        ['statement:"GRAY"', "none", "return:return color"],
        ["return:return color", "none", "exit"],
      ],
      warningCount: 0,
    });

    const cond = node(g, "condition");
    expect(cond.condition?.parsed).toEqual({ variable: "kind", operator: "==", value: "urgent" });
    expect(cond.confidence).toBe("certain");
  });

  it("ba ngôi lồng nhau: mỗi tầng một node condition", () => {
    const g = analyzeFixture(FILE, "pickSize");

    expectGraph(g, {
      nodeCount: 8,
      edgeCount: 9,
      kinds: { entry: 1, condition: 2, statement: 3, return: 1, exit: 1 },
      edges: [
        ["entry", "none", "condition:n > 10"],
        ["condition:n > 10", "true", 'statement:"big"'],
        ["condition:n > 10", "false", "condition:n > 5"],
        ["condition:n > 5", "true", 'statement:"mid"'],
        ["condition:n > 5", "false", 'statement:"small"'],
        ['statement:"big"', "none", "return:return size"],
        ['statement:"mid"', "none", "return:return size"],
        ['statement:"small"', "none", "return:return size"],
        ["return:return size", "none", "exit"],
      ],
      warningCount: 0,
    });
  });

  it("statement chứa ba ngôi bị tách khỏi cụm tuyến tính", () => {
    const g = analyzeFixture(FILE, "describeCount");

    expectGraph(g, {
      nodeCount: 8,
      edgeCount: 8,
      kinds: { entry: 1, condition: 1, statement: 4, return: 1, exit: 1 },
      edges: [
        ["entry", "none", 'statement:const prefix = "item"'],
        ['statement:const prefix = "item"', "none", "condition:count > 1"],
        ["condition:count > 1", "true", 'statement:"many"'],
        ["condition:count > 1", "false", 'statement:"one"'],
        ['statement:"many"', "none", "statement:const out = prefix + suffix"],
        ['statement:"one"', "none", "statement:const out = prefix + suffix"],
        ["statement:const out = prefix + suffix", "none", "return:return out"],
        ["return:return out", "none", "exit"],
      ],
      warningCount: 0,
    });
  });
});
