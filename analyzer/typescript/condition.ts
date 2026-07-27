import ts from "typescript";

import type { Confidence, FlowNode, ParsedCondition } from "../../shared/types";

export interface ConditionInfo {
  condition: NonNullable<FlowNode["condition"]>;
  confidence: Confidence;
}

/**
 * SEMANTICS §12 - `parsed` và `confidence` là hai trục độc lập:
 *  - khớp đúng một dạng đơn giản      -> parsed + certain (kết luận hai chiều)
 *  - chuỗi && có hạng tử parse được   -> parsed + unknown (kết luận MỘT chiều)
 *  - còn lại (kể cả ||)               -> không parsed + unknown
 */
export function analyzeCondition(expr: ts.Expression, sf: ts.SourceFile): ConditionInfo {
  const raw = expr.getText(sf);

  const exact = parseExact(expr, sf);
  if (exact) return { condition: { raw, parsed: exact }, confidence: "certain" };

  const conjunct = firstParsableConjunct(expr, sf);
  if (conjunct) return { condition: { raw, parsed: conjunct }, confidence: "unknown" };

  return { condition: { raw }, confidence: "unknown" };
}

/** Discriminant của switch: giữ raw, không bao giờ parse (nó không phải phép so sánh). */
export function analyzeDiscriminant(expr: ts.Expression, sf: ts.SourceFile): ConditionInfo {
  return {
    condition: { raw: expr.getText(sf) },
    confidence: isVariableExpression(expr) ? "certain" : "unknown",
  };
}

/** `case "A":` -> so sánh discriminant với string literal. */
export function analyzeCaseClause(
  clause: ts.CaseClause,
  discriminant: ts.Expression,
  sf: ts.SourceFile,
): ConditionInfo {
  const raw = `case ${clause.expression.getText(sf)}`;
  if (ts.isStringLiteral(clause.expression) && isVariableExpression(discriminant)) {
    return {
      condition: {
        raw,
        parsed: {
          variable: discriminant.getText(sf),
          operator: "==",
          value: clause.expression.text,
        },
      },
      confidence: "certain",
    };
  }
  return { condition: { raw }, confidence: "unknown" };
}

export function defaultClauseCondition(): ConditionInfo {
  return { condition: { raw: "default" }, confidence: "certain" };
}

// ---------------------------------------------------------------------------

function unwrapParens(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/** Vế "biến": identifier / this / chuỗi property access, KHÔNG có optional chaining. */
export function isVariableExpression(expr: ts.Expression): boolean {
  const e = unwrapParens(expr);
  if (ts.isIdentifier(e)) return true;
  if (e.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isPropertyAccessExpression(e)) {
    if (e.questionDotToken !== undefined) return false;
    return isVariableExpression(e.expression);
  }
  return false;
}

function variableAndLiteral(
  left: ts.Expression,
  right: ts.Expression,
  sf: ts.SourceFile,
): { variable: string; value: string } | undefined {
  const l = unwrapParens(left);
  const r = unwrapParens(right);
  if (ts.isStringLiteral(r) && isVariableExpression(l)) {
    return { variable: l.getText(sf), value: r.text };
  }
  if (ts.isStringLiteral(l) && isVariableExpression(r)) {
    return { variable: r.getText(sf), value: l.text };
  }
  return undefined;
}

function parseExact(expr: ts.Expression, sf: ts.SourceFile): ParsedCondition | undefined {
  const e = unwrapParens(expr);

  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    const isEq =
      op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsEqualsToken;
    const isNe =
      op === ts.SyntaxKind.ExclamationEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken;
    if (!isEq && !isNe) return undefined;
    const pair = variableAndLiteral(e.left, e.right, sf);
    if (!pair) return undefined;
    return { variable: pair.variable, operator: isEq ? "==" : "!=", value: pair.value };
  }

  if (ts.isCallExpression(e) && e.questionDotToken === undefined && e.arguments.length === 1) {
    const callee = unwrapParens(e.expression);
    if (!ts.isPropertyAccessExpression(callee) || callee.questionDotToken !== undefined) {
      return undefined;
    }
    const arg = e.arguments[0];
    if (arg === undefined) return undefined;
    const method = callee.name.text;

    // x.startsWith("A")
    if (method === "startsWith" && ts.isStringLiteral(arg) && isVariableExpression(callee.expression)) {
      return {
        variable: callee.expression.getText(sf),
        operator: "startsWith",
        value: arg.text,
      };
    }

    // ["A","B"].includes(x)
    if (method === "includes" && isVariableExpression(arg)) {
      const target = unwrapParens(callee.expression);
      if (!ts.isArrayLiteralExpression(target) || target.elements.length === 0) return undefined;
      const values: string[] = [];
      for (const element of target.elements) {
        if (!ts.isStringLiteral(element)) return undefined;
        values.push(element.text);
      }
      return { variable: arg.getText(sf), operator: "in", value: values };
    }
  }

  return undefined;
}

function flattenAnd(expr: ts.Expression, out: ts.Expression[]): void {
  const e = unwrapParens(expr);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    flattenAnd(e.left, out);
    flattenAnd(e.right, out);
    return;
  }
  out.push(e);
}

/**
 * Hạng tử parse được ĐẦU TIÊN từ trái sang trong chuỗi `&&`.
 * Chỉ áp dụng cho `&&`: một hạng tử false là cả biểu thức false (đúng chiều mà filter cần).
 * Với `||` thì kết luận chạy ngược chiều nên KHÔNG điền parsed - xem SEMANTICS §12.
 */
function firstParsableConjunct(
  expr: ts.Expression,
  sf: ts.SourceFile,
): ParsedCondition | undefined {
  const e = unwrapParens(expr);
  if (
    !ts.isBinaryExpression(e) ||
    e.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return undefined;
  }
  const parts: ts.Expression[] = [];
  flattenAnd(e, parts);
  for (const part of parts) {
    const parsed = parseExact(part, sf);
    if (parsed) return parsed;
  }
  return undefined;
}
