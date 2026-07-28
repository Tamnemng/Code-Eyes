// scripts/measure-fanout.ts
// Chạy ELK hai lần cho mỗi graph - có và không có fanout - rồi in metric đã pre-register ở
// TODO.md 3b: số cạnh cắt nhau (primary) và tổng chiều dài cạnh (secondary).
//
// Chạy: `npm run measure:fanout`
//
// GIỚI HẠN: protocol đòi hàm LEGACY THẬT. Repo này không có một câu `try`/`finally` nào ngoài
// fixture (kiểm bằng grep trên toàn bộ source không phải test), nên script này chạy trên
// golden fixture và kết quả là THĂM DÒ, không phải kết quả của protocol.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { FlowGraph } from "../shared/types";
import { edgeCrossings, totalEdgeLength } from "../webview/layout/metrics";
import { runLayout } from "../webview/layout/run-elk";
import { markBackEdges } from "../webview/model/back-edges";
import { toDisplayGraph } from "../webview/model/display-graph";
import { fanoutFinallyRegions } from "../webview/model/finally-fanout";

const goldenDir = path.join(import.meta.dirname, "..", "webview/__tests__/golden");

const pct = (before: number, after: number): string => {
  if (before === 0) return after === 0 ? "0%" : "+inf";
  const delta = ((after - before) / before) * 100;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
};

const rows: string[] = [];
let decisive = 0;

for (const file of readdirSync(goldenDir).sort()) {
  if (!file.endsWith(".json")) continue;
  const parsed: unknown = JSON.parse(readFileSync(path.join(goldenDir, file), "utf8"));
  const graph = parsed as FlowGraph;
  if (!graph.nodes.some((n) => n.kind === "finally")) continue;

  const plain = markBackEdges(toDisplayGraph(graph));
  const fanned = markBackEdges(fanoutFinallyRegions(toDisplayGraph(graph)));

  const [a, b] = await Promise.all([runLayout(plain), runLayout(fanned)]);
  const crossBefore = edgeCrossings(a);
  const crossAfter = edgeCrossings(b);
  const lenBefore = totalEdgeLength(a);
  const lenAfter = totalEdgeLength(b);

  // Luật đã chốt TRƯỚC: thắng khi crossings giảm >= 20% mà chiều dài tăng <= 10%.
  const crossDrop = crossBefore === 0 ? 0 : (crossBefore - crossAfter) / crossBefore;
  const lenGrowth = lenBefore === 0 ? 0 : (lenAfter - lenBefore) / lenBefore;
  const wins = crossDrop >= 0.2 && lenGrowth <= 0.1;
  if (wins) decisive += 1;

  rows.push(
    `| \`${file.replace(".json", "")}\` | ${plain.nodes.length} → ${fanned.nodes.length} | ` +
      `${crossBefore} → ${crossAfter} (${pct(crossBefore, crossAfter)}) | ` +
      `${Math.round(lenBefore)} → ${Math.round(lenAfter)} (${pct(lenBefore, lenAfter)}) | ` +
      `${wins ? "THẮNG" : "không"} |`,
  );
  console.log(rows.at(-1));
}

console.log(`\n${decisive}/${rows.length} graph thoả luật "crossings -20% và length +10%".`);
console.log(
  decisive === rows.length && rows.length > 0
    ? "=> fanout thắng trên MỌI graph đo được."
    : '=> hoà/mập mờ hoặc chỉ thắng một phần => theo luật đã chốt: FANOUT_ENABLED = false.',
);
console.log("\n--- dán vào TODO.md 3b ---");
console.log("| graph | node | crossings | tổng chiều dài | theo luật |");
console.log("| --- | --- | --- | --- | --- |");
for (const row of rows) console.log(row);
