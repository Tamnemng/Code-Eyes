// scripts/gen-golden.mjs
// Bundle `gen-golden.ts` rồi chạy nó. Cần bước bundle vì driver là TypeScript và import
// analyzer (kéo theo package `typescript`) - Node không nạp TS trực tiếp được.
//
// Output bundle đi vào `dist/` (đã .gitignore); chỉ JSON golden là commit.

import { spawnSync } from "node:child_process";
import path from "node:path";

import * as esbuild from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
// ESM, không CJS: driver dùng `import.meta.dirname` để tự định vị root, và esbuild làm
// rỗng `import.meta` khi output CJS.
const outfile = path.join(root, "dist/measure-legacy.mjs");

await esbuild.build({
  entryPoints: [path.join(root, "scripts/measure-legacy.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  external: ["typescript"],
  logLevel: "warning",
  absWorkingDir: root,
});

const run = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: "inherit", cwd: root });
process.exit(run.status ?? 1);
