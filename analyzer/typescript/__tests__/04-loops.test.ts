import { describe, expect, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph, node } from "./helpers/graph";

const FILE = "04-loops.ts";

// LƯU Ý: nhãn "loop-back" đã bị bỏ (SEMANTICS §4). Cạnh quay về đầu vòng lặp mang
// label null nếu nguồn là statement, hoặc true/false nếu nguồn là node điều kiện.
// Cấu trúc vòng lặp được kiểm bằng `backEdges` - suy ra bằng DFS.
describe("vòng lặp", () => {
  it("for cổ điển: header (kể cả init) nằm trong MỘT node loop", () => {
    const g = analyzeFixture(FILE, "sumTo");

    expectGraph(g, {
      nodeCount: 6,
      edgeCount: 6,
      kinds: { entry: 1, statement: 2, loop: 1, return: 1, exit: 1, condition: 0 },
      edges: [
        ["entry", "none", "statement:let total = 0"],
        ["statement:let total = 0", "none", "loop:for (let i = 0; i < n; i++)"],
        ["loop:for (let i = 0; i < n; i++)", "true", "statement:total += i"],
        ["statement:total += i", "none", "loop:for (let i = 0; i < n; i++)"],
        ["loop:for (let i = 0; i < n; i++)", "false", "return:return total"],
        ["return:return total", "none", "exit"],
      ],
      backEdges: 1,
      warningCount: 0,
    });

    const loop = node(g, "loop");
    expect(loop.code).toContain("let i = 0");
    expect(loop.code).toContain("i < n");
  });

  it("for-of", () => {
    const g = analyzeFixture(FILE, "joinNames");

    expectGraph(g, {
      nodeCount: 6,
      edgeCount: 6,
      kinds: { entry: 1, statement: 2, loop: 1, return: 1, exit: 1 },
      edges: [
        ["statement:let out", "none", "loop:for (const name of names)"],
        ["loop:for (const name of names)", "true", "statement:out += name"],
        ["statement:out += name", "none", "loop:for (const name of names)"],
        ["loop:for (const name of names)", "false", "return:return out"],
      ],
      backEdges: 1,
      warningCount: 0,
    });
  });

  it("for-in", () => {
    const g = analyzeFixture(FILE, "keysOf");

    expectGraph(g, {
      nodeCount: 6,
      edgeCount: 6,
      kinds: { entry: 1, statement: 2, loop: 1, return: 1, exit: 1 },
      edges: [
        ["statement:const keys", "none", "loop:for (const key in obj)"],
        ["loop:for (const key in obj)", "true", "statement:keys.push(key)"],
        ["statement:keys.push(key)", "none", "loop:for (const key in obj)"],
        ["loop:for (const key in obj)", "false", "return:return keys"],
      ],
      backEdges: 1,
      warningCount: 0,
    });
  });

  it("while: thân nhiều statement vẫn gộp thành một node", () => {
    const g = analyzeFixture(FILE, "countdown");

    expectGraph(g, {
      nodeCount: 6,
      edgeCount: 6,
      kinds: { entry: 1, statement: 2, loop: 1, return: 1, exit: 1 },
      edges: [
        ["statement:let steps = 0", "none", "loop:while (n > 0)"],
        ["loop:while (n > 0)", "true", "statement:n -= 1"],
        ["statement:n -= 1", "none", "loop:while (n > 0)"],
        ["loop:while (n > 0)", "false", "return:return steps"],
      ],
      backEdges: 1,
      warningCount: 0,
    });

    const body = node(g, "statement:n -= 1");
    expect(body.code).toContain("steps += 1");
  });

  it("do-while: thân chạy TRƯỚC điều kiện, cạnh ngược là edge true của điều kiện", () => {
    const g = analyzeFixture(FILE, "atLeastOnce");

    expectGraph(g, {
      nodeCount: 6,
      edgeCount: 6,
      kinds: { entry: 1, statement: 2, loop: 1, return: 1, exit: 1 },
      edges: [
        ["entry", "none", "statement:let steps = 0"],
        // vào thẳng thân, không qua điều kiện
        ["statement:let steps = 0", "none", "statement:n -= 1"],
        ["statement:n -= 1", "none", "loop:while (n > 0)"],
        // điều kiện nằm ở cuối -> edge true của nó chính là cạnh ngược
        ["loop:while (n > 0)", "true", "statement:n -= 1"],
        ["loop:while (n > 0)", "false", "return:return steps"],
        ["return:return steps", "none", "exit"],
      ],
      absentEdges: [["statement:let steps = 0", "loop:while (n > 0)"]],
      backEdges: 1,
      warningCount: 0,
    });
  });

  it("while (true): không có edge false, chỉ thoát bằng break", () => {
    const g = analyzeFixture(FILE, "drainQueue");

    expectGraph(g, {
      nodeCount: 9,
      edgeCount: 9,
      kinds: { entry: 1, statement: 3, loop: 1, condition: 1, break: 1, return: 1, exit: 1 },
      edges: [
        ["entry", "none", "statement:let handled = 0"],
        ["statement:let handled = 0", "none", "loop:while (true)"],
        ["loop:while (true)", "true", "statement:const item = queue.pop()"],
        ["statement:const item = queue.pop()", "none", 'condition:item === "stop"'],
        ['condition:item === "stop"', "true", "break"],
        ["break", "none", "return:return handled"],
        ['condition:item === "stop"', "false", "statement:handled += 1;"],
        ["statement:handled += 1;", "none", "loop:while (true)"],
        ["return:return handled", "none", "exit"],
      ],
      absentEdges: [
        // vòng lặp vô hạn tường minh: KHÔNG có nhánh false
        ["loop:while (true)", "return:return handled"],
      ],
      backEdges: 1,
      warningCount: 0,
    });
  });
});
