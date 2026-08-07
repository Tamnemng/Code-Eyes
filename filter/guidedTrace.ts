import ts from "typescript";

import type { FlowEdge, FlowGraph, FlowNode, ParsedCondition } from "../shared/types";

export type TraceScalar = string | number | boolean | null;
export type TraceDecision =
  | { kind: "branch"; outcome: "true" | "false" }
  | { kind: "branches"; outcomes: Array<"true" | "false"> }
  | { kind: "edge"; targetId: string };

export interface TraceQuestion {
  nodeId: string;
  kind: "condition" | "switch" | "route";
  code: string;
  line: number;
  variable?: string;
  suggestions: string[];
  options: Array<{ id: string; label: string; targetId?: string }>;
}

export interface GuidedTraceResult {
  graph: FlowGraph;
  status: "awaiting" | "callee" | "returned" | "thrown" | "broken" | "loop";
  visitedNodeIds: string[];
  selectedEdges: FlowEdge[];
  question?: TraceQuestion;
  calleeNodeId?: string;
  terminal?: FlowNode;
  values: Readonly<Record<string, TraceScalar>>;
  assumptions: string[];
}

export interface GuidedTraceOptions {
  graph: FlowGraph;
  parameters: readonly string[];
  aliases?: Readonly<Record<string, string>>;
  body: unknown;
  decisions?: Readonly<Record<string, TraceDecision>>;
  runtimeValues?: Readonly<Record<string, TraceScalar>>;
  /** Chỉ các call nằm trong terminal (thường là `return service.method(...)`) mới được đi sâu. */
  terminalCalleeNodeIds?: ReadonlySet<string>;
}

const UNKNOWN = Symbol("unknown");
type Evaluated = unknown | typeof UNKNOWN;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is TraceScalar {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function flatten(value: unknown, path: string, values: Map<string, unknown>): void {
  values.set(path, value);
  if (Array.isArray(value)) {
    values.set(`${path}.length`, value.length);
    value.forEach((item, index) => flatten(item, `${path}.${index}`, values));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) flatten(child, `${path}.${key}`, values);
}

function propertyPath(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (expr.kind === ts.SyntaxKind.ThisKeyword) return "this";
  if (ts.isParenthesizedExpression(expr)) return propertyPath(expr.expression);
  if (ts.isPropertyAccessExpression(expr)) {
    const base = propertyPath(expr.expression);
    return base === undefined ? undefined : `${base}.${expr.name.text}`;
  }
  if (ts.isElementAccessExpression(expr) && expr.argumentExpression !== undefined) {
    const base = propertyPath(expr.expression);
    const argument = expr.argumentExpression;
    const key = ts.isStringLiteral(argument) || ts.isNumericLiteral(argument) ? argument.text : undefined;
    return base === undefined || key === undefined ? undefined : `${base}.${key}`;
  }
  return undefined;
}

function lookupPath(path: string, values: Map<string, unknown>): Evaluated {
  if (values.has(path)) return values.get(path);
  const parts = path.split(".");
  for (let end = parts.length - 1; end > 0; end -= 1) {
    const parentPath = parts.slice(0, end).join(".");
    if (!values.has(parentPath)) continue;
    let current = values.get(parentPath);
    for (const part of parts.slice(end)) {
      if (current === null || current === undefined) return undefined;
      if (Array.isArray(current)) {
        if (part === "length") current = current.length;
        else current = current[Number(part)];
      } else if (isRecord(current)) {
        current = current[part];
      } else {
        return UNKNOWN;
      }
    }
    return current;
  }
  return UNKNOWN;
}

function equal(left: unknown, right: unknown, strict: boolean): boolean {
  if (strict) return left === right;
  // Chỉ mô phỏng coercion primitive phổ biến; không gọi bất kỳ code người dùng nào.
  if (isScalar(left) && isScalar(right)) return String(left) === String(right);
  return left === right;
}

function evaluateExpression(expr: ts.Expression, values: Map<string, unknown>): Evaluated {
  if (ts.isParenthesizedExpression(expr)) return evaluateExpression(expr.expression, values);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expr.kind === ts.SyntaxKind.NullKeyword) return null;
  if (expr.kind === ts.SyntaxKind.UndefinedKeyword) return undefined;

  const path = propertyPath(expr);
  if (path !== undefined) return lookupPath(path, values);

  if (ts.isPrefixUnaryExpression(expr)) {
    const operand = evaluateExpression(expr.operand, values);
    if (operand === UNKNOWN) return UNKNOWN;
    if (expr.operator === ts.SyntaxKind.ExclamationToken) return !operand;
    if (expr.operator === ts.SyntaxKind.PlusToken) return Number(operand);
    if (expr.operator === ts.SyntaxKind.MinusToken) return -Number(operand);
    return UNKNOWN;
  }

  if (ts.isBinaryExpression(expr)) {
    const left = evaluateExpression(expr.left, values);
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (left !== UNKNOWN && !left) return left;
      const right = evaluateExpression(expr.right, values);
      if (right !== UNKNOWN && !right) return right;
      return left === UNKNOWN || right === UNKNOWN ? UNKNOWN : right;
    }
    if (op === ts.SyntaxKind.BarBarToken) {
      if (left !== UNKNOWN && left) return left;
      const right = evaluateExpression(expr.right, values);
      if (right !== UNKNOWN && right) return right;
      return left === UNKNOWN || right === UNKNOWN ? UNKNOWN : right;
    }
    if (op === ts.SyntaxKind.QuestionQuestionToken) {
      if (left !== UNKNOWN && left !== null && left !== undefined) return left;
      return evaluateExpression(expr.right, values);
    }
    const right = evaluateExpression(expr.right, values);
    if (left === UNKNOWN || right === UNKNOWN) return UNKNOWN;
    switch (op) {
      case ts.SyntaxKind.EqualsEqualsToken:
        return equal(left, right, false);
      case ts.SyntaxKind.EqualsEqualsEqualsToken:
        return equal(left, right, true);
      case ts.SyntaxKind.ExclamationEqualsToken:
        return !equal(left, right, false);
      case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        return !equal(left, right, true);
      case ts.SyntaxKind.GreaterThanToken:
        return (left as number) > (right as number);
      case ts.SyntaxKind.GreaterThanEqualsToken:
        return (left as number) >= (right as number);
      case ts.SyntaxKind.LessThanToken:
        return (left as number) < (right as number);
      case ts.SyntaxKind.LessThanEqualsToken:
        return (left as number) <= (right as number);
      case ts.SyntaxKind.PlusToken:
        return (left as number) + (right as number);
      default:
        return UNKNOWN;
    }
  }

  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const target = evaluateExpression(expr.expression.expression, values);
    const argument = expr.arguments[0];
    const actual = argument === undefined ? UNKNOWN : evaluateExpression(argument, values);
    if (target === UNKNOWN || actual === UNKNOWN) return UNKNOWN;
    if (expr.expression.name.text === "startsWith" && typeof target === "string") {
      return target.startsWith(String(actual));
    }
    if (expr.expression.name.text === "includes" && (Array.isArray(target) || typeof target === "string")) {
      return target.includes(actual as never);
    }
  }
  return UNKNOWN;
}

