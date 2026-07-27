import { expect } from "vitest";

import type { EdgeLabel, FlowEdge, FlowGraph, FlowNode, NodeKind } from "../../../../shared/types";

/**
 * Cách chỉ định node trong assertion. Không dùng id vì id là chi tiết cài đặt.
 *
 *   "return"                 -> mọi node kind="return"
 *   "condition:code === \"A\""  -> node kind="condition" có label HOẶC code chứa đoạn text đó
 *   "*:total += 1"           -> mọi kind, khớp text
 */
export type NodeMatcher = string;

/** "none" nghĩa là edge phải KHÔNG có label (null / undefined). */
export type EdgeLabelSpec = EdgeLabel | "none";

export type EdgeSpec =
  | [from: NodeMatcher, to: NodeMatcher]
  | [from: NodeMatcher, label: EdgeLabelSpec, to: NodeMatcher];

export interface GraphSpec {
  nodeCount?: number;
  edgeCount?: number;
  /** Số node theo từng kind. Ghi 0 để khẳng định "không được có kind này". */
  kinds?: Partial<Record<NodeKind, number>>;
  /** Mỗi entry: phải tồn tại ít nhất một edge khớp. */
  edges?: EdgeSpec[];
  /** Mỗi entry: không được tồn tại edge nào khớp. */
  absentEdges?: Array<[NodeMatcher, NodeMatcher]>;
  /** Mỗi pattern phải khớp ít nhất một warning. */
  warnings?: Array<string | RegExp>;
  warningCount?: number;
  /** Số cạnh ngược suy ra bằng DFS (KHÔNG đọc từ nhãn edge). */
  backEdges?: number;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitMatcher(matcher: NodeMatcher): { kind: string; text: string | null } {
  const sep = matcher.indexOf(":");
  if (sep === -1) return { kind: matcher, text: null };
  return { kind: matcher.slice(0, sep), text: matcher.slice(sep + 1) };
}

export function matchNodes(graph: FlowGraph, matcher: NodeMatcher): FlowNode[] {
  const { kind, text } = splitMatcher(matcher);
  const needle = text === null ? null : normalizeText(text);
  return graph.nodes.filter((node) => {
    if (kind !== "*" && node.kind !== kind) return false;
    if (needle === null) return true;
    return (
      normalizeText(node.label).includes(needle) || normalizeText(node.code).includes(needle)
    );
  });
}

/** Lấy đúng MỘT node khớp matcher; nếu 0 hoặc >1 thì fail với dump graph. */
export function node(graph: FlowGraph, matcher: NodeMatcher): FlowNode {
  const found = matchNodes(graph, matcher);
  if (found.length !== 1) {
    throw new Error(
      `Cần đúng 1 node khớp "${matcher}", nhận được ${found.length}.\n${dumpGraph(graph)}`,
    );
  }
  return found[0] as FlowNode;
}

export function countKind(graph: FlowGraph, kind: NodeKind): number {
  return graph.nodes.filter((n) => n.kind === kind).length;
}

function labelMatches(actual: FlowEdge["label"], expected: EdgeLabelSpec | undefined): boolean {
  if (expected === undefined) return true;
  if (expected === "none") return actual === null || actual === undefined;
  return actual === expected;
}

export function findEdges(
  graph: FlowGraph,
  from: NodeMatcher,
  to: NodeMatcher,
  label?: EdgeLabelSpec,
): FlowEdge[] {
  const fromIds = new Set(matchNodes(graph, from).map((n) => n.id));
  const toIds = new Set(matchNodes(graph, to).map((n) => n.id));
  return graph.edges.filter(
    (e) => fromIds.has(e.from) && toIds.has(e.to) && labelMatches(e.label, label),
  );
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export function expectNode(graph: FlowGraph, matcher: NodeMatcher): FlowNode {
  return node(graph, matcher);
}

export function expectEdge(
  graph: FlowGraph,
  from: NodeMatcher,
  to: NodeMatcher,
  label?: EdgeLabelSpec,
): void {
  const arrow = label === undefined ? "->" : `-[${label}]->`;
  expect(
    matchNodes(graph, from).length,
    `Không có node nào khớp "${from}"\n${dumpGraph(graph)}`,
  ).toBeGreaterThan(0);
  expect(
    matchNodes(graph, to).length,
    `Không có node nào khớp "${to}"\n${dumpGraph(graph)}`,
  ).toBeGreaterThan(0);
  expect(
    findEdges(graph, from, to, label).length,
    `Thiếu edge  ${from} ${arrow} ${to}\n${dumpGraph(graph)}`,
  ).toBeGreaterThan(0);
}

export function expectNoEdge(
  graph: FlowGraph,
  from: NodeMatcher,
  to: NodeMatcher,
  label?: EdgeLabelSpec,
): void {
  const arrow = label === undefined ? "->" : `-[${label}]->`;
  expect(
    findEdges(graph, from, to, label).length,
    `Không được có edge  ${from} ${arrow} ${to}\n${dumpGraph(graph)}`,
  ).toBe(0);
}

/** Chuỗi node phải nối tiếp nhau bằng edge (không quan tâm label). */
export function expectPath(graph: FlowGraph, matchers: NodeMatcher[]): void {
  for (let i = 0; i < matchers.length - 1; i++) {
    expectEdge(graph, matchers[i] as NodeMatcher, matchers[i + 1] as NodeMatcher);
  }
}

export function incomingEdges(graph: FlowGraph, matcher: NodeMatcher): FlowEdge[] {
  const ids = new Set(matchNodes(graph, matcher).map((n) => n.id));
  return graph.edges.filter((e) => ids.has(e.to));
}

export function outgoingEdges(graph: FlowGraph, matcher: NodeMatcher): FlowEdge[] {
  const ids = new Set(matchNodes(graph, matcher).map((n) => n.id));
  return graph.edges.filter((e) => ids.has(e.from));
}

export function expectIncomingCount(graph: FlowGraph, matcher: NodeMatcher, count: number): void {
  expect(
    incomingEdges(graph, matcher).length,
    `Số edge ĐI VÀO "${matcher}" phải là ${count}\n${dumpGraph(graph)}`,
  ).toBe(count);
}

export function expectOutgoingCount(graph: FlowGraph, matcher: NodeMatcher, count: number): void {
  expect(
    outgoingEdges(graph, matcher).length,
    `Số edge ĐI RA "${matcher}" phải là ${count}\n${dumpGraph(graph)}`,
  ).toBe(count);
}

/** Assertion tổng hợp - đọc như một "expected graph" khai báo. */
export function expectGraph(graph: FlowGraph, spec: GraphSpec): void {
  if (spec.nodeCount !== undefined) {
    expect(graph.nodes.length, `Sai số node\n${dumpGraph(graph)}`).toBe(spec.nodeCount);
  }
  if (spec.edgeCount !== undefined) {
    expect(graph.edges.length, `Sai số edge\n${dumpGraph(graph)}`).toBe(spec.edgeCount);
  }
  if (spec.kinds) {
    for (const [kind, count] of Object.entries(spec.kinds)) {
      expect(
        countKind(graph, kind as NodeKind),
        `Sai số node kind="${kind}"\n${dumpGraph(graph)}`,
      ).toBe(count);
    }
  }
  for (const edge of spec.edges ?? []) {
    if (edge.length === 2) expectEdge(graph, edge[0], edge[1]);
    else expectEdge(graph, edge[0], edge[2], edge[1]);
  }
  for (const [from, to] of spec.absentEdges ?? []) {
    expectNoEdge(graph, from, to);
  }
  for (const pattern of spec.warnings ?? []) {
    const hit = graph.warnings.some((w) =>
      typeof pattern === "string" ? w.includes(pattern) : pattern.test(w),
    );
    expect(hit, `Thiếu warning khớp ${String(pattern)}\nwarnings=${JSON.stringify(graph.warnings, null, 2)}`).toBe(true);
  }
  if (spec.warningCount !== undefined) {
    expect(
      graph.warnings.length,
      `Sai số warning: ${JSON.stringify(graph.warnings, null, 2)}`,
    ).toBe(spec.warningCount);
  }
  if (spec.backEdges !== undefined) {
    expectBackEdgeCount(graph, spec.backEdges);
  }
}

// ---------------------------------------------------------------------------
// Back edge - suy ra bằng DFS, KHÔNG đọc từ nhãn edge (xem SEMANTICS §4/§14)
// ---------------------------------------------------------------------------

function adjacency(graph: FlowGraph, reverse = false): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of graph.edges) {
    const [from, to] = reverse ? [e.to, e.from] : [e.from, e.to];
    const list = map.get(from);
    if (list) list.push(to);
    else map.set(from, [to]);
  }
  return map;
}

