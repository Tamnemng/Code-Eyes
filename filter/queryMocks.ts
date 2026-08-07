// Mock query/runtime không cố diễn giải object DB. Người dùng ép trực tiếp kết quả boolean của
// một condition; filter vẫn chỉ cắt edge thật trong FlowGraph và không thực thi source code.

import type { FlowGraph } from "../shared/types";

export const QUERY_MOCK_PREFIX = "@condition:";

export interface QueryMockCandidate {
  key: string;
  nodeId: string;
  label: string;
  line: number;
}

export function queryMockKey(nodeId: string): string {
  return `${QUERY_MOCK_PREFIX}${nodeId}`;
}

export function isQueryMockKey(key: string): boolean {
  return key.startsWith(QUERY_MOCK_PREFIX);
}

export function collectQueryMockCandidates(graph: FlowGraph): QueryMockCandidate[] {
  const truthLabels = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.label !== "true" && edge.label !== "false") continue;
    const labels = truthLabels.get(edge.from);
    if (labels === undefined) truthLabels.set(edge.from, new Set([edge.label]));
    else labels.add(edge.label);
  }

  return graph.nodes
    .filter((node) => node.kind === "condition" && truthLabels.get(node.id)?.size === 2)
    .map((node) => ({
      key: queryMockKey(node.id),
      nodeId: node.id,
      label: node.condition?.raw ?? node.label,
      line: node.range.startLine,
    }));
}
