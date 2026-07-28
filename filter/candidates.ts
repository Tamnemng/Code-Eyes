// Danh sách biến an toàn để UI filter hiển thị. Chỉ đọc metadata `condition.parsed`;
// không đoán từ raw source vì đoán sai ở đây có thể dẫn tới prune nhánh sống.

import type { FlowGraph } from "../shared/types";

export interface FilterCandidate {
  variable: string;
  values: string[];
  certainNodes: number;
  unknownNodes: number;
}

export function collectFilterCandidates(graph: FlowGraph): FilterCandidate[] {
  const found = new Map<
    string,
    { values: Set<string>; certainNodes: number; unknownNodes: number }
  >();

  for (const node of graph.nodes) {
    const parsed = node.condition?.parsed;
    if (parsed === undefined) continue;
    let candidate = found.get(parsed.variable);
    if (candidate === undefined) {
      candidate = { values: new Set(), certainNodes: 0, unknownNodes: 0 };
      found.set(parsed.variable, candidate);
    }
    candidate[node.confidence === "certain" ? "certainNodes" : "unknownNodes"] += 1;
    const values = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
    for (const value of values) candidate.values.add(value);
  }

  return [...found]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([variable, candidate]) => ({
      variable,
      values: [...candidate.values].sort(),
      certainNodes: candidate.certainNodes,
      unknownNodes: candidate.unknownNodes,
    }));
}