function parseExpression(raw: string): ts.Expression | undefined {
  const file = ts.createSourceFile("trace.ts", `const __value = (${raw});`, ts.ScriptTarget.Latest, true);
  const statement = file.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) return undefined;
  return statement.declarationList.declarations[0]?.initializer;
}

function setValue(path: string, value: unknown, values: Map<string, unknown>): void {
  if (value === UNKNOWN) {
    values.delete(path);
    return;
  }
  flatten(value, path, values);
}

function applyBindingName(
  name: ts.BindingName,
  value: Evaluated,
  values: Map<string, unknown>,
): void {
  if (ts.isIdentifier(name)) {
    setValue(name.text, value, values);
    return;
  }
  if (value === UNKNOWN || value === null || typeof value !== "object") return;
  for (const [index, element] of name.elements.entries()) {
    if (ts.isOmittedExpression(element) || element.dotDotDotToken !== undefined) continue;
    const sourceName = ts.isObjectBindingPattern(name)
      ? (element.propertyName?.getText() ?? element.name.getText())
      : String(index);
    const child = (value as Record<string, unknown>)[sourceName];
    applyBindingName(element.name, child, values);
  }
}

/** Chỉ diễn giải gán/destructure thuần; call, await và getter người dùng luôn là UNKNOWN. */
function applyNodeEffects(node: FlowNode, values: Map<string, unknown>): void {
  if (node.kind !== "statement" && node.kind !== "call") return;
  const file = ts.createSourceFile(
    "trace-effects.ts",
    `async function __trace() {\n${node.code}\n}`,
    ts.ScriptTarget.Latest,
    true,
  );
  const fn = file.statements[0];
  if (!fn || !ts.isFunctionDeclaration(fn) || fn.body === undefined) return;
  for (const statement of fn.body.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const value = declaration.initializer === undefined
          ? undefined
          : evaluateExpression(declaration.initializer, values);
        applyBindingName(declaration.name, value, values);
      }
      continue;
    }
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const path = propertyPath(statement.expression.left);
      if (path !== undefined) {
        setValue(path, evaluateExpression(statement.expression.right, values), values);
      }
    }
  }
}

