import { describe, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph } from "./helpers/graph";

const FILE = "15-combined.ts";

// Chỗ các construct giao nhau - nơi analyzer dễ sai nhất.
describe("tổ hợp construct", () => {
  it("return trong vòng lặp trong try/finally: vẫn phải đi qua finally", () => {
    const g = analyzeFixture(FILE, "findFirst");

    expectGraph(g, {
      nodeCount: 9,
      edgeCount: 11,
      kinds: {
        entry: 1,
        try: 1,
        catch: 0,
        finally: 1,
        loop: 1,
        condition: 1,
        return: 2,
        statement: 1,
        exit: 1,
      },
      edges: [
        ["entry", "none", "try"],
        ["try", "none", "loop:for (const item of items)"],
        // không có catch -> exception đi qua finally
        ["try", "exception", "finally"],
        ["loop:for (const item of items)", "true", 'condition:item !== ""'],
        ['condition:item !== ""', "true", "return:return item"],
        // return từ trong vòng lặp trong try -> finally, không đi tắt ra exit
        ["return:return item", "none", "finally"],
        ['condition:item !== ""', "false", "loop:for (const item of items)"],
        ["loop:for (const item of items)", "false", 'return:"none"'],
        ['return:"none"', "none", "finally"],
        ["finally", "none", 'statement:console.log("scan done")'],
        ['statement:console.log("scan done")', "none", "exit"],
      ],
      absentEdges: [
        ["return:return item", "exit"],
        ['return:"none"', "exit"],
      ],
      backEdges: 1,
      warningCount: 0,
    });
  });

  it("continue trong try/finally: chạy finally TRƯỚC khi quay lại đầu vòng lặp", () => {
    const g = analyzeFixture(FILE, "sumValid");

    expectGraph(g, {
      nodeCount: 11,
      edgeCount: 14,
      kinds: {
        entry: 1,
        statement: 3,
        loop: 1,
        try: 1,
        finally: 1,
        condition: 1,
        continue: 1,
        return: 1,
        exit: 1,
      },
      edges: [
        ["entry", "none", "statement:let total = 0"],
        ["statement:let total = 0", "none", "loop:for (const item of items)"],
        ["loop:for (const item of items)", "true", "try"],
        ["try", "none", 'condition:item === "skip"'],
        ["try", "exception", "finally"],
        ['condition:item === "skip"', "true", "continue"],
        // KEY: continue phải qua finally, không nhảy thẳng về đầu vòng lặp
        ["continue", "none", "finally"],
        ['condition:item === "skip"', "false", "statement:total += item.length;"],
        ["statement:total += item.length;", "none", "finally"],
        ["finally", "none", "statement:total += 1;"],
        ["statement:total += 1;", "none", "loop:for (const item of items)"],
        // try không có catch: nếu thân try ném thì finally chạy xong, exception rời khỏi hàm.
        // Node này nằm TRONG khối finally (parentId trỏ về node finally) nên không phải đi
        // qua finally lần nữa - đi thẳng ra biên hàm là đúng.
        ["statement:total += 1;", "exception", "exit"],
        ["loop:for (const item of items)", "false", "return:return total"],
        ["return:return total", "none", "exit"],
      ],
      absentEdges: [["continue", "loop:for (const item of items)"]],
      // chỉ một đường quay về header (qua finally), nên chỉ 1 cạnh ngược
      backEdges: 1,
      warningCount: 0,
    });
  });

  it("return bên trong khối finally: dựng edge bình thường nhưng phải cảnh báo", () => {
    const g = analyzeFixture(FILE, "overridden");

    expectGraph(g, {
      nodeCount: 8,
      edgeCount: 9,
      kinds: {
        entry: 1,
        try: 1,
        catch: 0,
        finally: 1,
        condition: 1,
        return: 2,
        statement: 1,
        exit: 1,
      },
      edges: [
        ["entry", "none", "try"],
        ["try", "none", "return:return raw;"],
        ["try", "exception", "finally"],
        ["return:return raw;", "none", "finally"],
        ["finally", "none", 'condition:raw === ""'],
        ['condition:raw === ""', "true", 'return:"empty"'],
        ['return:"empty"', "none", "exit"],
        ['condition:raw === ""', "false", 'statement:console.log("kept")'],
        ['statement:console.log("kept")', "none", "exit"],
      ],
      warnings: [/return inside finally/i],
      warningCount: 1,
    });
  });
});
