// webview/layout/run-elk.ts
// Vỏ mỏng quanh elkjs. Không có logic nào ở đây đáng test riêng - phần thuần nằm ở
// `elk-input.ts` (dựng input) và ở `metrics.ts` (đo kết quả).
//
// Dùng `elk.bundled.js`: bản có sẵn worker nhúng, không cần `workerUrl`. Webview của VS Code
// chặn script ngoài bằng CSP nên nạp worker từ URL riêng là ngõ chết.

import ELK from "elkjs/lib/elk.bundled.js";

import type { DisplayGraph } from "../model/display-graph";
import type { DisplaySettings } from "../settings";
import { defaultSettings } from "../settings";
import { toElkGraph } from "./elk-input";

export interface Point {
  x: number;
  y: number;
}

export interface LaidOutNode {
  /** Id HIỂN THỊ - tra `DisplayGraph.nodes` để lấy `sourceId`, style, code. */
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutEdge {
  /** Vị trí trong `DisplayGraph.edges`. Đó là ánh xạ về nhãn và cờ `isBackEdge`. */
  index: number;
  /** Đường gấp khúc đã ghép: startPoint + bendPoints + endPoint của mọi section. */
  points: Point[];
  label?: { text: string; x: number; y: number; width: number; height: number };
}

export interface Layout {
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

const elk = new ELK();

function edgeIndexOf(id: string): number {
  const parsed = Number.parseInt(id.slice("e_".length), 10);
  return Number.isNaN(parsed) ? -1 : parsed;
}

export async function runLayout(
  graph: DisplayGraph,
  settings: DisplaySettings = defaultSettings(),
): Promise<Layout> {
  const laid = await elk.layout(toElkGraph(graph, settings));

  const nodes: LaidOutNode[] = (laid.children ?? []).map((child) => ({
    id: child.id,
    x: child.x ?? 0,
    y: child.y ?? 0,
    width: child.width ?? 0,
    height: child.height ?? 0,
  }));

  const edges: LaidOutEdge[] = [];
  for (const edge of laid.edges ?? []) {
    const points: Point[] = [];
    for (const section of edge.sections ?? []) {
      if (points.length === 0) points.push(section.startPoint);
      for (const bend of section.bendPoints ?? []) points.push(bend);
      points.push(section.endPoint);
    }
    const label = edge.labels?.[0];
    edges.push({
      index: edgeIndexOf(edge.id),
      points,
      ...(label === undefined || label.text === undefined
        ? {}
        : {
            label: {
              text: label.text,
              x: label.x ?? 0,
              y: label.y ?? 0,
              width: label.width ?? 0,
              height: label.height ?? 0,
            },
          }),
    });
  }

  return { width: laid.width ?? 0, height: laid.height ?? 0, nodes, edges };
}
