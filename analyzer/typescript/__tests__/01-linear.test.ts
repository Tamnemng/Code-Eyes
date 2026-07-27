import { describe, expect, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph, node } from "./helpers/graph";

const FILE = "01-linear.ts";

describe("statement tuyến tính", () => {
  it("gộp chuỗi statement không rẽ nhánh thành MỘT node", () => {
    const g = analyzeFixture(FILE, "computeTotal");

    expectGraph(g, {
      nodeCount: 4,
      edgeCount: 3,
      kinds: { entry: 1, statement: 1, return: 1, exit: 1, condition: 0, loop: 0, call: 0 },
      edges: [
        ["entry", "none", "statement:const count = items.length"],
        ["statement:const count = items.length", "none", "return:return total"],
        ["return:return total", "none", "exit"],
      ],
      warningCount: 0,
    });

    // node gộp phải giữ nguyên source của cả 5 statement
    const merged = node(g, "statement");
    expect(merged.code).toContain("const count = items.length");
    expect(merged.code).toContain("console.log(label, total)");
    expect(merged.confidence).toBe("certain");
    expect(merged.range.startLine).toBeLessThan(merged.range.endLine);
  });

  it("hàm không có return -> edge ngầm tới exit", () => {
    const g = analyzeFixture(FILE, "logOnly");

    expectGraph(g, {
      nodeCount: 3,
      edgeCount: 2,
      kinds: { entry: 1, statement: 1, exit: 1, return: 0 },
      edges: [
        ["entry", "none", "statement:const greeting"],
        ["statement:const greeting", "none", "exit"],
      ],
      warningCount: 0,
    });
  });

  it("thân hàm rỗng -> chỉ entry và exit", () => {
    const g = analyzeFixture(FILE, "noop");

    expectGraph(g, {
      nodeCount: 2,
      edgeCount: 1,
      kinds: { entry: 1, exit: 1, statement: 0 },
      edges: [["entry", "none", "exit"]],
      warningCount: 0,
    });
  });
});
