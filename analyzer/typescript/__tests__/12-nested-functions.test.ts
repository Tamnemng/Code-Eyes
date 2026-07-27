import { describe, expect, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph, node } from "./helpers/graph";

const FILE = "12-nested-functions.ts";

describe("hàm lồng / arrow function", () => {
  it("mỗi thân hàm lồng thành MỘT node call, tuyệt đối không inline", () => {
    const g = analyzeFixture(FILE, "summarize");

    expectGraph(g, {
      nodeCount: 10,
      edgeCount: 10,
      kinds: {
        entry: 1,
        call: 3,
        statement: 3,
        loop: 1,
        return: 1,
        exit: 1,
        // BẰNG CHỨNG không inline: `if (n > 10)` trong arrow `double`
        // và `return n` bên trong nó không được sinh node nào
        condition: 0,
      },
      edges: [
        ["entry", "none", "call:double"],
        ["call:double", "none", "statement:let total = 0"],
        ["statement:let total = 0", "none", "loop:for (const item of items)"],
        ["loop:for (const item of items)", "true", "statement:total += double(item)"],
        ["statement:total += double(item)", "none", "loop:for (const item of items)"],
        ["loop:for (const item of items)", "false", "call:tally"],
        // statement có nội dung khác ngoài định nghĩa -> statement node rồi mới tới call node
        ["call:tally", "none", "statement:items.forEach"],
        ["statement:items.forEach", "none", "call:(anonymous)"],
        ["call:(anonymous)", "none", "return:return format(total)"],
        ["return:return format(total)", "none", "exit"],
      ],
      // một warning "not inlined" cho mỗi thân hàm lồng
      warnings: [/not inlined/i],
      warningCount: 3,
      backEdges: 1,
    });

    // gọi hàm thường (double(item), format(total)) KHÔNG sinh node call
    expect(node(g, "statement:total += double(item)").kind).toBe("statement");
    expect(node(g, "return:return format(total)").kind).toBe("return");
  });
});
