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

  const conjuncts = parsableConjuncts(expr, sf);
  const first = conjuncts[0];
  if (first !== undefined) {
    return {
      condition: {
        raw,
        parsed: first,
        ...(conjuncts.length > 1 ? { parsedConjuncts: conjuncts } : {}),
      },
      confidence: "unknown",
    };
  }

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
  const value = caseValue(clause.expression, sf);
  if (value !== undefined && isVariableExpression(discriminant)) {
    return {
      condition: {
        raw,
        parsed: {
          variable: discriminant.getText(sf),
          operator: "==",
          value,
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

/**
 * Tên ổn định dùng trong UI filter. Optional property access vẫn đọc cùng một field,
 * nên `currentUser?.clientCode` và `currentUser.clientCode` dùng chung constraint key.
 */
function filterVariableName(expr: ts.Expression, sf: ts.SourceFile): string | undefined {
  const e = unwrapParens(expr);
  if (ts.isIdentifier(e)) return e.text;
  if (e.kind === ts.SyntaxKind.ThisKeyword) return "this";
  if (!ts.isPropertyAccessExpression(e)) return undefined;
  const base = filterVariableName(e.expression, sf);
  return base === undefined ? undefined : `${base}.${e.name.getText(sf)}`;
}

/** Case tĩnh mà người dùng có thể chọn bằng đúng nhãn source, gồm string/number/enum member. */
function caseValue(expr: ts.Expression, sf: ts.SourceFile): string | undefined {
  const e = unwrapParens(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isNumericLiteral(e)) return e.text;
  return isVariableExpression(e) ? e.getText(sf) : undefined;
}

function literalValue(expr: ts.Expression): string | undefined {
  const value = unwrapParens(expr);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isNumericLiteral(value)) return value.text;
  if (value.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (value.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (value.kind === ts.SyntaxKind.NullKeyword) return "null";
  return undefined;
}

function variableAndLiteral(
  left: ts.Expression,
  right: ts.Expression,
  sf: ts.SourceFile,
): { variable: string; value: string } | undefined {
  const l = unwrapParens(left);
  const r = unwrapParens(right);
  const leftVariable = filterVariableName(l, sf);
  const rightVariable = filterVariableName(r, sf);
  const rightLiteral = literalValue(r);
  if (rightLiteral !== undefined && leftVariable !== undefined) {
    return { variable: leftVariable, value: rightLiteral };
  }
  const leftLiteral = literalValue(l);
  if (leftLiteral !== undefined && rightVariable !== undefined) {
    return { variable: rightVariable, value: leftLiteral };
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
    const calleeVariable = filterVariableName(callee.expression, sf);

    // x.startsWith("A")
    if (method === "startsWith" && ts.isStringLiteral(arg) && calleeVariable !== undefined) {
      return {
        variable: calleeVariable,
        operator: "startsWith",
        value: arg.text,
      };
    }

    // ["A","B"].includes(x)
    const argumentVariable = filterVariableName(arg, sf);
    if (method === "includes" && argumentVariable !== undefined) {
      const target = unwrapParens(callee.expression);
      if (!ts.isArrayLiteralExpression(target) || target.elements.length === 0) return undefined;
      const values: string[] = [];
      for (const element of target.elements) {
        if (!ts.isStringLiteral(element)) return undefined;
        values.push(element.text);
      }
      return { variable: argumentVariable, operator: "in", value: values };
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
function parsableConjuncts(
  expr: ts.Expression,
  sf: ts.SourceFile,
): ParsedCondition[] {
  const e = unwrapParens(expr);
  if (
    !ts.isBinaryExpression(e) ||
    e.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return [];
  }
  const parts: ts.Expression[] = [];
  flattenAnd(e, parts);
  return parts
    .map((part) => parseExact(part, sf))
    .filter((parsed): parsed is ParsedCondition => parsed !== undefined);
}