function parsedVariables(node: FlowNode): ParsedCondition[] {
  if (node.condition?.parsedConjuncts !== undefined) return node.condition.parsedConjuncts;
  return node.condition?.parsed === undefined ? [] : [node.condition.parsed];
}

function suggestionValues(node: FlowNode): string[] {
  const result = new Set<string>();
  for (const parsed of parsedVariables(node)) {
    const items = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
    items.forEach((item) => result.add(item));
  }
  return [...result];
}

function missingVariable(node: FlowNode, values: Map<string, unknown>): string | undefined {
  const parsed = parsedVariables(node)
    .map((item) => item.variable)
    .find((name) => lookupPath(name, values) === UNKNOWN);
  if (parsed !== undefined) return parsed;
  const expression = parseExpression(node.condition?.raw ?? "");
  if (expression === undefined) return undefined;
  const missing = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child)) {
      child.arguments.forEach(visit);
      return;
    }
    if (ts.isExpression(child)) {
      const path = propertyPath(child);
      if (path !== undefined && lookupPath(path, values) === UNKNOWN) {
        missing.add(path);
        return;
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(expression);
  return missing.size === 1 ? [...missing][0] : undefined;
}

function traceSubgraph(
  graph: FlowGraph,
  visited: readonly string[],
  selectedEdges: readonly FlowEdge[],
): FlowGraph {
  const kept = new Set(visited);
  const exit = graph.nodes.find((node) => node.kind === "exit");
  if (exit !== undefined) kept.add(exit.id);
  const seenEdges = new Set<string>();
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: selectedEdges.filter((edge) => {
      if (!kept.has(edge.from) || !kept.has(edge.to)) return false;
      const key = `${edge.from}|${edge.to}|${edge.label ?? ""}`;
      if (seenEdges.has(key)) return false;
      seenEdges.add(key);
      return true;
    }),
    warnings: [...graph.warnings, "Guided trace: chỉ hiển thị đường đã xác định; câu trả lời runtime/DB là mock."],
  };
}

function publicValues(values: Map<string, unknown>): Record<string, TraceScalar> {
  const output: Record<string, TraceScalar> = {};
  for (const [key, value] of values) if (isScalar(value)) output[key] = value;
  return output;
}

function switchQuestion(
  node: FlowNode,
  outgoing: readonly FlowEdge[],
  byId: ReadonlyMap<string, FlowNode>,
): TraceQuestion {
  const options = outgoing.map((edge) => ({
    id: edge.to,
    targetId: edge.to,
    label:
      edge.label === "default"
        ? "default"
        : (byId.get(edge.to)?.condition?.raw ?? byId.get(edge.to)?.label ?? edge.to),
  }));
  return {
    nodeId: node.id,
    kind: "switch",
    code: node.condition?.raw ?? node.code,
    line: node.range.startLine,
    suggestions: options.map((option) => option.label),
    options,
  };
}

