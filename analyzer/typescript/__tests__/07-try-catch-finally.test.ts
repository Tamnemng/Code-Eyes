import { describe, expect, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import {
  dumpGraph,
  expectEdge,
  expectEdgeIds,
  expectGraph,
  expectNoEdge,
  matchNodes,
  node,
} from "./helpers/graph";

const FILE = "07-try-catch-finally.ts";

describe("try / catch / finally", () => {
  it("luồng bình thường: try -> finally, catch -> finally", () => {
    const g = analyzeFixture(FILE, "parseSafely");

    expectGraph(g, {
      nodeCount: 10,
      edgeCount: 10,
      kinds: { entry: 1, statement: 4, try: 1, catch: 1, finally: 1, return: 1, exit: 1 },
      edges: [
        ["entry", "none", 'statement:let out = "none"'],
        ['statement:let out = "none"', "none", "try"],
        ["try", "none", "statement:out = raw.trim()"],
        // một edge exception duy nhất từ vùng try: "bất kỳ statement nào cũng có thể ném"
        ["try", "exception", "catch"],
        ["statement:out = raw.trim()", "none", "finally"],
        ["catch", "none", 'statement:out = "error"'],
        ['statement:out = "error"', "none", "finally"],
        ["finally", "none", 'statement:out = out + "!"'],
        ['statement:out = out + "!"', "none", "return:return out"],
        ["return:return out", "none", "exit"],
      ],
      warningCount: 0,
    });

    // statement trong vùng try phải khai báo parentId trỏ về node try
    expect(node(g, "statement:out = raw.trim()").parentId).toBe(node(g, "try").id);
    expect(node(g, 'statement:out = "error"').parentId).toBe(node(g, "catch").id);
  });

  it("finally chạy trên MỌI đường thoát: return sớm và throw đều phải đi qua finally", () => {
    const g = analyzeFixture(FILE, "loadValue");

    expectGraph(g, {
      nodeCount: 12,
      edgeCount: 14,
      kinds: {
        entry: 1,
        try: 1,
        catch: 1,
        finally: 1,
        condition: 2,
        return: 3,
        throw: 1,
        statement: 1,
        exit: 1,
      },
      edges: [
        ["entry", "none", "try"],
        ["try", "none", 'condition:raw === ""'],
        ["try", "exception", "catch"],
        ['condition:raw === ""', "true", 'return:"empty"'],
        // return sớm trong try -> finally, KHÔNG đi thẳng ra exit
        ['return:"empty"', "none", "finally"],
        ['condition:raw === ""', "false", 'condition:raw === "bad"'],
        ['condition:raw === "bad"', "true", "throw"],
        ["throw", "exception", "catch"],
        ['condition:raw === "bad"', "false", "return:return raw"],
        ["return:return raw", "none", "finally"],
        ["catch", "none", 'return:"caught"'],
        ['return:"caught"', "none", "finally"],
        ["finally", "none", 'statement:console.log("done")'],
        ['statement:console.log("done")', "none", "exit"],
      ],
      absentEdges: [
        ['return:"empty"', "exit"],
        ["return:return raw", "exit"],
        ['return:"caught"', "exit"],
        ["throw", "exit"],
      ],
      warningCount: 0,
    });
  });

  it("try/finally không có catch: exception đi qua finally", () => {
    const g = analyzeFixture(FILE, "cleanup");

    expectGraph(g, {
      nodeCount: 8,
      edgeCount: 9,
      kinds: {
        entry: 1,
        try: 1,
        catch: 0,
        finally: 1,
        condition: 1,
        throw: 1,
        return: 1,
        statement: 1,
        exit: 1,
      },
      edges: [
        ["entry", "none", "try"],
        ["try", "none", 'condition:flag === "boom"'],
        ["try", "exception", "finally"],
        ['condition:flag === "boom"', "true", "throw"],
        ["throw", "exception", "finally"],
        ['condition:flag === "boom"', "false", 'return:"ok"'],
        ['return:"ok"', "none", "finally"],
        ["finally", "none", 'statement:console.log("cleanup")'],
        ['statement:console.log("cleanup")', "none", "exit"],
      ],
      warningCount: 0,
    });
  });

  it("try/catch KHÔNG có finally: return đi thẳng ra exit", () => {
    const g = analyzeFixture(FILE, "tryOnlyCatch");

    expectGraph(g, {
      nodeCount: 6,
      edgeCount: 6,
      kinds: { entry: 1, try: 1, catch: 1, finally: 0, return: 2, exit: 1, statement: 0 },
      edges: [
        ["entry", "none", "try"],
        ["try", "none", "return:return raw.trim()"],
        ["try", "exception", "catch"],
        ["return:return raw.trim()", "none", "exit"],
        ["catch", "none", 'return:"fallback"'],
        ['return:"fallback"', "none", "exit"],
      ],
      warningCount: 0,
    });
  });

  it("try lồng try: throw trong catch TRONG bị bắt bởi catch NGOÀI", () => {
    const g = analyzeFixture(FILE, "nestedTry");

    expectGraph(g, {
      nodeCount: 11,
      edgeCount: 12,
      kinds: {
        entry: 1,
        try: 2,
        catch: 2,
        finally: 1,
        return: 2,
        throw: 1,
        statement: 1,
        exit: 1,
      },
      warningCount: 0,
    });

    // hai node try trùng label -> phải phân biệt bằng parentId
    const trys = matchNodes(g, "try");
    expect(trys, dumpGraph(g)).toHaveLength(2);
    const outerTry = trys.find((n) => n.parentId === undefined);
    const innerTry = trys.find((n) => n.parentId !== undefined);
    if (!outerTry || !innerTry) {
      throw new Error(`Cần một try ngoài (không parentId) và một try trong\n${dumpGraph(g)}`);
    }
    expect(innerTry.parentId, "try trong phải có parentId trỏ về try ngoài").toBe(outerTry.id);

    const catchInner = node(g, "catch:catch (inner)");
    const catchOuter = node(g, "catch:catch (outer)");
    const finallyNode = node(g, "finally");

    expectEdgeIds(g, outerTry.id, innerTry.id, "none");
    expectEdgeIds(g, outerTry.id, catchOuter.id, "exception");
    expectEdgeIds(g, innerTry.id, catchInner.id, "exception");

    // throw trong catch TRONG -> catch NGOÀI (không phải chính nó, không phải finally)
    expectEdge(g, "throw", "catch:catch (outer)", "exception");
    expectNoEdge(g, "throw", "catch:catch (inner)");
    expectNoEdge(g, "throw", "finally");

    // return trong try TRONG (không có finally riêng) -> finally của khối NGOÀI
    expectEdge(g, "return:return raw.trim()", "finally", "none");
    expectNoEdge(g, "return:return raw.trim()", "exit");
    expectEdge(g, 'return:"outer"', "finally", "none");
    expectEdge(g, "catch:catch (outer)", 'return:"outer"', "none");
    expectEdge(g, "catch:catch (inner)", "throw", "none");
    expectEdgeIds(g, finallyNode.id, node(g, 'statement:console.log("both done")').id, "none");
    expectEdge(g, 'statement:console.log("both done")', "exit", "none");
  });

  it("throw bên trong catch vẫn phải chạy finally", () => {
    const g = analyzeFixture(FILE, "rethrow");

    expectGraph(g, {
      nodeCount: 8,
      edgeCount: 8,
      kinds: {
        entry: 1,
        try: 1,
        catch: 1,
        finally: 1,
        return: 1,
        throw: 1,
        statement: 1,
        exit: 1,
      },
      edges: [
        ["entry", "none", "try"],
        ["try", "none", "return:return raw.trim()"],
        ["try", "exception", "catch"],
        ["return:return raw.trim()", "none", "finally"],
        ["catch", "none", "throw"],
        ["throw", "exception", "finally"],
        ["finally", "none", 'statement:console.log("closing")'],
        ['statement:console.log("closing")', "none", "exit"],
      ],
      absentEdges: [["throw", "exit"]],
      warningCount: 0,
    });
  });
});
