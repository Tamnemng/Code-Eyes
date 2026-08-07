// Giai đoạn 3: lọc CFG theo ràng buộc biến.
//
// Hàm này cố ý chỉ biết schema chung. Nó không biết AST, DOM, VS Code hay DisplayGraph:
// filter phải chạy trên FlowGraph gốc, trước mọi biến đổi trình bày (fanout/collapse).

import type { FlowEdge, FlowGraph, FlowNode, ParsedCondition } from "../shared/types";
import { queryMockKey } from "./queryMocks";

export type Constraints = Readonly<Record<string, string>>;

export interface FilterStats {
  /** Node reachable ban đầu nhưng không còn trong graph đã lọc. */
  hidden: number;
  /** Toàn bộ node reachable từ entry trong graph gốc; code chết sẵn không thuộc mẫu số. */
  total: number;
}

function evaluate(parsed: ParsedCondition, actual: string): boolean | undefined {
  if (parsed.operator === "==") {
    return typeof parsed.value === "string" ? actual === parsed.value : undefined;
  }
  if (parsed.operator === "!=") {
    return typeof parsed.value === "string" ? actual !== parsed.value : undefined;
  }
  if (parsed.operator === "startsWith") {
    return typeof parsed.value === "string" ? actual.startsWith(parsed.value) : undefined;
  }
  return Array.isArray(parsed.value) ? parsed.value.includes(actual) : undefined;
}

function outgoingByNode(graph: FlowGraph): ReadonlyMap<string, ReadonlyArray<[number, FlowEdge]>> {
  const outgoing = new Map<string, Array<[number, FlowEdge]>>();
  graph.edges.forEach((edge, index) => {
    const found = outgoing.get(edge.from);
    if (found === undefined) outgoing.set(edge.from, [[index, edge]]);
    else found.push([index, edge]);
  });
  return outgoing;
}

function reachable(
  graph: FlowGraph,
  outgoing: ReadonlyMap<string, ReadonlyArray<[number, FlowEdge]>>,
  deadEdges: ReadonlySet<number>,
): Set<string> {
  const entry = graph.nodes.find((node) => node.kind === "entry");
  if (entry === undefined) return new Set();

  const reached = new Set([entry.id]);
  const queue = [entry.id];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index] as string;
    for (const [edgeIndex, edge] of outgoing.get(current) ?? []) {
      if (deadEdges.has(edgeIndex) || reached.has(edge.to)) continue;
      reached.add(edge.to);
      queue.push(edge.to);
    }
  }
  return reached;
}

/** Thống kê N/M dùng chung cho warning, phép đo và UI; đếm theo id gốc trước fanout. */
export function filterStats(input: FlowGraph, output: FlowGraph): FilterStats {
  const baseline = reachable(input, outgoingByNode(input), new Set());
  const outputIds = new Set(output.nodes.map((node) => node.id));
  let hidden = 0;
  for (const id of baseline) if (!outputIds.has(id)) hidden += 1;
  return { hidden, total: baseline.size };
}

function markConditionEdges(
  node: FlowNode,
  edges: ReadonlyArray<[number, FlowEdge]>,
  constraints: Constraints,
  deadEdges: Set<number>,
): boolean {
  if (node.kind !== "condition") return false;
  const mocked = constraints[queryMockKey(node.id)];
  if (mocked === "true" || mocked === "false") {
    const deadLabel = mocked === "true" ? "false" : "true";
    for (const [index, edge] of edges) if (edge.label === deadLabel) deadEdges.add(index);
    return true;
  }
  const primary = node.condition?.parsed;
  const parsedItems =
    node.condition?.parsedConjuncts ?? (primary === undefined ? [] : [primary]);
  let matched = false;
  let hasFalse = false;
  let singleResult: boolean | undefined;
  for (const parsed of parsedItems) {
    const actual = constraints[parsed.variable];
    if (actual === undefined) continue;
    matched = true;
    const result = evaluate(parsed, actual);
    if (parsedItems.length === 1) singleResult = result;
    if (result === false) hasFalse = true;
  }
  if (!matched) return false;

  // §12 bất đối xứng:
  // - certain: kết luận được cả true lẫn false;
  // - unknown: chỉ parsed=false mới chứng minh cả biểu thức false.
  // For `&&`, any known-false parsed conjunct proves the whole expression false.
  // Known-true conjuncts do not prove the whole expression true.
  if (hasFalse) {
    for (const [index, edge] of edges) if (edge.label === "true") deadEdges.add(index);
  } else if (node.confidence === "certain" && singleResult === true) {
    for (const [index, edge] of edges) if (edge.label === "false") deadEdges.add(index);
  }
  return true;
}