export function runGuidedTrace(options: GuidedTraceOptions): GuidedTraceResult {
  const { graph } = options;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of graph.edges) {
    const edges = outgoing.get(edge.from);
    if (edges === undefined) outgoing.set(edge.from, [edge]);
    else edges.push(edge);
  }
  const values = new Map<string, unknown>();
  for (const parameter of options.parameters) flatten(options.body, parameter, values);
  for (const [target, source] of Object.entries(options.aliases ?? {})) {
    const value = lookupPath(source, values);
    if (value !== UNKNOWN) flatten(value, target, values);
  }
  const runtimeOverrides = Object.entries(options.runtimeValues ?? {});
  for (const [key, value] of runtimeOverrides) flatten(value, key, values);

  const entry = graph.nodes.find((node) => node.kind === "entry");
  const visited: string[] = [];
  const selectedEdges: FlowEdge[] = [];
  const assumptions: string[] = [];
  let current = entry;
  const nodeVisits = new Map<string, number>();

  const finish = (
    status: GuidedTraceResult["status"],
    terminal?: FlowNode,
    question?: TraceQuestion,
    calleeNodeId?: string,
  ): GuidedTraceResult => ({
    graph: traceSubgraph(graph, visited, selectedEdges),
    status,
    visitedNodeIds: visited,
    selectedEdges,
    ...(question === undefined ? {} : { question }),
    ...(calleeNodeId === undefined ? {} : { calleeNodeId }),
    ...(terminal === undefined ? {} : { terminal }),
    values: publicValues(values),
    assumptions,
  });

  while (current !== undefined && visited.length <= graph.nodes.length * 3 + 10) {
    const visitIndex = nodeVisits.get(current.id) ?? 0;
    nodeVisits.set(current.id, visitIndex + 1);
    visited.push(current.id);
    applyNodeEffects(current, values);
    for (const [key, value] of runtimeOverrides) flatten(value, key, values);

    if (current.kind === "return" && options.terminalCalleeNodeIds?.has(current.id)) {
      return finish("callee", current, undefined, current.id);
    }
    if (current.kind === "throw") return finish("thrown", current);
    if (current.kind === "break") return finish("broken", current);
    if (current.kind === "exit" || current.kind === "return") return finish("returned", current);

    const edges = outgoing.get(current.id) ?? [];
    if (edges.length === 0) return finish("returned", current);
    let selected: FlowEdge | undefined;
    const decision = options.decisions?.[current.id];
    const truthEdges = edges.filter((edge) => edge.label === "true" || edge.label === "false");
    const switchEdges = edges.filter((edge) => edge.label === "case" || edge.label === "default");

    if (truthEdges.length > 0) {
      let outcome: "true" | "false" | undefined;
      if (decision?.kind === "branch" && visitIndex === 0) outcome = decision.outcome;
      else if (decision?.kind === "branches") outcome = decision.outcomes[visitIndex];
      else {
        const expression = parseExpression(current.condition?.raw ?? "");
        const evaluated = expression === undefined ? UNKNOWN : evaluateExpression(expression, values);
        if (typeof evaluated === "boolean") outcome = evaluated ? "true" : "false";
      }
      if (outcome === undefined) {
        const variable = missingVariable(current, values);
        return finish("awaiting", current, {
          nodeId: current.id,
          kind: "condition",
          code: current.condition?.raw ?? current.code,
          line: current.range.startLine,
          ...(variable === undefined ? {} : { variable }),
          suggestions: suggestionValues(current),
          options:
            current.kind === "loop"
              ? [
                  { id: "true", label: "Còn phần tử → chạy vòng này" },
                  { id: "false", label: "Hết dữ liệu → thoát loop, chạy code dưới" },
                ]
              : [
                  { id: "true", label: "Đúng → đi nhánh IF" },
                  { id: "false", label: "Sai → bỏ qua nhánh IF" },
                ],
        });
      }
      selected = truthEdges.find((edge) => edge.label === outcome);
    } else if (switchEdges.length > 0) {
      if (decision?.kind === "edge") selected = switchEdges.find((edge) => edge.to === decision.targetId);
      if (selected === undefined) {
        const discriminant = current.condition?.raw;
        const actual = discriminant === undefined ? UNKNOWN : lookupPath(discriminant, values);
        if (actual !== UNKNOWN) {
          selected = switchEdges.find((edge) => {
            if (edge.label !== "case") return false;
            const parsed = byId.get(edge.to)?.condition?.parsed;
            return parsed !== undefined && String(actual) === String(parsed.value);
          });
          if (selected === undefined && typeof actual === "string") {
            selected = switchEdges.find((edge) => byId.get(edge.to)?.condition?.raw === `case ${actual}`);
          }
        }
        if (selected === undefined) return finish("awaiting", current, switchQuestion(current, switchEdges, byId));
      }
    } else if (edges.length === 1) {
      selected = edges[0];
    } else {
      if (decision?.kind === "edge") selected = edges.find((edge) => edge.to === decision.targetId);
      if (selected === undefined) {
        const normal = edges.filter((edge) => edge.label !== "exception");
        if (normal.length === 1) {
          selected = normal[0];
          assumptions.push(`Dòng ${current.range.startLine}: giả định call không throw; có thể chọn đường exception trong graph đầy đủ.`);
        } else {
          return finish("awaiting", current, {
            nodeId: current.id,
            kind: "route",
            code: current.code,
            line: current.range.startLine,
            suggestions: [],
            options: edges.map((edge) => ({
              id: edge.to,
              targetId: edge.to,
              label: `${edge.label ?? "tiếp tục"} → ${byId.get(edge.to)?.label ?? edge.to}`,
            })),
          });
        }
      }
    }

    if (selected === undefined) return finish("returned", current);
    selectedEdges.push(selected);
    current = byId.get(selected.to);
  }
  return finish("loop", current);
}
