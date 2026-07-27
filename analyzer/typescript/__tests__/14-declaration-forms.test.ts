import { describe, expect, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph, node } from "./helpers/graph";

const FILE = "14-declaration-forms.ts";

// SEMANTICS §13: analyzer chọn function-like node TRONG CÙNG bao quanh con trỏ,
// và đặt tên theo dạng khai báo.
describe("dạng khai báo hàm và vị trí con trỏ", () => {
  it("constructor: functionName = <Class>.constructor", () => {
    const g = analyzeFixture(FILE, "constructor");

    expect(g.functionName).toBe("OrderService.constructor");
    expectGraph(g, {
      nodeCount: 6,
      edgeCount: 6,
      kinds: { entry: 1, condition: 1, statement: 2, return: 1, exit: 1 },
      edges: [
        ["entry", "none", 'condition:prefix === ""'],
        ['condition:prefix === ""', "true", 'statement:this.prefix = "default"'],
        ['statement:this.prefix = "default"', "none", "return:return;"],
        ["return:return;", "none", "exit"],
        ['condition:prefix === ""', "false", "statement:this.prefix = prefix;"],
        ["statement:this.prefix = prefix;", "none", "exit"],
      ],
      warningCount: 0,
    });
  });

  it("getter: functionName = <Class>.get <tên>", () => {
    const g = analyzeFixture(FILE, "label");

    expect(g.functionName).toBe("OrderService.get label");
    expectGraph(g, {
      nodeCount: 5,
      edgeCount: 5,
      kinds: { entry: 1, condition: 1, return: 2, exit: 1, statement: 0 },
      edges: [
        ["entry", "none", 'condition:this.prefix === "vip"'],
        ['condition:this.prefix === "vip"', "true", 'return:"VIP"'],
        ['condition:this.prefix === "vip"', "false", "return:return this.prefix"],
      ],
      warningCount: 0,
    });

    // property access qua `this` vẫn parse được thành variable
    expect(node(g, "condition").condition?.parsed).toEqual({
      variable: "this.prefix",
      operator: "==",
      value: "vip",
    });
  });

  it("method của class: functionName = <Class>.<method>", () => {
    const g = analyzeFixture(FILE, "route");

    expect(g.functionName).toBe("OrderService.route");
    expectGraph(g, {
      nodeCount: 5,
      edgeCount: 5,
      kinds: { entry: 1, condition: 1, return: 2, exit: 1 },
      edges: [
        ["entry", "none", 'condition:code === "A"'],
        ['condition:code === "A"', "true", "return:-alpha"],
        ['condition:code === "A"', "false", "return:-other"],
      ],
      warningCount: 0,
    });
  });

  it("method trong object literal: functionName = <biến>.<method>", () => {
    const g = analyzeFixture(FILE, "onSubmit");

    expect(g.functionName).toBe("handlers.onSubmit");
    expectGraph(g, {
      nodeCount: 5,
      edgeCount: 5,
      kinds: { entry: 1, condition: 1, return: 2, exit: 1 },
      edges: [
        ["entry", "none", 'condition:code === "ok"'],
        ['condition:code === "ok"', "true", 'return:"submitted"'],
        ['condition:code === "ok"', "false", 'return:"rejected"'],
      ],
      warningCount: 0,
    });
  });

  it("con trỏ ở hàm ngoài: callback chỉ là một node call", () => {
    const g = analyzeFixture(FILE, "withCallback");

    expect(g.functionName).toBe("withCallback");
    expectGraph(g, {
      nodeCount: 6,
      edgeCount: 5,
      // `if` bên trong callback KHÔNG được inline
      kinds: { entry: 1, statement: 2, call: 1, return: 1, exit: 1, condition: 0 },
      edges: [
        ["entry", "none", "statement:let total = 0"],
        ["statement:let total = 0", "none", "statement:items.forEach"],
        ["statement:items.forEach", "none", "call:(anonymous)"],
        ["call:(anonymous)", "none", "return:return total"],
        ["return:return total", "none", "exit"],
      ],
      warnings: [/not inlined/i],
      warningCount: 1,
    });
  });

  it("con trỏ BÊN TRONG thân callback: phân tích chính callback, không phải hàm ngoài", () => {
    const g = analyzeFixture(FILE, "insideCallback");

    expect(g.functionName).toBe("(anonymous)");
    expectGraph(g, {
      nodeCount: 5,
      edgeCount: 5,
      // graph của riêng arrow: có điều kiện, KHÔNG có node call, không thấy `let total = 0`
      kinds: { entry: 1, statement: 2, condition: 1, exit: 1, call: 0, return: 0 },
      edges: [
        ["entry", "none", "statement:const insideCallback = item.length"],
        ["statement:const insideCallback = item.length", "none", "condition:insideCallback > 0"],
        ["condition:insideCallback > 0", "true", "statement:total += insideCallback"],
        ["statement:total += insideCallback", "none", "exit"],
        ["condition:insideCallback > 0", "false", "exit"],
      ],
      warningCount: 0,
    });
  });

  it("con trỏ không nằm trong hàm nào -> lỗi đầu vào, không phải warning", () => {
    expect(() => analyzeFixture(FILE, "handlers")).toThrow(/NO_FUNCTION_AT_CURSOR/);
  });
});
