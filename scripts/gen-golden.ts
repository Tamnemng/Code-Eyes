// scripts/gen-golden.ts
// Sinh golden `FlowGraph` JSON cho test của webview. Chạy: `npm run golden`.
//
// TẠI SAO tồn tại: test của webview không được import `analyzer/` (ràng buộc 1), nhưng
// `FlowGraph` viết tay thì có nguy cơ bịa ra cấu trúc analyzer không bao giờ sinh - đúng
// loại lỗi mà tool này ra đời để chống. Script này là công cụ build (không phải một tầng):
// nó chạy analyzer thật trên fixture nguồn rồi ghi JSON đã commit. Test chỉ đọc JSON.
//
// Golden phải commit. Sinh lại và diff bẩn = analyzer đã đổi hành vi → xem lại rồi commit
// golden mới, đừng sửa test cho khớp.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { analyzeFunctionAtCursor } from "../analyzer/typescript/index";

const root = path.resolve(import.meta.dirname, "..");
const fixtureDir = path.join(root, "webview/__tests__/fixtures");
const goldenDir = path.join(root, "webview/__tests__/golden");

/** Mỗi fixture nguồn → các hàm cần sinh golden. */
const TARGETS: ReadonlyArray<{ file: string; functions: readonly string[] }> = [
  { file: "a-finally-fanout.ts", functions: ["shipOrder"] },
  { file: "b-nested-regions.ts", functions: ["pipeline"] },
  { file: "c-loops.ts", functions: ["scan", "drain", "bailOut"] },
  { file: "d-confidence.ts", functions: ["route"] },
  { file: "e-all-kinds.ts", functions: ["everything"] },
  { file: "f-worst-case.ts", functions: ["processBatch"] },
  {
    file: "g-filter.ts",
    functions: [
      "routeClient",
      "noDefault",
      "complexSwitch",
      "asymmetric",
      "throughFinally",
      "cyclic",
      "terminalLoop",
      "withDeadCode",
      "operators",
    ],
  },
];

/**
 * Vị trí con trỏ = token tên hàm. Với `export function foo`, range của FunctionDeclaration
 * phủ cả tên, nên `findInnermostFunction` chọn đúng hàm đó. Chỉ đúng cho hàm khai báo ở
 * top level - mọi fixture ở đây đều vậy.
 */
function cursorAtFunctionName(source: string, name: string): { line: number; column: number } {
  const offset = source.search(new RegExp(`function ${name}\\b`));
  if (offset < 0) throw new Error(`không tìm thấy \`function ${name}\` trong fixture`);
  const nameOffset = offset + "function ".length;
  const before = source.slice(0, nameOffset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1) ?? "").length };
}

mkdirSync(goldenDir, { recursive: true });

let written = 0;
for (const { file, functions } of TARGETS) {
  const filePath = path.join(fixtureDir, file);
  const sourceText = readFileSync(filePath, "utf8");
  for (const fn of functions) {
    const { line, column } = cursorAtFunctionName(sourceText, fn);
    const graph = analyzeFunctionAtCursor({ filePath, line, column, sourceText });
    if (graph.functionName !== fn) {
      throw new Error(`con trỏ trượt: mong \`${fn}\`, analyzer trả \`${graph.functionName}\``);
    }
    // `filePath` tuyệt đối sẽ khác nhau trên từng máy → golden diff bẩn vô nghĩa.
    // Chuẩn hoá về đường dẫn tương đối, dùng dấu / để Windows và POSIX ra cùng kết quả.
    const stable = { ...graph, filePath: `webview/__tests__/fixtures/${file}` };
    const out = path.join(goldenDir, `${path.basename(file, ".ts")}-${fn}.json`);
    writeFileSync(out, `${JSON.stringify(stable, null, 2)}\n`, "utf8");
    written += 1;
    console.log(
      `  ${path.relative(root, out).replace(/\\/g, "/")}` +
        `  nodes=${graph.nodes.length} edges=${graph.edges.length}` +
        ` warnings=${graph.warnings.length}`,
    );
  }
}
console.log(`\n${written} golden đã ghi.`);
