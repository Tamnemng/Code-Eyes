// scripts/import-local.ts
// Nạp code THẬT của bạn vào dev harness.
//
// Chạy:
//   npm run import:local -- <file.ts|thư-mục> [...]  [--min-nodes=15] [--max=200]
//
// Ghi golden vào `webview/dev/local/` - thư mục ĐÃ .gitignore. Golden chứa source gốc, nên
// code của bạn KHÔNG bao giờ đi vào repo này. Muốn xoá thì xoá thư mục đó.
//
// Vì sao cần bước này: harness đọc `FlowGraph` JSON, không đọc file .ts - nó là tầng webview,
// không được import `analyzer/` (ràng buộc 1). Script này là công cụ build, nó được phép.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { analyzeFunctionAtCursor } from "../analyzer/typescript/index";
import type { FlowGraph } from "../shared/types";

const OUT_DIR = path.join(import.meta.dirname, "..", "webview/dev/local");

const args = process.argv.slice(2);
const inputs = args.filter((a) => !a.startsWith("--"));
const numberFlag = (name: string, fallback: number): number => {
  const raw = args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

/** Hàm nhỏ không đáng xem bằng tool này - đọc thẳng code còn nhanh hơn. */
const MIN_NODES = numberFlag("min-nodes", 15);
const MAX_FILES = numberFlag("max", 200);

if (inputs.length === 0) {
  console.error("dùng: npm run import:local -- <file.ts|thư-mục> [...] [--min-nodes=15] [--max=200]");
  process.exit(1);
}

const SKIP_DIR = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

function collectFiles(target: string): string[] {
  const absolute = path.resolve(target);
  const info = statSync(absolute, { throwIfNoEntry: false });
  if (info === undefined) {
    console.warn(`  bỏ qua (không tồn tại): ${target}`);
    return [];
  }
  if (info.isFile()) return absolute.endsWith(".ts") ? [absolute] : [];

  const found: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue;
      found.push(...collectFiles(path.join(absolute, entry.name)));
      continue;
    }
    const name = entry.name;
    if (!name.endsWith(".ts")) continue;
    if (name.endsWith(".d.ts") || name.endsWith(".spec.ts") || name.endsWith(".test.ts")) continue;
    found.push(path.join(absolute, name));
  }
  return found;
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
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.body.getStart(sourceFile) + 1,
      );
      cursors.push({ line: line + 1, column: character });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return cursors;
}

function safeName(value: string): string {
  return value.replace(/[<>:"/\\|?*\s]+/g, "_").slice(0, 80);
}

const files = [...new Set(inputs.flatMap(collectFiles))].sort();
console.log(`Quét ${files.length} file .ts, giữ hàm >= ${MIN_NODES} node...\n`);

interface Found {
  graph: FlowGraph;
  file: string;
}

const found: Found[] = [];
let scanned = 0;
let tooSmall = 0;
let failed = 0;

for (const file of files) {
  const sourceText = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    { languageVersion: ts.ScriptTarget.Latest },
    true,
    ts.ScriptKind.TS,
  );

  const seen = new Set<string>();
  for (const cursor of functionCursors(sourceFile)) {
    scanned += 1;
    let graph: FlowGraph;
    try {
      graph = analyzeFunctionAtCursor({ filePath: file, sourceText, ...cursor });
    } catch {
      failed += 1;
      continue;
    }
    const key = `${graph.functionName}@${graph.nodes.length}/${graph.edges.length}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (graph.nodes.length < MIN_NODES) {
      tooSmall += 1;
      continue;
    }
    found.push({ graph, file });
  }
}

// Hàm to trước - đó là lý do tool này tồn tại.
found.sort((a, b) => b.graph.nodes.length - a.graph.nodes.length);

const kept = found.slice(0, MAX_FILES);
const dropped = found.length - kept.length;

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

for (const { graph, file } of kept) {
  const base = path.basename(file, ".ts");
  // Tiền tố là số node có pad 0 -> harness sắp được theo độ lớn mà không cần đọc nội dung.
  const name = `${String(graph.nodes.length).padStart(4, "0")}-${safeName(graph.functionName)}-${safeName(base)}.json`;
  // Đường dẫn tuyệt đối chỉ dùng để `revealNode`; ở harness không có editor nên giữ nguyên
  // là vô hại, nhưng cắt bớt cho gọn khi hiện trên panel.
  writeFileSync(path.join(OUT_DIR, name), `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

console.log(`Đã quét   : ${scanned} hàm trong ${files.length} file`);
console.log(`Bỏ (nhỏ)  : ${tooSmall} hàm < ${MIN_NODES} node`);
if (failed > 0) console.log(`Bỏ (lỗi)  : ${failed} hàm analyzer không dựng được`);
// Không cắt im lặng: nếu có hàm bị bỏ vì --max thì phải nói ra.
if (dropped > 0) {
  console.log(`Bỏ (--max): ${dropped} hàm nữa đủ điều kiện nhưng vượt --max=${MAX_FILES}`);
}
console.log(`\nĐã ghi ${kept.length} golden vào webview/dev/local/ (đã .gitignore)`);
if (kept.length > 0) {
  console.log("\nTo nhất:");
  for (const { graph, file } of kept.slice(0, 15)) {
    console.log(
      `  ${String(graph.nodes.length).padStart(4)} node  ${graph.functionName}` +
        `  (${path.basename(file)}, ${graph.warnings.length} warning)`,
    );
  }
}
console.log("\nChạy `npm run dev` rồi chọn trong dropdown (nhóm 'local').");
