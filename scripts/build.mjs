// scripts/build.mjs
// Bundle hai target bằng esbuild. Chạy: `npm run build` hoặc `npm run watch`.
//
// Hai target KHÁC NHAU về format và platform, không gộp được:
//
//  - extension host: CommonJS. VS Code `require()` file main, không nạp được ESM. Root
//    package.json có "type": "module" nên đuôi phải là `.cjs` để Node coi là CJS.
//    `vscode` là module do host cung cấp lúc runtime -> external.
//    `typescript` (analyzer cần) để external và lấy từ node_modules -> tránh bundle ~9MB.
//
//  - webview: IIFE cho browser. Bundle luôn elkjs vào trong vì webview không `require`
//    được từ node_modules, và CSP của webview chặn script ngoài.

import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");
const dev = watch || process.argv.includes("--dev");

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  logLevel: "info",
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  target: "es2022",
  absWorkingDir: root,
};

/** @type {import("esbuild").BuildOptions[]} */
const targets = [
  {
    ...common,
    entryPoints: [path.join(root, "extension/extension.ts")],
    outfile: path.join(root, "dist/extension.cjs"),
    platform: "node",
    format: "cjs",
    external: ["vscode", "typescript"],
  },
  {
    ...common,
    entryPoints: [path.join(root, "webview/main.ts")],
    outfile: path.join(root, "dist/webview.js"),
    platform: "browser",
    format: "iife",
  },
];

await rm(path.join(root, "dist"), { recursive: true, force: true });

if (watch) {
  const contexts = await Promise.all(targets.map((t) => esbuild.context(t)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("watching...");
} else {
  await Promise.all(targets.map((t) => esbuild.build(t)));
}
