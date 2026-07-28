import type { FlowGraph, FlowNode } from "../shared/types";
import type { CallSite } from "./call-sites";

export const AUTO_INLINE_CALLER_LIMIT = 30;
export const AUTO_INLINE_GRAPH_LIMIT = 300;

export interface InlineGraphResult {
  graph: FlowGraph;
  /** Id trong graph callee -> id duy nhất trong graph đã ghép. */
  nodeIdMap: ReadonlyMap<string, string>;
}

function safeNamespace(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, "_");
}

/**
 * Wrapper nhỏ thường có một return chứa cả wrapper call và business call lồng bên trong.
 * Call nằm sâu hơn bắt đầu muộn hơn trên cùng dòng, nên ưu tiên vị trí source cuối cùng.
 */
export function selectAutoInlineCallSite<T extends CallSite>(
  graph: FlowGraph,
  callSites: readonly T[],
): T[] {
  if (graph.nodes.length > AUTO_INLINE_CALLER_LIMIT) return [];
  const returnIds = new Set(
    graph.nodes.filter((node) => node.kind === "return").map((node) => node.id),
  );
  return [...callSites]
    .filter((site) => returnIds.has(site.nodeId))
    .sort((left, right) => right.line - left.line || right.column - left.column);
}

/**
 * Ghép CFG callee vào sau node chứa call. Entry/exit của callee đổi thành `call` marker để
 * FlowGraph hợp nhất vẫn chỉ có đúng một entry/exit. Toàn bộ node callee là con của call node,
 * vì vậy UI có thể collapse cả phần inline.
 */
export function inlineCalleeGraph(
  caller: FlowGraph,
  callNodeId: string,
  callee: FlowGraph,
  namespace: string,
): InlineGraphResult | undefined {
  if (!caller.nodes.some((node) => node.id === callNodeId)) return undefined;
  const calleeEntry = callee.nodes.find((node) => node.kind === "entry");
  const calleeExit = callee.nodes.find((node) => node.kind === "exit");
  if (calleeEntry === undefined || calleeExit === undefined) return undefined;

  const prefix = `inline_${safeNamespace(namespace)}__`;
  const nodeIdMap = new Map(callee.nodes.map((node) => [node.id, `${prefix}${node.id}`]));
  const mappedEntryId = nodeIdMap.get(calleeEntry.id);
  const mappedExitId = nodeIdMap.get(calleeExit.id);
  if (mappedEntryId === undefined || mappedExitId === undefined) return undefined;

  const mappedNodes: FlowNode[] = callee.nodes.map((node) => {
    const id = nodeIdMap.get(node.id) as string;
    const mappedParent =
      node.parentId === undefined ? undefined : nodeIdMap.get(node.parentId);
    const parentId = mappedParent ?? callNodeId;
    if (node.id === calleeEntry.id) {
      return {
        ...node,
        id,
        kind: "call",
        label: `↳ ${callee.functionName}`,
        parentId,
      };
    }
    if (node.id === calleeExit.id) {
      return {
        ...node,
        id,
        kind: "call",
        label: `↳ return ${callee.functionName}`,
        parentId,
      };
    }
    return { ...node, id, parentId };
  });

  const outgoing = caller.edges.filter((edge) => edge.from === callNodeId);
  const untouchedEdges = caller.edges.filter((edge) => edge.from !== callNodeId);
  const mappedEdges = callee.edges.map((edge) => ({
    ...edge,
    from: nodeIdMap.get(edge.from) as string,
    to: nodeIdMap.get(edge.to) as string,
  }));

  return {
    graph: {
      ...caller,
      nodes: [...caller.nodes, ...mappedNodes],
      edges: [
        ...untouchedEdges,
        { from: callNodeId, to: mappedEntryId, label: null },
        ...mappedEdges,
        ...outgoing.map((edge) => ({ ...edge, from: mappedExitId })),
      ],
      warnings: [
        ...caller.warnings,
        ...callee.warnings.map((warning) => `[${callee.functionName}] ${warning}`),
      ],
    },
    nodeIdMap,
  };
}
