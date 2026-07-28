// webview/__tests__/helpers/golden.ts
// Nạp golden `FlowGraph` JSON do `npm run golden` sinh ra.
//
// Cố tình KHÔNG dùng `import ... from "*.json"` + cast: cast là lời hứa không ai kiểm.
// Ở đây kiểu `FlowGraph` được KIẾM bằng validate thật, nên nó cũng là lưới an toàn: golden
// lệch schema thì test đỏ ngay ở chỗ nạp, kèm đường dẫn, chứ không đỏ mơ hồ ở giữa assertion.

import { readFileSync } from "node:fs";
import path from "node:path";

import type { FlowEdge, FlowGraph, FlowNode, NodeKind } from "../../../shared/types";

const GOLDEN_DIR = path.join(import.meta.dirname, "..", "golden");

const NODE_KINDS: readonly NodeKind[] = [
  "entry", "exit", "statement", "condition", "loop", "switch-case",
  "try", "catch", "finally", "return", "throw", "break", "continue", "call",
];

const EDGE_LABELS: readonly NonNullable<FlowEdge["label"]>[] = [
  "true", "false", "case", "default", "exception", "loop-back",
];

function fail(where: string, message: string): never {
  throw new Error(`golden ${where}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNode(value: unknown, where: string): asserts value is FlowNode {
  if (!isRecord(value)) fail(where, "node không phải object");
  if (typeof value["id"] !== "string") fail(where, "node.id thiếu");
  if (typeof value["label"] !== "string") fail(where, `node ${value["id"]}: label thiếu`);
  if (typeof value["code"] !== "string") fail(where, `node ${value["id"]}: code thiếu`);
  if (!NODE_KINDS.includes(value["kind"] as NodeKind)) {
    fail(where, `node ${value["id"]}: kind lạ ${String(value["kind"])}`);
  }
  if (value["confidence"] !== "certain" && value["confidence"] !== "unknown") {
    fail(where, `node ${value["id"]}: confidence lạ ${String(value["confidence"])}`);
  }
  const range = value["range"];
  if (!isRecord(range)) fail(where, `node ${value["id"]}: range thiếu`);
  for (const key of ["startLine", "startCol", "endLine", "endCol"]) {
    if (typeof range[key] !== "number") fail(where, `node ${value["id"]}: range.${key} thiếu`);
  }
  if (value["parentId"] !== undefined && typeof value["parentId"] !== "string") {
    fail(where, `node ${value["id"]}: parentId không phải string`);
  }
}

function assertEdge(value: unknown, where: string): asserts value is FlowEdge {
  if (!isRecord(value)) fail(where, "edge không phải object");
  if (typeof value["from"] !== "string" || typeof value["to"] !== "string") {
    fail(where, "edge.from/to thiếu");
  }
  const label = value["label"];
  if (label !== null && label !== undefined && !EDGE_LABELS.includes(label as never)) {
    fail(where, `edge ${value["from"]}->${value["to"]}: label lạ ${String(label)}`);
  }
}

function assertFlowGraph(value: unknown, where: string): asserts value is FlowGraph {
  if (!isRecord(value)) fail(where, "không phải object");
  if (typeof value["functionName"] !== "string") fail(where, "functionName thiếu");
  if (typeof value["filePath"] !== "string") fail(where, "filePath thiếu");
  if (value["language"] !== "typescript" && value["language"] !== "csharp") {
    fail(where, `language lạ ${String(value["language"])}`);
  }
  const { nodes, edges, warnings } = value;
  if (!Array.isArray(nodes)) fail(where, "nodes không phải array");
  if (!Array.isArray(edges)) fail(where, "edges không phải array");
  if (!Array.isArray(warnings) || warnings.some((w) => typeof w !== "string")) {
    fail(where, "warnings phải là string[]");
  }
  for (const n of nodes) assertNode(n, where);
  for (const e of edges) assertEdge(e, where);

  const ids = new Set((nodes as FlowNode[]).map((n) => n.id));
  for (const e of edges as FlowEdge[]) {
    if (!ids.has(e.from)) fail(where, `edge trỏ từ id không tồn tại: ${e.from}`);
    if (!ids.has(e.to)) fail(where, `edge trỏ tới id không tồn tại: ${e.to}`);
  }
}

/** Tên golden không kèm `.json`, vd `"a-finally-fanout-shipOrder"`. */
export function loadGolden(name: string): FlowGraph {
  const file = path.join(GOLDEN_DIR, `${name}.json`);
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  assertFlowGraph(parsed, name);
  return parsed;
}
