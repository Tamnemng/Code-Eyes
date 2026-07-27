import { describe, expect, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph, expectIncomingCount, incomingEdges } from "./helpers/graph";

const FILE = "08-return.ts";

describe("return sớm", () => {
  it("nhiều return -> nhiều edge tới exit", () => {
    const g = analyzeFixture(FILE, "validate");

    expectGraph(g, {
      nodeCount: 9,
      edgeCount: 11,
      kinds: { entry: 1, condition: 3, return: 4, exit: 1, statement: 0 },
      edges: [
        ["entry", "none", 'condition:name === ""'],
        ['condition:name === ""', "true", 'return:"no-name"'],
        ['condition:name === ""', "false", 'condition:role === ""'],
        ['condition:role === ""', "true", 'return:"no-role"'],
        ['condition:role === ""', "false", 'condition:role === "admin"'],
        ['condition:role === "admin"', "true", 'return:"admin-ok"'],
        ['condition:role === "admin"', "false", 'return:"ok"'],
        ['return:"no-name"', "none", "exit"],
        ['return:"no-role"', "none", "exit"],
        ['return:"admin-ok"', "none", "exit"],
        ['return:"ok"', "none", "exit"],
      ],
      warningCount: 0,
    });

    expectIncomingCount(g, "exit", 4);
  });

  it("return rỗng và code chạy tiếp ở nhánh false", () => {
    const g = analyzeFixture(FILE, "earlyBail");

    expectGraph(g, {
      nodeCount: 5,
      edgeCount: 5,
      kinds: { entry: 1, condition: 1, return: 1, statement: 1, exit: 1 },
      edges: [
        ["entry", "none", 'condition:flag === "stop"'],
        ['condition:flag === "stop"', "true", "return:return;"],
        ["return:return;", "none", "exit"],
        ['condition:flag === "stop"', "false", 'statement:console.log("continuing")'],
        ['statement:console.log("continuing")', "none", "exit"],
      ],
      warningCount: 0,
    });
  });

  it("code sau return: giữ node lại, không có edge vào, kèm warning", () => {
    const g = analyzeFixture(FILE, "withUnreachable");

    expectGraph(g, {
      nodeCount: 4,
      edgeCount: 2,
      kinds: { entry: 1, return: 1, statement: 1, exit: 1 },
      edges: [
        ["entry", "none", 'return:"first"'],
        ['return:"first"', "none", "exit"],
      ],
      warnings: [/unreachable/i],
      warningCount: 1,
    });

    // node unreachable vẫn tồn tại (không im lặng bỏ nhánh) nhưng bị cô lập
    expect(incomingEdges(g, 'statement:console.log("never runs")')).toHaveLength(0);
  });
});
