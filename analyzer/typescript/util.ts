import ts from "typescript";

import type { SourceRange } from "../../shared/types";

// ---------------------------------------------------------------------------
// Nhận dạng node hàm
// ---------------------------------------------------------------------------

export type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

export function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/** Hàm TRONG CÙNG bao quanh vị trí con trỏ (SEMANTICS §13). */
export function findInnermostFunction(sf: ts.SourceFile, pos: number): FunctionLike | undefined {
  let found: FunctionLike | undefined;
  const visit = (node: ts.Node): void => {
    if (pos < node.getStart(sf) || pos > node.getEnd()) return;
    if (isFunctionLike(node)) found = node;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

// ---------------------------------------------------------------------------
// Range: line 1-based, column 0-based
// ---------------------------------------------------------------------------

export function rangeBetween(start: number, end: number, sf: ts.SourceFile): SourceRange {
  const s = sf.getLineAndCharacterOfPosition(start);
  const e = sf.getLineAndCharacterOfPosition(Math.min(end, sf.text.length));
  return {
    startLine: s.line + 1,
    startCol: s.character,
    endLine: e.line + 1,
    endCol: e.character,
  };
}

export function rangeOf(node: ts.Node, sf: ts.SourceFile): SourceRange {
  return rangeBetween(node.getStart(sf), node.getEnd(), sf);
}

export function lineAt(pos: number, sf: ts.SourceFile): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

export function lineOf(node: ts.Node, sf: ts.SourceFile): number {
  return lineAt(node.getStart(sf), sf);
}

/** Lát source đã trim, kèm range của đúng phần đã trim (để vẫn truy vết được về AST). */
export function trimmedSlice(
  sf: ts.SourceFile,
  start: number,
  end: number,
): { text: string; range: SourceRange } {
  const raw = sf.text.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  const text = raw.trim();
  const from = start + lead;
  return { text, range: rangeBetween(from, from + text.length, sf) };
}

/** Dòng chữ ký hàm, dùng cho node entry. */
export function signatureLine(fn: FunctionLike, sf: ts.SourceFile): string {
  const start = fn.getStart(sf);
  const lineStart = start - sf.getLineAndCharacterOfPosition(start).character;
  return sf.text.slice(lineStart, sf.getLineEndOfPosition(start)).trim();
}

/** Range của dòng chữ ký (từ đầu hàm tới hết dòng đó). */
export function signatureRange(fn: FunctionLike, sf: ts.SourceFile): SourceRange {
  const start = fn.getStart(sf);
  return rangeBetween(start, sf.getLineEndOfPosition(start), sf);
}

export function shortLabel(code: string, max = 60): string {
  const firstLine = (code.split(/\r?\n/)[0] ?? code).trim();
  const base = firstLine.length > 0 ? firstLine : code.replace(/\s+/g, " ").trim();
  return base.length > max ? `${base.slice(0, max - 1)}…` : base;
}

// ---------------------------------------------------------------------------
// Đặt tên hàm (SEMANTICS §13)
// ---------------------------------------------------------------------------

const ANONYMOUS = "(anonymous)";

function propertyName(fn: ts.NamedDeclaration, sf: ts.SourceFile): string {
  return fn.name ? fn.name.getText(sf) : ANONYMOUS;
}

/** Tên class / biến chứa method. Rỗng nếu không suy ra được. */
function ownerName(fn: ts.Node, sf: ts.SourceFile): string {
  const parent = fn.parent as ts.Node | undefined;
  if (!parent) return "";
  if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) {
    return parent.name?.text ?? "(anonymous class)";
  }
  if (ts.isObjectLiteralExpression(parent)) {
    return boundName(parent, sf) ?? "";
  }
  return "";
}

/** Tên biến / property mà một expression được gán vào. */
function boundName(expr: ts.Node, sf: ts.SourceFile): string | undefined {
  const parent = expr.parent as ts.Node | undefined;
  if (!parent) return undefined;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent)) return parent.name.getText(sf);
  if (ts.isPropertyDeclaration(parent) && parent.name) return parent.name.getText(sf);
  return undefined;
}

export function functionNameOf(fn: FunctionLike, sf: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(fn)) return joinOwner(ownerName(fn, sf), "constructor");
  if (ts.isGetAccessorDeclaration(fn)) return joinOwner(ownerName(fn, sf), `get ${propertyName(fn, sf)}`);
  if (ts.isSetAccessorDeclaration(fn)) return joinOwner(ownerName(fn, sf), `set ${propertyName(fn, sf)}`);
  if (ts.isMethodDeclaration(fn)) return joinOwner(ownerName(fn, sf), propertyName(fn, sf));
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? ANONYMOUS;
  // FunctionExpression | ArrowFunction: tên riêng > tên biến được gán > ẩn danh
  const own = ts.isFunctionExpression(fn) ? fn.name?.text : undefined;
  return own ?? boundName(fn, sf) ?? ANONYMOUS;
}

function joinOwner(owner: string, name: string): string {
  return owner.length > 0 ? `${owner}.${name}` : name;
}

// ---------------------------------------------------------------------------
// Phân loại statement (SEMANTICS §1)
// ---------------------------------------------------------------------------

/** Các hàm lồng NGOÀI CÙNG trong một statement (không đi sâu vào thân hàm lồng). */
export function collectNestedFunctions(stmt: ts.Statement): FunctionLike[] {
  const out: FunctionLike[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node)) {
      out.push(node);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(stmt, visit);
  return out;
}

/** Ba ngôi đầu tiên, bỏ qua phần nằm trong thân hàm lồng (thân đó không được inline). */
export function findFirstTernary(stmt: ts.Statement): ts.ConditionalExpression | undefined {
  let found: ts.ConditionalExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined || isFunctionLike(node)) return;
    if (ts.isConditionalExpression(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(stmt, visit);
  return found;
}

/** Statement có gộp được vào cụm tuyến tính không. */
export function isMergeableStatement(stmt: ts.Statement): boolean {
  if (
    !ts.isExpressionStatement(stmt) &&
    !ts.isVariableStatement(stmt) &&
    stmt.kind !== ts.SyntaxKind.EmptyStatement
  ) {
    return false;
  }
  return findFirstTernary(stmt) === undefined && collectNestedFunctions(stmt).length === 0;
}

/** `const f = (x) => {...};` - statement chỉ chứa định nghĩa hàm, không có gì khác. */
export function isPureFunctionDefinition(stmt: ts.Statement): boolean {
  if (!ts.isVariableStatement(stmt)) return false;
  const decls = stmt.declarationList.declarations;
  if (decls.length !== 1) return false;
  const init = decls[0]?.initializer;
  return init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
}

export function isLoopStatement(stmt: ts.Statement): boolean {
  return (
    ts.isForStatement(stmt) ||
    ts.isForOfStatement(stmt) ||
    ts.isForInStatement(stmt) ||
    ts.isWhileStatement(stmt)
  );
}

/** Vòng lặp vô hạn tường minh: while (true) / for (;;) / do...while (true). */
export function isAlwaysTrueLoop(stmt: ts.Statement): boolean {
  if (ts.isWhileStatement(stmt) || ts.isDoStatement(stmt)) {
    return stmt.expression.kind === ts.SyntaxKind.TrueKeyword;
  }
  if (ts.isForStatement(stmt)) {
    return stmt.condition === undefined || stmt.condition.kind === ts.SyntaxKind.TrueKeyword;
  }
  return false;
}
