// scripts/measure-legacy.ts
// Phép đo fanout ĐÚNG PROTOCOL (TODO.md 3b) trên codebase legacy THẬT.
//
// Chạy: npm run measure:legacy -- <file.ts> [file.ts ...]
//
// Quy trình:
//  1. Quét AST tìm mọi hàm có thân, chạy analyzer trên từng hàm.
//  2. Giữ hàm có ít nhất một node `finally`. Ghi lại: số vùng finally, in-degree lớn nhất,
//     và vùng finally có nằm trên chu trình (tức trong vòng lặp) hay không.
//  3. Với các hàm đủ điều kiện, chạy ELK hai lần (có/không fanout) và in metric.
//
// KHÔNG ghi golden ra đĩa: source của codebase legacy là của người dùng, không được commit
// vào repo này. Chỉ SỐ LIỆU đi vào TODO.md.

import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { analyzeFunctionAtCursor } from "../analyzer/typescript/index";
import type { FlowGraph } from "../shared/types";
import { edgeCrossings, totalEdgeLength } from "../webview/layout/metrics";
import { runLayout } from "../webview/layout/run-elk";
import { markBackEdges } from "../webview/model/back-edges";
import { toDisplayGraph } from "../webview/model/display-graph";
import { fanoutFinallyRegions } from "../webview/model/finally-fanout";

const files = process.argv.slice(2).filter((a) => a.endsWith(".ts"));
if (files.length === 0) {
  console.error("dùng: npm run measure:legacy -- <file.ts> [file.ts ...]");
  process.exit(1);
}

/** Vị trí con trỏ nằm chắc chắn trong thân hàm, không lọt vào hàm lồng. */
function functionCursors(sourceFile: ts.SourceFile): Array<{ line: number; column: number }> {
  const cursors: Array<{ line: number; column: number }> = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessor(node) ||
        ts.isSetAccessor(node)) &&
      node.body !== undefined &&
      ts.isBlock(node.body)
    ) {
      // +1 để vượt qua dấu `{`: điểm này thuộc thân hàm này, chưa thuộc hàm lồng nào.
      const pos = node.body.getStart(sourceFile) + 1;
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
      cursors.push({ line: line + 1, column: character });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return cursors;
}

/** Node `finally` nào nằm trên chu trình -> vùng đó ở trong vòng lặp. */
function finallyInLoop(graph: FlowGraph): boolean {
  const adj = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) adj.get(e.from)?.push(e.to);

  for (const marker of graph.nodes.filter((n) => n.kind === "finally")) {
    const seen = new Set<string>();
    const stack = [...(adj.get(marker.id) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (id === marker.id) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(adj.get(id) ?? []));
    }
  }
  return false;
}

interface Candidate {
  file: string;
  graph: FlowGraph;
  regions: number;
  maxInDegree: number;
  inLoop: boolean;
}

const candidates: Candidate[] = [];

for (const file of files) {
  const absolute = path.resolve(file);
  const sourceText = readFileSync(absolute, "utf8");
  const sourceFile = ts.createSourceFile(
    absolute,
    sourceText,
    { languageVersion: ts.ScriptTarget.Latest },
    true,
    ts.ScriptKind.TS,
  );

  const seen = new Set<string>();
  for (const cursor of functionCursors(sourceFile)) {
    let graph: FlowGraph;
    try {
      graph = analyzeFunctionAtCursor({ filePath: absolute, sourceText, ...cursor });
    } catch {
      continue; // NO_FUNCTION_AT_CURSOR / CURSOR_OUT_OF_RANGE - bỏ qua, không phải lỗi ở đây.
    }
    const key = `${graph.functionName}@${graph.nodes.length}/${graph.edges.length}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const markers = graph.nodes.filter((n) => n.kind === "finally");
    if (markers.length === 0) continue;

    const inbound = new Map<string, number>();
    for (const e of graph.edges) inbound.set(e.to, (inbound.get(e.to) ?? 0) + 1);

    candidates.push({
      file: path.basename(file),
      graph,
      regions: markers.length,
      maxInDegree: Math.max(...markers.map((m) => inbound.get(m.id) ?? 0)),
      inLoop: finallyInLoop(graph),
    });
  }
}

// Ưu tiên hàm to và xấu: nhiều vùng finally, in-degree cao, vùng nằm trong vòng lặp.
candidates.sort(
  (a, b) =>
    Number(b.inLoop) - Number(a.inLoop) ||
    b.regions - a.regions ||
    b.maxInDegree - a.maxInDegree ||
    b.graph.nodes.length - a.graph.nodes.length,
);

console.log(`Tìm được ${candidates.length} hàm có vùng finally.\n`);
console.log("ứng viên (đã xếp theo độ xấu):");
for (const c of candidates.slice(0, 12)) {
  console.log(
    `  ${c.file} :: ${c.graph.functionName}`.padEnd(72) +
      `nodes=${String(c.graph.nodes.length).padStart(4)} vùng=${c.regions} ` +
      `maxIn=${c.maxInDegree} trongLoop=${c.inLoop ? "CÓ" : "không"}`,
  );
}

const targets = candidates.slice(0, Math.max(3, Math.min(6, candidates.length)));
console.log(`\nĐo ${targets.length} hàm:\n`);
console.log("| hàm | node | vùng finally | trong loop | crossings | tổng chiều dài | theo luật |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");

const pct = (before: number, after: number): string => {
  if (before === 0) return after === 0 ? "0%" : "0 → tăng";
  const delta = ((after - before) / before) * 100;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
};

let wins = 0;
for (const c of targets) {
  const plain = markBackEdges(toDisplayGraph(c.graph));
  const fanned = markBackEdges(fanoutFinallyRegions(toDisplayGraph(c.graph)));
  const [a, b] = await Promise.all([runLayout(plain), runLayout(fanned)]);

  const crossBefore = edgeCrossings(a);
  const crossAfter = edgeCrossings(b);
  const lenBefore = totalEdgeLength(a);
  const lenAfter = totalEdgeLength(b);

  const crossDrop = crossBefore === 0 ? 0 : (crossBefore - crossAfter) / crossBefore;
  const lenGrowth = lenBefore === 0 ? 0 : (lenAfter - lenBefore) / lenBefore;
  const won = crossDrop >= 0.2 && lenGrowth <= 0.1;
  if (won) wins += 1;

  console.log(
    `| \`${c.graph.functionName}\` | ${plain.nodes.length} → ${fanned.nodes.length} | ` +
      `${c.regions} | ${c.inLoop ? "CÓ" : "không"} | ` +
      `${crossBefore} → ${crossAfter} (${pct(crossBefore, crossAfter)}) | ` +
      `${Math.round(lenBefore)} → ${Math.round(lenAfter)} (${pct(lenBefore, lenAfter)}) | ` +
      `${won ? "THẮNG" : "không"} |`,
  );
}

console.log(`\n${wins}/${targets.length} hàm thoả luật đã chốt trước (crossings -20%, length +10%).`);
