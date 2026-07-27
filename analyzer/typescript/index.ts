import { readFileSync } from "node:fs";

import ts from "typescript";

import type { FlowGraph } from "../../shared/types";
import { buildFlowGraph } from "./builder";
import { findInnermostFunction } from "./util";

/**
 * Vị trí con trỏ + file cần phân tích.
 *
 * Quy ước toạ độ (áp dụng cho cả `AnalyzeRequest` lẫn `FlowNode.range`):
 *  - `line`   : 1-based (dòng đầu tiên của file là 1)
 *  - `column` : 0-based (ký tự đầu tiên của dòng là 0)
 */
export interface AnalyzeRequest {
  /** Đường dẫn tuyệt đối tới file nguồn. */
  filePath: string;
  /** Dòng con trỏ, 1-based. */
  line: number;
  /** Cột con trỏ, 0-based. */
  column: number;
  /**
   * Source đọc sẵn trong bộ nhớ (dùng cho buffer chưa save trong VS Code, và cho test).
   * Nếu bỏ trống, analyzer tự đọc từ đĩa.
   */
  sourceText?: string;
}

/**
 * Tìm hàm bao quanh con trỏ và dựng control flow graph của hàm đó.
 * Hợp đồng hành vi: `analyzer/typescript/SEMANTICS.md`.
 *
 * Throw khi con trỏ không nằm trong hàm nào (`NO_FUNCTION_AT_CURSOR`) hoặc vị trí
 * nằm ngoài file (`CURSOR_OUT_OF_RANGE`). Construct không xử lý được thì KHÔNG throw -
 * nó đi vào `graph.warnings`.
 */
export function analyzeFunctionAtCursor(request: AnalyzeRequest): FlowGraph {
  const sourceText = request.sourceText ?? readFileSync(request.filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    request.filePath,
    sourceText,
    { languageVersion: ts.ScriptTarget.Latest },
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  const position = positionOf(sourceFile, request);
  const fn = findInnermostFunction(sourceFile, position);
  if (fn === undefined) {
    throw new Error(
      `NO_FUNCTION_AT_CURSOR: ${request.filePath}:${request.line}:${request.column} ` +
        "không nằm trong thân hàm nào",
    );
  }

  return buildFlowGraph(fn, sourceFile, request.filePath);
}

function positionOf(sourceFile: ts.SourceFile, request: AnalyzeRequest): number {
  const lineStarts = sourceFile.getLineStarts();
  const lineIndex = request.line - 1;
  if (lineIndex < 0 || lineIndex >= lineStarts.length || request.column < 0) {
    throw new Error(
      `CURSOR_OUT_OF_RANGE: ${request.filePath}:${request.line}:${request.column}`,
    );
  }
  const lineStart = lineStarts[lineIndex] as number;
  const lineEnd = sourceFile.getLineEndOfPosition(lineStart);
  return Math.min(lineStart + request.column, lineEnd);
}
