// Bộ test ĐỘC LẬP (Phần A) - chốt cửa trước khi sang Giai đoạn 2.
// Đặc tả do người review viết. KHÔNG được nới đặc tả để làm test xanh;
// nếu một mục sai về ngữ nghĩa JS thì phải dừng lại và hỏi.

import { describe, expect, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import {
  dumpGraph,
  expectEdge,
  expectGraph,
  expectIncomingCount,
  expectNoEdge,
  expectOutgoingCount,
  matchNodes,
  node,
} from "./helpers/graph";

const FILE = "16-independent.ts";

describe("A1: nested finally - return xuyên hai tầng", () => {
  it("return chạy finally TRONG rồi finally NGOÀI, không đi tắt ra exit", () => {
    const g = analyzeFixture(FILE, "nestedFinallyReturn");

    expectGraph(g, {
      nodeCount: 9,
      kinds: { entry: 1, try: 2, catch: 0, finally: 2, return: 1, statement: 2, exit: 1 },
      edges: [
        ["return:\"inner\"", "none", "finally:cleanupInner"],
        ["finally:cleanupInner", "none", "statement:cleanupInner();"],
        ["statement:cleanupInner();", "none", "finally:cleanupOuter"],
        ["finally:cleanupOuter", "none", "statement:cleanupOuter();"],
        ["statement:cleanupOuter();", "none", "exit"],
      ],
      absentEdges: [
        // đi tắt: bỏ qua finally trong
        ["return:\"inner\"", "exit"],
        // đi tắt: bỏ qua finally ngoài
        ["statement:cleanupInner();", "exit"],
      ],
    });
  });
});

describe("A2: nested finally - break có label xuyên hai tầng", () => {
  it("break outer chạy CẢ HAI finally rồi mới tới code sau vòng lặp", () => {
    const g = analyzeFixture(FILE, "nestedFinallyBreak");

    expectGraph(g, {
      kinds: { entry: 1, loop: 1, try: 2, finally: 2, break: 1, exit: 1 },
      edges: [
        ["break", "none", "finally:cleanupInner"],
        ["finally:cleanupInner", "none", "statement:cleanupInner();"],
        ["statement:cleanupInner();", "none", "finally:cleanupOuter"],
        ["finally:cleanupOuter", "none", "statement:cleanupOuter();"],
        ["statement:cleanupOuter();", "none", "statement:done();"],
      ],
      absentEdges: [
        // nhảy tắt tới sau vòng lặp, bỏ qua cả hai finally
        ["break", "statement:done();"],
        // bỏ qua finally ngoài
        ["statement:cleanupInner();", "statement:done();"],
      ],
    });
  });
});

describe("A3: nested finally - throw xuyên hai tầng, không có catch", () => {
  it("throw chạy finally TRONG rồi finally NGOÀI rồi ra exit", () => {
    const g = analyzeFixture(FILE, "nestedFinallyThrow");

    expectEdge(g, "throw", "finally:cleanupInner", "exception");
    expectEdge(g, "finally:cleanupInner", "statement:cleanupInner();", "none");
    expectEdge(g, "statement:cleanupInner();", "finally:cleanupOuter");
    expectEdge(g, "finally:cleanupOuter", "statement:cleanupOuter();", "none");
    expectEdge(g, "statement:cleanupOuter();", "exit");
    expectNoEdge(g, "throw", "exit");
    expectNoEdge(g, "throw", "finally:cleanupOuter");
  });

  it("code sau khối try luôn ném là unreachable: node còn đó nhưng 0 edge vào + warning", () => {
    const g = analyzeFixture(FILE, "nestedFinallyThrow");

    expect(matchNodes(g, 'return:"unreachable"'), dumpGraph(g)).toHaveLength(1);
    expectIncomingCount(g, 'return:"unreachable"', 0);
    expectGraph(g, { warnings: [/unreachable/i] });
  });
});

describe("A4: finally tầng trong có return, đè lên tầng ngoài", () => {
  it("return trong finally vẫn phải đi qua finally NGOÀI, và phải có warning", () => {
    const g = analyzeFixture(FILE, "finallyOverridesNested");

    // finally tầng trong ở ca này chứa `return "b"`, không có cleanup -> khớp theo code của nó
    expectEdge(g, 'return:"a"', 'finally:return "b"', "none");
    expectEdge(g, 'return:"b"', "finally:cleanupOuter", "none");
    expectNoEdge(g, 'return:"b"', "exit");
    expectEdge(g, "finally:cleanupOuter", "statement:cleanupOuter();", "none");
    expectEdge(g, "statement:cleanupOuter();", "exit");
    expectGraph(g, { warnings: [/return inside finally/i] });
  });
});

describe("A5: do-while", () => {
  it("cạnh ngược đúng chỗ và continue nhảy tới bước kiểm điều kiện", () => {
    const g = analyzeFixture(FILE, "doWhileBackEdge");

    expectGraph(g, {
      kinds: { entry: 1, loop: 1, condition: 1, continue: 1, return: 1, exit: 1 },
      edges: [
        // continue -> node loop (chính là điều kiện của do-while)
        ["continue", "none", "loop:while (i < n)"],
        ["loop:while (i < n)", "true", "statement:i = i + 1;"],
        ["loop:while (i < n)", "false", "return:return i"],
      ],
      absentEdges: [
        // continue KHÔNG được nhảy về node đầu thân
        ["continue", "statement:i = i + 1;"],
      ],
      // Do-while có ĐÚNG 1 cạnh ngược, không phụ thuộc số `continue`: header chu trình là
      // node đầu thân, và đường duy nhất vào nó từ trong chu trình là edge `true` của node
      // `loop`. Edge `continue -> loop` không phải cạnh ngược vì `loop` không thống trị
      // `continue` (nó nằm bên trong chu trình, không ở đầu). Xem SEMANTICS §4.
      backEdges: 1,
    });
  });
});

describe("A6: fallthrough nhiều tầng + clause rỗng", () => {
  it("fallthrough xuyên case rỗng, và case cuối rơi vào default", () => {
    const g = analyzeFixture(FILE, "multiFallthrough");

    // case "A" không break -> chảy qua clause rỗng "B" -> thân của "C"
    expectEdge(g, 'switch-case:case "A":', 'statement:out = "a";');
    expectEdge(g, 'statement:out = "a";', 'switch-case:case "B":');
    expectEdge(g, 'switch-case:case "B":', 'switch-case:case "C":');
    expectEdge(g, 'switch-case:case "C":', 'statement:out = out + "bc";');

    // case "D" không break -> rơi vào thân default
    expectEdge(g, 'statement:out = "d";', "switch-case:default:");
    expectEdge(g, "switch-case:default:", 'statement:out = out + "z";');

    // 4 case + 1 default
    expectOutgoingCount(g, "condition:switch (code)", 5);
    expect(
      matchNodes(g, "switch-case").length,
      dumpGraph(g),
    ).toBe(5);
  });
});

describe("A7: return trong vòng lặp trong try/finally", () => {
  it("cả hai return đều qua finally, và cạnh ngược của vòng lặp vẫn còn", () => {
    const g = analyzeFixture(FILE, "returnInLoopInTry");

    expectGraph(g, {
      kinds: { entry: 1, try: 1, catch: 0, finally: 1, loop: 1, condition: 1, return: 2, exit: 1 },
      edges: [
        ["return:return it;", "none", "finally"],
        ['return:"none"', "none", "finally"],
        ["finally", "none", "statement:cleanup();"],
        ["statement:cleanup();", "none", "exit"],
      ],
      absentEdges: [
        ["return:return it;", "exit"],
        ['return:"none"', "exit"],
      ],
      backEdges: 1,
    });
  });
});

describe("A8: ca phủ định - không có finally thì không được định tuyến thừa", () => {
  it("hai return đi thẳng ra exit, exit có đúng 2 edge vào", () => {
    const g = analyzeFixture(FILE, "noFinallyDirect");

    expectGraph(g, {
      kinds: { entry: 1, try: 1, catch: 1, finally: 0, return: 3, exit: 1 },
      edges: [
        ['return:"a"', "none", "exit"],
        ['return:"b"', "none", "exit"],
      ],
    });
    expectIncomingCount(g, "exit", 2);
    // `return "c"` là code chết: giữ node, nhưng không được tạo đường đi nào
    expectIncomingCount(g, 'return:"c"', 0);
    expect(node(g, 'return:"c"'), dumpGraph(g)).toBeDefined();
  });
});
