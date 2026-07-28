// Đo filter trên ba FlowGraph dump từ swa-be.
//
// Protocol chọn constraint (đăng ký trong code, không chọn lại sau khi thấy kết quả):
// 1. biến có nhiều node `condition.parsed` nhất;
// 2. giá trị literal xuất hiện nhiều nhất với biến đó;
// 3. hoà thì xếp từ điển để kết quả deterministic.
//
// Chạy: npm run measure:filter

import { readFileSync } from "node:fs";
import path from "node:path";

import { filterGraph, filterStats } from "../filter/filterGraph";
import type { FlowGraph, ParsedCondition } from "../shared/types";

const root = path.resolve(import.meta.dirname, "..");
const localDir = path.join(root, "webview/dev/local");
const FILES = [
  "1050-ReceiveService.actionReceivedNew-receive.service.json",
  "0714-ShipService.syncASNSGB-ship.service.json",
  "0304-VFCService.sendGoodReceipt-vfc.service.json",
] as const;

interface VariableStats {
  variable: string;
  nodes: number;
  certain: number;
  unknown: number;
  values: Map<string, number>;
}

function loadGraph(file: string): FlowGraph {
  const parsed: unknown = JSON.parse(readFileSync(path.join(localDir, file), "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("nodes" in parsed) ||
    !Array.isArray(parsed.nodes) ||
    !("edges" in parsed) ||
    !Array.isArray(parsed.edges) ||
    !("warnings" in parsed) ||
    !Array.isArray(parsed.warnings)
  ) {
    throw new Error(`${file}: không phải FlowGraph JSON`);
  }
  return parsed as FlowGraph;
}

function literalValues(parsed: ParsedCondition): readonly string[] {
  return Array.isArray(parsed.value) ? parsed.value : [parsed.value];
}

function selectConstraint(graph: FlowGraph): {
  variable: string;
  value: string;
  nodes: number;
  certain: number;
  unknown: number;
} {
  const byVariable = new Map<string, VariableStats>();
  for (const node of graph.nodes) {
    const parsed = node.condition?.parsed;
    if (parsed === undefined) continue;
    let stats = byVariable.get(parsed.variable);
    if (stats === undefined) {
      stats = {
        variable: parsed.variable,
        nodes: 0,
        certain: 0,
        unknown: 0,
        values: new Map(),
      };
      byVariable.set(parsed.variable, stats);
    }
    stats.nodes += 1;
    stats[node.confidence] += 1;
    for (const value of literalValues(parsed)) {
      stats.values.set(value, (stats.values.get(value) ?? 0) + 1);
    }
  }

  const selected = [...byVariable.values()].sort(
    (left, right) => right.nodes - left.nodes || left.variable.localeCompare(right.variable),
  )[0];
  if (selected === undefined) throw new Error(`${graph.functionName}: không có condition.parsed`);
  const value = [...selected.values].sort(
    ([leftValue, leftCount], [rightValue, rightCount]) =>
      rightCount - leftCount || leftValue.localeCompare(rightValue),
  )[0]?.[0];
  if (value === undefined) throw new Error(`${graph.functionName}: parsed không có literal`);
  return {
    variable: selected.variable,
    value,
    nodes: selected.nodes,
    certain: selected.certain,
    unknown: selected.unknown,
  };
}

console.log("| hàm | constraint chọn theo protocol | parsed node (certain/unknown) | đang ẩn N/M | prune |");
console.log("| --- | --- | ---: | ---: | ---: |");

for (const file of FILES) {
  const input = loadGraph(file);
  const selected = selectConstraint(input);
  const output = filterGraph(input, { [selected.variable]: selected.value });
  const stats = filterStats(input, output);
  const ratio = stats.total === 0 ? 0 : (stats.hidden / stats.total) * 100;
  console.log(
    `| \`${input.functionName}\` | \`${selected.variable}=${JSON.stringify(selected.value)}\` | ` +
      `${selected.nodes} (${selected.certain}/${selected.unknown}) | ` +
      `${stats.hidden}/${stats.total} | ${ratio.toFixed(1)}% |`,
  );
}
