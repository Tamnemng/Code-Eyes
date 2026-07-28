import { describe, expect, it } from "vitest";

import type { FlowGraph } from "../../shared/types";
import {
  classifyAnalyzeError,
  findNodeRange,
  parseWebviewMessage,
  toAnalyzerPosition,
  toEditorPosition,
  toEditorRange,
} from "../pure";

const graph: FlowGraph = {
  functionName: "demo",
  filePath: "display-only.ts",
  language: "typescript",
  warnings: [],
  nodes: [
    {
      id: "n_1",
      kind: "statement",
      label: "work()",
      code: "work();",
      range: { startLine: 1, startCol: 0, endLine: 1, endCol: 7 },
      confidence: "certain",
    },
  ],
  edges: [],
};

describe("chuyển tọa độ VS Code ↔ analyzer tại đúng một biên", () => {
  it("dòng đầu và cột 0: VS Code (0,0) -> analyzer (1,0)", () => {
    expect(toAnalyzerPosition({ line: 0, character: 0 })).toEqual({ line: 1, column: 0 });
  });

  it("chuyển cả hai chiều và round-trip không làm lệch cột", () => {
    const editor = { line: 18, character: 27 };
    const analyzer = toAnalyzerPosition(editor);
    expect(analyzer).toEqual({ line: 19, column: 27 });
    expect(toEditorPosition(analyzer)).toEqual(editor);
  });

  it("range analyzer dùng dòng 1-based được đổi cả start lẫn end", () => {
    expect(
      toEditorRange({ startLine: 1, startCol: 0, endLine: 3, endCol: 4 }),
    ).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 2, character: 4 },
    });
  });
});

describe("classifyAnalyzeError", () => {
  it.each([
    ["NO_FUNCTION_AT_CURSOR: ngoài hàm", "NO_FUNCTION_AT_CURSOR"],
    ["CURSOR_OUT_OF_RANGE: ngoài file", "CURSOR_OUT_OF_RANGE"],
  ] as const)("%s -> %s", (message, code) => {
    expect(classifyAnalyzeError(new Error(message))).toEqual({ code, message });
  });

  it("lỗi lạ và giá trị không phải Error -> UNKNOWN, không throw", () => {
    expect(classifyAnalyzeError(new Error("boom"))).toEqual({
      code: "UNKNOWN",
      message: "boom",
    });
    expect(classifyAnalyzeError({ unexpected: true })).toEqual({
      code: "UNKNOWN",
      message: "Lỗi không rõ khi phân tích.",
    });
  });
});

describe("findNodeRange", () => {
  it("id tồn tại -> range từ graph gốc", () => {
    expect(findNodeRange(graph, "n_1")).toEqual(graph.nodes[0]?.range);
  });

  it("id không tồn tại -> undefined, không throw", () => {
    expect(findNodeRange(graph, "n_404")).toBeUndefined();
  });
});

describe("parseWebviewMessage", () => {
  it("chỉ nhận ready và revealNode có nodeId string", () => {
    expect(parseWebviewMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(parseWebviewMessage({ type: "revealNode", nodeId: "n_1" })).toEqual({
      type: "revealNode",
      nodeId: "n_1",
    });
    expect(parseWebviewMessage({ type: "openCallee", targetId: "n_1:call:0" })).toEqual({
      type: "openCallee",
      targetId: "n_1:call:0",
    });
    expect(parseWebviewMessage({ type: "navigateBack" })).toEqual({ type: "navigateBack" });
    expect(parseWebviewMessage({ type: "revealNode", nodeId: 1 })).toBeUndefined();
    expect(parseWebviewMessage({ type: "openCallee", targetId: 1 })).toBeUndefined();
    expect(parseWebviewMessage({ type: "other" })).toBeUndefined();
    expect(parseWebviewMessage(null)).toBeUndefined();
  });
});
