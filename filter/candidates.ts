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
    const primary = node.condition?.parsed;
    const parsedItems =
      node.condition?.parsedConjuncts ?? (primary === undefined ? [] : [primary]);
    const valuesByVariable = new Map<string, Set<string>>();
    for (const parsed of parsedItems) {
      let values = valuesByVariable.get(parsed.variable);
      if (values === undefined) {
        values = new Set();
        valuesByVariable.set(parsed.variable, values);
      }
      const parsedValues = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
      for (const value of parsedValues) values.add(value);
    }
    for (const [variable, values] of valuesByVariable) {
      let candidate = found.get(variable);
      if (candidate === undefined) {
        candidate = { values: new Set(), certainNodes: 0, unknownNodes: 0 };
        found.set(variable, candidate);
      }
      candidate[node.confidence === "certain" ? "certainNodes" : "unknownNodes"] += 1;
      for (const value of values) candidate.values.add(value);
    }
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
