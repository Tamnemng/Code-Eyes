// webview/model/back-edges.ts
// Suy ra cạnh quay lui bằng DFS. BẮT BUỘC theo SEMANTICS §14.1: analyzer không bao giờ emit
// nhãn `loop-back` (§4, khoá bởi `00-invariants.test.ts`) vì edge từ node `condition`/`loop`
// phải giữ nhãn `true`/`false` cho Giai đoạn 3. Back edge là thuộc tính CẤU TRÚC của graph.
//
// Bản cài đặt này CỐ TÌNH trùng lặp với helper DFS trong `analyzer/typescript/__tests__/`:
// webview không được import từ `analyzer/` (ràng buộc 1). Xem TODO.md mục 5.
//
// CFG sinh từ TypeScript có cấu trúc luôn reducible → tập back edge không phụ thuộc thứ tự
// duyệt. DFS iterative (không đệ quy) để hàm legacy vài nghìn node không làm tràn stack.

import type { DisplayEdge, DisplayGraph } from "./display-graph";

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

/**
 * Trả về `DisplayGraph` mới với `isBackEdge` đã điền. Không đột biến input; edge không phải
 * cạnh ngược giữ nguyên tham chiếu.
 */
export function markBackEdges(graph: DisplayGraph): DisplayGraph {
  const outgoing = new Map<string, DisplayEdge[]>();
  for (const node of graph.nodes) outgoing.set(node.id, []);
  for (const edge of graph.edges) outgoing.get(edge.from)?.push(edge);

  const color = new Map<string, number>(graph.nodes.map((n) => [n.id, WHITE]));
  const back = new Set<DisplayEdge>();

  const visit = (rootId: string): void => {
    color.set(rootId, GRAY);
    const stack: Array<{ id: string; next: number }> = [{ id: rootId, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const edges = outgoing.get(frame.id) ?? [];
      const edge = edges[frame.next];
      if (edge === undefined) {
        color.set(frame.id, BLACK);
        stack.pop();
        continue;
      }
      frame.next += 1;
      const target = color.get(edge.to);
      if (target === GRAY) {
        // Đích đang trên stack DFS → cạnh quay lui.
        back.add(edge);
      } else if (target === WHITE) {
        color.set(edge.to, GRAY);
        stack.push({ id: edge.to, next: 0 });
      }
    }
  };

  const entry = graph.nodes.find((n) => n.node.kind === "entry");
  if (entry !== undefined) visit(entry.id);

  // §14.1 nói "DFS từ entry". Duyệt thêm các node còn WHITE là phần BỔ SUNG, không trái:
  // graph có thể chứa vùng code chết (SEMANTICS §5, §7 - node 0 edge vào kèm warning
  // `unreachable`). Chu trình nằm trong vùng đó vẫn phải phá vòng, không thì ELK gặp chu
  // trình mà renderer không biết cạnh nào là cạnh ngược. Thứ tự node cố định nên vẫn
  // deterministic.
  for (const node of graph.nodes) {
    if (color.get(node.id) === WHITE) visit(node.id);
  }

  return {
    ...graph,
    edges: graph.edges.map((edge) => (back.has(edge) ? { ...edge, isBackEdge: true } : edge)),
  };
}
