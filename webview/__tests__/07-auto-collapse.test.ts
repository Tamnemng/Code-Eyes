import { describe, expect, it } from "vitest";

import type { FlowNode } from "../../shared/types";
import type { DisplayGraph, DisplayNode } from "../model/display-graph";
import { toDisplayGraph } from "../model/display-graph";
import { RENDER_GUARD, USER_THRESHOLD, initialCollapsedIds } from "../model/auto-collapse";
import { applyCollapse } from "../model/collapse";
import { loadGolden } from "./helpers/golden";

function plain(name: string): DisplayGraph {
  return toDisplayGraph(loadGolden(name));
}

/**
 * Graph tổng hợp để thử NGƯỠNG. Cố ý không dùng golden: ở đây đang test một con số, không
 * test cấu trúc analyzer, và không có hàm fixture nào đủ 300 node.
 *
 * Hình dạng: `entry -> root_i -> child_i_j -> ... -> exit`, mỗi root có `childrenPer` con.
 */
function syntheticGraph(roots: number, childrenPer: number, copiesPerNode = 1): DisplayGraph {
  const nodes: DisplayNode[] = [];
  const edges: DisplayGraph["edges"] = [];

  const flow = (id: string, kind: FlowNode["kind"], parentId?: string): FlowNode => ({
    id,
    kind,
    label: id,
    code: id,
    range: { startLine: 1, startCol: 0, endLine: 1, endCol: 1 },
    confidence: "certain",
    ...(parentId === undefined ? {} : { parentId }),
  });

  const displayId = (sourceId: string, copy: number): string =>
    copiesPerNode === 1 ? sourceId : `${sourceId}#${copy + 1}`;

  const push = (node: FlowNode, parentSourceId?: string): void => {
    for (let c = 0; c < copiesPerNode; c += 1) {
      nodes.push({
        id: displayId(node.id, c),
        sourceId: node.id,
        displayLabel: node.label,
        // Bản sao thứ c trỏ về bản sao thứ c CỦA CHA - giống hệt cách `finally-fanout` nối
        // lại. Trỏ về id gốc của cha là sai và làm quan hệ cha-con đứt ở tầng vẽ.
        parentDisplayId: parentSourceId === undefined ? undefined : displayId(parentSourceId, c),
        node,
      });
    }
  };

  push(flow("entry", "entry"));
  push(flow("exit", "exit"));
  for (let r = 0; r < roots; r += 1) {
    const rootId = `root_${r}`;
    push(flow(rootId, "try"));
    edges.push({ from: "entry", to: rootId, label: null, isBackEdge: false });
    for (let c = 0; c < childrenPer; c += 1) {
      const childId = `${rootId}_c${c}`;
      push(flow(childId, "statement", rootId), rootId);
      edges.push({ from: rootId, to: childId, label: null, isBackEdge: false });
      edges.push({ from: childId, to: "exit", label: null, isBackEdge: false });
    }
  }
  return { functionName: "synthetic", filePath: "synthetic.ts", nodes, edges, warnings: [] };
}

describe("initialCollapsedIds - vùng finally luôn collapse (quyết định C)", () => {
  it("graph nhỏ: chỉ vùng finally bị collapse, không gì khác", () => {
    const graph = plain("b-nested-regions-pipeline");
    const collapsed = initialCollapsedIds(graph);
    const finallyIds = graph.nodes.filter((n) => n.node.kind === "finally").map((n) => n.sourceId);
    expect(collapsed).toEqual(new Set(finallyIds));
  });

  it("graph nhỏ không có finally -> không collapse gì", () => {
    expect(initialCollapsedIds(plain("c-loops-scan"))).toEqual(new Set());
    expect(initialCollapsedIds(plain("d-confidence-route"))).toEqual(new Set());
  });

  it("collapse vùng finally thật sự làm thân nó biến mất", () => {
    const graph = plain("e-all-kinds-everything");
    const view = applyCollapse(graph, initialCollapsedIds(graph));
    // n_21 `total += 0;` là thân của finally n_18.
    expect(view.graph.nodes.some((n) => n.id === "n_21")).toBe(false);
    expect(view.graph.nodes.some((n) => n.id === "n_18")).toBe(true);
  });

  it("collapse KHÔNG xoá hub, chỉ gộp nó lên marker (TODO.md 3c)", () => {
    const graph = plain("a-finally-fanout-shipOrder");
    const view = applyCollapse(graph, initialCollapsedIds(graph));
    const outFromMarker = view.graph.edges.filter((e) => e.from === "n_5");
    // Thân n_13 có 2 cạnh ra; sau khi gộp, marker n_5 gánh cả 2.
    expect(outFromMarker).toHaveLength(2);
  });
});

