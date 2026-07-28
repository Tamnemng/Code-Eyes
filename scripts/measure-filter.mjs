// Bundle driver TypeScript rồi chạy bằng Node. Output bundle nằm trong dist/ đã gitignore.

import { spawnSync } from "node:child_process";
import path from "node:path";

import * as esbuild from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const outfile = path.join(root, "dist/measure-filter.mjs");

await esbuild.build({
  entryPoints: [path.join(root, "scripts/measure-filter.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  logLevel: "warning",
  absWorkingDir: root,
});

const run = spawnSync(process.execPath, [outfile], { stdio: "inherit", cwd: root });
process.exit(run.status ?? 1);
