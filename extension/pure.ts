import type { AnalyzeErrorCode, WebviewToHost } from "../shared/protocol";
import type { FlowGraph, SourceRange } from "../shared/types";

export interface EditorPosition {
  line: number;
  character: number;
}

export interface AnalyzerPosition {
  line: number;
  column: number;
}

export interface EditorRange {
  start: EditorPosition;
  end: EditorPosition;
}

export interface ClassifiedAnalyzeError {
  code: AnalyzeErrorCode;
  message: string;
}

/** Biên DUY NHẤT đổi VS Code 0-based line sang analyzer 1-based line. */
export function toAnalyzerPosition(position: EditorPosition): AnalyzerPosition {
  return { line: position.line + 1, column: position.character };
}

/** Chiều ngược lại, dùng cho range analyzer trả về khi nhảy vào editor. */
export function toEditorPosition(position: AnalyzerPosition): EditorPosition {
  return { line: position.line - 1, character: position.column };
}

export function toEditorRange(range: SourceRange): EditorRange {
  return {
    start: toEditorPosition({ line: range.startLine, column: range.startCol }),
    end: toEditorPosition({ line: range.endLine, column: range.endCol }),
  };
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return "Lỗi không rõ khi phân tích.";
}

export function classifyAnalyzeError(error: unknown): ClassifiedAnalyzeError {
  const message = messageOf(error);
  if (message.startsWith("NO_FUNCTION_AT_CURSOR:")) {
    return { code: "NO_FUNCTION_AT_CURSOR", message };
  }
  if (message.startsWith("CURSOR_OUT_OF_RANGE:")) {
    return { code: "CURSOR_OUT_OF_RANGE", message };
  }
  return { code: "UNKNOWN", message };
}

export function findNodeRange(graph: FlowGraph, nodeId: string): SourceRange | undefined {
  return graph.nodes.find((node) => node.id === nodeId)?.range;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Message từ webview là dữ liệu runtime, không tin type declaration một cách mù quáng. */
export function parseWebviewMessage(value: unknown): WebviewToHost | undefined {
  if (!isRecord(value)) return undefined;
  if (value["type"] === "ready") return { type: "ready" };
  if (value["type"] === "revealNode" && typeof value["nodeId"] === "string") {
    return { type: "revealNode", nodeId: value["nodeId"] };
  }
  if (value["type"] === "openCallee" && typeof value["targetId"] === "string") {
    return { type: "openCallee", targetId: value["targetId"] };
  }
  if (value["type"] === "navigateBack") return { type: "navigateBack" };
  return undefined;
}