describe("initialCollapsedIds - hai ngưỡng", () => {
  it("USER_THRESHOLD = 300 đếm sourceId, RENDER_GUARD = 500 đếm node hiển thị", () => {
    // Hằng cố định. Cờ FANOUT_ENABLED đổi CON SỐ ĐO ĐƯỢC, không đổi mức chặn.
    expect(USER_THRESHOLD).toBe(300);
    expect(RENDER_GUARD).toBe(500);
  });

  it("dưới cả hai ngưỡng -> không collapse theo tầng", () => {
    const graph = syntheticGraph(10, 5); // 2 + 10 + 50 = 62 node
    expect(graph.nodes.length).toBeLessThan(USER_THRESHOLD);
    expect(initialCollapsedIds(graph)).toEqual(new Set());
  });

  it("vượt USER_THRESHOLD -> chỉ tầng ngoài cùng mở", () => {
    const graph = syntheticGraph(60, 6); // 2 + 60 + 360 = 422 sourceId
    expect(new Set(graph.nodes.map((n) => n.sourceId)).size).toBeGreaterThan(USER_THRESHOLD);

    const collapsed = initialCollapsedIds(graph);
    const view = applyCollapse(graph, collapsed);

    // Mọi node còn hiện phải là node tầng ngoài cùng (không có cha).
    for (const n of view.graph.nodes) {
      expect(n.parentDisplayId, `${n.id} không thuộc tầng ngoài cùng`).toBeUndefined();
    }
    // Và mọi root CÓ con đều mang badge.
    for (let r = 0; r < 60; r += 1) expect(collapsed.has(`root_${r}`)).toBe(true);
  });

  it("vượt RENDER_GUARD dù sourceId dưới ngưỡng -> vẫn collapse (bảo vệ render)", () => {
    // 2 + 40 + 200 = 242 sourceId (dưới 300), nhân 3 bản sao = 726 node hiển thị (trên 500).
    const graph = syntheticGraph(40, 5, 3);
    const sourceCount = new Set(graph.nodes.map((n) => n.sourceId)).size;
    expect(sourceCount).toBeLessThan(USER_THRESHOLD);
    expect(graph.nodes.length).toBeGreaterThan(RENDER_GUARD);

    expect(initialCollapsedIds(graph).size).toBeGreaterThan(0);
  });

  it("node tầng ngoài cùng KHÔNG có con thì không collapse - badge 0 là vô nghĩa", () => {
    const graph = syntheticGraph(60, 6);
    const collapsed = initialCollapsedIds(graph);
    expect(collapsed.has("entry")).toBe(false);
    expect(collapsed.has("exit")).toBe(false);
  });
});

describe("initialCollapsedIds - thuần", () => {
  it("không đột biến input", () => {
    const graph = syntheticGraph(60, 6);
    const snapshot = JSON.stringify(graph);
    initialCollapsedIds(graph);
    expect(JSON.stringify(graph)).toBe(snapshot);
  });

  it("cùng input -> cùng output", () => {
    const graph = plain("b-nested-regions-pipeline");
    expect([...initialCollapsedIds(graph)].sort()).toEqual([...initialCollapsedIds(graph)].sort());
  });

  it("trả về sourceId, không phải id hiển thị", () => {
    const graph = syntheticGraph(60, 6, 2);
    for (const id of initialCollapsedIds(graph)) {
      expect(id).not.toContain("#");
    }
  });
});