function markSwitchDispatch(
  discriminant: FlowNode,
  dispatch: ReadonlyArray<[number, FlowEdge]>,
  byId: ReadonlyMap<string, FlowNode>,
  constraints: Constraints,
  deadEdges: Set<number>,
): boolean {
  if (discriminant.kind !== "condition" || discriminant.confidence !== "certain") return false;
  const caseDispatch = dispatch.filter(([, edge]) => edge.label === "case");
  if (caseDispatch.length === 0) return false;

  const parsedCases: Array<[number, FlowEdge, ParsedCondition]> = [];
  for (const [index, edge] of caseDispatch) {
    const target = byId.get(edge.to);
    const parsed = target?.condition?.parsed;
    // Một case động làm tập case không đầy đủ. Khi đó ngay cả default cũng chưa thể kết luận:
    // giữ toàn bộ dispatch là over-approximation an toàn.
    if (target?.kind !== "switch-case" || target.confidence !== "certain" || parsed === undefined) {
      return false;
    }
    parsedCases.push([index, edge, parsed]);
  }

  const variable = parsedCases[0]?.[2].variable;
  if (
    variable === undefined ||
    parsedCases.some(([, , parsed]) => parsed.variable !== variable)
  ) {
    return false;
  }
  const actual = constraints[variable];
  if (actual === undefined) return false;

  const matching = new Set<number>();
  for (const [index, , parsed] of parsedCases) {
    if (evaluate(parsed, actual) === true) matching.add(index);
  }

  for (const [index, edge] of dispatch) {
    if (edge.label === "case") {
      if (!matching.has(index)) deadEdges.add(index);
    } else if (edge.label === "default" && matching.size > 0) {
      deadEdges.add(index);
    }
  }
  return true;
}

/**
 * Trả một graph con của `graph` theo constraints.
 *
 * M trong warning = số node đạt tới được từ entry trước filter.
 * N = số node trong tập đó bị constraints làm mất reachability; code chết sẵn không tính.
 * `entry` và `exit` luôn được giữ. `exit` có thể không còn reachable (vd lọc thành vòng vô hạn);
 * hàm không bịa thêm edge để làm nó reachable vì output phải là graph con thật.
 */
export function filterGraph(graph: FlowGraph, constraints: Constraints): FlowGraph {
  if (Object.keys(constraints).length === 0) return graph;

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = outgoingByNode(graph);
  const deadEdges = new Set<number>();
  let matchedConstraint = false;

  for (const node of graph.nodes) {
    const edges = outgoing.get(node.id) ?? [];
    const dispatch = edges.filter(([, edge]) => edge.label === "case" || edge.label === "default");
    if (dispatch.length > 0) {
      matchedConstraint =
        markSwitchDispatch(node, dispatch, byId, constraints, deadEdges) || matchedConstraint;
      continue;
    }
    matchedConstraint =
      markConditionEdges(node, edges, constraints, deadEdges) || matchedConstraint;
  }

  // Constraint không xuất hiện trong metadata của graph: giữ nguyên cả object và warnings.
  if (!matchedConstraint) return graph;

  const filteredReachable = reachable(graph, outgoing, deadEdges);
  const keptIds = new Set(filteredReachable);
  for (const node of graph.nodes) {
    if (node.kind === "entry" || node.kind === "exit") keptIds.add(node.id);
  }

  const filtered: FlowGraph = {
    ...graph,
    nodes: graph.nodes.filter((node) => keptIds.has(node.id)),
    edges: graph.edges.filter(
      (edge, index) =>
        !deadEdges.has(index) && keptIds.has(edge.from) && keptIds.has(edge.to),
    ),
    warnings: graph.warnings,
  };
  const stats = filterStats(graph, filtered);
  return {
    ...filtered,
    warnings: [
      ...graph.warnings,
      `Filter: đang ẩn ${stats.hidden}/${stats.total} node theo ràng buộc.`,
    ],
  };
}
