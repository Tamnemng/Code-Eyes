import { describe, expect, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph, node } from "./helpers/graph";

const FILE = "11-implicit-branches.ts";

// Giai đoạn 1 chưa mô hình hoá nhánh ngầm. Bắt buộc: KHÔNG im lặng -
// node giữ nguyên, confidence "unknown", và có warning mô tả rõ.
//
// PHẠM VI: file này chỉ nói về nhánh ngầm trong STATEMENT thường.
// `&&` / `||` nằm trong biểu thức ĐIỀU KIỆN là chuyện khác hẳn (không warning,
// có parsed) - xem SEMANTICS §11 ngoại lệ và test 13-condition-parsing.
describe("nhánh ngầm chưa mô hình hoá (trong statement)", () => {
  it("optional chaining: không tạo nhánh nhưng phải cảnh báo + hạ confidence", () => {
    const g = analyzeFixture(FILE, "nameOf");

    expectGraph(g, {
      nodeCount: 4,
      edgeCount: 3,
      kinds: { entry: 1, statement: 1, return: 1, exit: 1, condition: 0 },
      edges: [
        ["entry", "none", "statement:const name = user?.profile?.name"],
        ["statement:const name = user?.profile?.name", "none", "return:return upper"],
        ["return:return upper", "none", "exit"],
      ],
      warnings: [/optional chaining/i],
      warningCount: 1,
    });

    expect(node(g, "statement").confidence).toBe("unknown");
  });

  it("&& / || / ?? : một warning cho mỗi loại construct trong node", () => {
    const g = analyzeFixture(FILE, "displayName");

    expectGraph(g, {
      nodeCount: 4,
      edgeCount: 3,
      kinds: { entry: 1, statement: 1, return: 1, exit: 1, condition: 0 },
      edges: [
        ["entry", "none", "statement:const raw = user && user.name"],
        ["statement:const raw = user && user.name", "none", "return:return fallback"],
        ["return:return fallback", "none", "exit"],
      ],
      // && và || cùng nhóm short-circuit -> 1 warning; ?? -> 1 warning
      warnings: [/short-circuit/i, /nullish/i],
      warningCount: 2,
    });

    expect(node(g, "statement").confidence).toBe("unknown");
  });
});
