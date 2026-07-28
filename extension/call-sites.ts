import ts from "typescript";

import type { CalleeLink } from "../shared/protocol";
import type { FlowGraph, FlowNode, SourceRange } from "../shared/types";

export interface CallSite extends CalleeLink {
  /** Toạ độ analyzer: line 1-based, column 0-based. */
  line: number;
  column: number;
}

function scriptKind(filePath: string): ts.ScriptKind {
  return filePath.toLowerCase().endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function positionOf(range: SourceRange, sourceFile: ts.SourceFile): { start: number; end: number } {
  const lineStarts = sourceFile.getLineStarts();
  const offset = (line: number, column: number): number => {
    const index = Math.max(0, Math.min(line - 1, lineStarts.length - 1));
    const lineStart = lineStarts[index] ?? 0;
    const lineEnd = lineStarts[index + 1] ?? sourceFile.text.length;
    return Math.min(lineStart + Math.max(0, column), lineEnd);
  };
  return {
    start: offset(range.startLine, range.startCol),
    end: offset(range.endLine, range.endCol),
  };
}

function containingNode(
  graph: FlowGraph,
  sourceFile: ts.SourceFile,
  callStart: number,
): FlowNode | undefined {
  let match: { node: FlowNode; span: number } | undefined;
  for (const node of graph.nodes) {
    const range = positionOf(node.range, sourceFile);
    if (callStart < range.start || callStart > range.end) continue;
    const span = range.end - range.start;
    if (match === undefined || span < match.span) match = { node, span };
  }
  return match?.node;
}

function calleeOf(call: ts.CallExpression): ts.Expression {
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name;
  if (
    ts.isElementAccessExpression(call.expression) &&
    call.expression.argumentExpression !== undefined
  ) {
    return call.expression.argumentExpression;
  }
  return call.expression;
}

/**
 * Tìm call-site bằng AST nhưng không resolve symbol. Việc resolve được hoãn đến lúc người dùng
 * bấm nút và giao cho VS Code definition provider, nhờ đó hiểu tsconfig/path alias của workspace.
 */
export function collectCallSites(
  filePath: string,
  sourceText: string,
  graph: FlowGraph,
): CallSite[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(filePath),
  );
  const sites: CallSite[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = calleeOf(node);
      const start = callee.getStart(sourceFile);
      const owner = containingNode(graph, sourceFile, start);
      if (owner !== undefined) {
        const position = sourceFile.getLineAndCharacterOfPosition(start);
        sites.push({
          targetId: `${owner.id}:call:${sites.length}`,
          nodeId: owner.id,
          label: callee.getText(sourceFile),
          line: position.line + 1,
          column: position.character,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return sites;
}
