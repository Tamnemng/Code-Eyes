// webview/model/display-graph.ts
// Cấu trúc graph ở TẦNG VẼ. Không nằm trong `shared/types.ts` và không được nằm ở đó:
// đây là chi tiết trình bày của riêng webview, `analyzer/` và `filter/` không biết đến nó.
//
// Quan hệ với schema: mỗi `DisplayNode` trỏ về đúng một `FlowNode` qua `sourceId`. Một
// `FlowNode` có thể sinh NHIỀU `DisplayNode` (nhân bản vùng `finally`, SEMANTICS §14.2).
// Mọi con số hiển thị cho người dùng đếm theo `sourceId` phân biệt, không theo `DisplayNode`
// (xem TODO.md mục 3).

import type { FlowEdge, FlowGraph, FlowNode } from "../../shared/types";

export interface DisplayNode {
  /** Id ở tầng vẽ. Bằng `sourceId` khi node không bị nhân bản. Duy nhất trong DisplayGraph. */
  id: string;
  /** Id GỐC trong `FlowGraph`. Mọi thống kê và mọi `revealNode` đi theo field này. */
  sourceId: string;
  /** Text trên node. Bằng `node.label`, hoặc `finally (2/5)` khi là bản sao. */
  displayLabel: string;
  /**
   * Cha ở TẦNG VẼ. Bằng `node.parentId` khi chưa nhân bản.
   *
   * Không dùng `node.parentId` trực tiếp được: nó trỏ bằng `sourceId`, mà sau khi nhân bản
   * một vùng thì nhiều `DisplayNode` chung một `sourceId` - `parentId` không còn phân biệt
   * được bản sao nào thuộc bản sao nào. `collapse` và `finally-fanout` đều cần quan hệ
   * cha-con chính xác ở tầng vẽ, nên nó phải sống ở đây.
   */
  parentDisplayId: string | undefined;
  /**
   * Node gốc, giữ nguyên THAM CHIẾU chứ không sao chép từng field. Nếu schema thêm field
   * mới thì không có chỗ nào để field đó bị rơi âm thầm.
   */
  node: FlowNode;
}

export interface DisplayEdge {
  /** Id tầng vẽ của node nguồn. */
  from: string;
  /** Id tầng vẽ của node đích. */
  to: string;
  label: FlowEdge["label"];
  /**
   * Cạnh quay lui, suy ra bằng DFS (SEMANTICS §14.1 - analyzer không bao giờ emit nhãn
   * `loop-back`). `toDisplayGraph` luôn đặt `false`; `markBackEdges` mới điền.
   */
  isBackEdge: boolean;
}

export interface DisplayGraph {
  functionName: string;
  filePath: string;
  nodes: DisplayNode[];
  edges: DisplayEdge[];
  warnings: string[];
}

/** Số node theo `sourceId` phân biệt - con số người dùng thấy. */
export function sourceNodeCount(graph: DisplayGraph): number {
  return new Set(graph.nodes.map((n) => n.sourceId)).size;
}

/**
 * Ánh xạ đồng nhất từ `FlowGraph` sang tầng vẽ: chưa nhân bản gì, chưa đánh dấu gì.
 * Mọi phép biến đổi hiển thị khác nhận và trả `DisplayGraph`, nên chúng ghép được tuỳ ý.
 */
export function toDisplayGraph(graph: FlowGraph): DisplayGraph {
  return {
    functionName: graph.functionName,
    filePath: graph.filePath,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      sourceId: node.id,
      displayLabel: node.label,
      parentDisplayId: node.parentId,
      node,
    })),
    edges: graph.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      label: edge.label ?? null,
      isBackEdge: false,
    })),
    warnings: [...graph.warnings],
  };
}