function reachable(from: string, adj: Map<string, string[]>): Set<string> {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length > 0) {
    for (const next of adj.get(stack.pop() as string) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

/**
 * Cạnh ngược theo định nghĩa DFS: cạnh trỏ tới node đang nằm trên stack DFS.
 * CFG sinh từ code TypeScript có cấu trúc là reducible nên tập này không phụ
 * thuộc thứ tự duyệt.
 */
export function backEdges(graph: FlowGraph): FlowEdge[] {
  const out = new Map<string, FlowEdge[]>();
  for (const e of graph.edges) {
    const list = out.get(e.from);
    if (list) list.push(e);
    else out.set(e.from, [e]);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(graph.nodes.map((n) => [n.id, WHITE]));
  const found: FlowEdge[] = [];

  const visit = (id: string): void => {
    color.set(id, GRAY);
    for (const e of out.get(id) ?? []) {
      const c = color.get(e.to);
      if (c === GRAY) found.push(e);
      else if (c === WHITE) visit(e.to);
    }
    color.set(id, BLACK);
  };

  const entry = graph.nodes.find((n) => n.kind === "entry");
  if (entry) visit(entry.id);
  for (const n of graph.nodes) {
    if (color.get(n.id) === WHITE) visit(n.id);
  }
  return found;
}

/** Tập node nằm trên chu trình do một back edge (u -> v) tạo ra: v ⇝ u -> v. */
export function cycleNodes(graph: FlowGraph, edge: FlowEdge): Set<string> {
  const forward = reachable(edge.to, adjacency(graph));
  const backward = reachable(edge.from, adjacency(graph, true));
  return new Set([...forward].filter((id) => backward.has(id)));
}

export function expectBackEdgeCount(graph: FlowGraph, count: number): void {
  const found = backEdges(graph);
  const rendered = found.map((e) => `${e.from}->${e.to}`).join(", ");
  expect(found.length, `Số cạnh ngược suy ra được: [${rendered}]\n${dumpGraph(graph)}`).toBe(count);
}

// ---------------------------------------------------------------------------
// Assertion theo id (dùng khi matcher theo text không phân biệt được, vd try lồng try)
// ---------------------------------------------------------------------------

export function expectEdgeIds(
  graph: FlowGraph,
  fromId: string,
  toId: string,
  label?: EdgeLabelSpec,
): void {
  const arrow = label === undefined ? "->" : `-[${label}]->`;
  const hit = graph.edges.some(
    (e) => e.from === fromId && e.to === toId && labelMatches(e.label, label),
  );
  expect(hit, `Thiếu edge ${fromId} ${arrow} ${toId}\n${dumpGraph(graph)}`).toBe(true);
}

export function expectNoEdgeIds(graph: FlowGraph, fromId: string, toId: string): void {
  const hit = graph.edges.some((e) => e.from === fromId && e.to === toId);
  expect(hit, `Không được có edge ${fromId} -> ${toId}\n${dumpGraph(graph)}`).toBe(false);
}

// ---------------------------------------------------------------------------
// Debug output
// ---------------------------------------------------------------------------

export function dumpGraph(graph: FlowGraph): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const short = (id: string): string => {
    const n = byId.get(id);
    return n ? `${id}[${n.kind}] ${normalizeText(n.label).slice(0, 40)}` : `${id}[?]`;
  };
  const nodes = graph.nodes
    .map((n) => `  ${n.id} ${n.kind.padEnd(11)} ${n.confidence.padEnd(7)} ${normalizeText(n.label).slice(0, 60)}`)
    .join("\n");
  const edges = graph.edges
    .map((e) => `  ${short(e.from)}  --${e.label ?? "-"}-->  ${short(e.to)}`)
    .join("\n");
  const warnings = graph.warnings.map((w) => `  - ${w}`).join("\n");
  return [
    `--- graph ${graph.functionName} (${graph.nodes.length} nodes / ${graph.edges.length} edges) ---`,
    nodes,
    "edges:",
    edges,
    graph.warnings.length ? `warnings:\n${warnings}` : "warnings: (none)",
    "--- end graph ---",
  ].join("\n");
}
