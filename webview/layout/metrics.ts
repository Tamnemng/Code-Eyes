// webview/layout/metrics.ts
// Hai metric để ĐO chất lượng layout bằng số, không bằng mắt. Hàm thuần trên kết quả ELK.
//
// Dùng cho phép đo đã pre-register ở TODO.md 3b: primary = số cạnh cắt nhau,
// secondary = tổng chiều dài cạnh.

import type { Layout, Point } from "./run-elk";

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Tổng chiều dài mọi đường gấp khúc. */
export function totalEdgeLength(layout: Layout): number {
  let total = 0;
  for (const edge of layout.edges) {
    for (let i = 1; i < edge.points.length; i += 1) {
      const from = edge.points[i - 1];
      const to = edge.points[i];
      if (from === undefined || to === undefined) continue;
      total += distance(from, to);
    }
  }
  return total;
}

const EPSILON = 1e-9;

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Hai đoạn có cắt nhau ở điểm TRONG của cả hai hay không.
 *
 * Chạm nhau ở đầu mút KHÔNG tính: cạnh cùng xuất phát từ một node đương nhiên gặp nhau ở
 * node đó, đếm vào thì mọi node bậc cao tự động "cắt nhau" và metric mất nghĩa.
 */
function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  if (Math.abs(d1) < EPSILON || Math.abs(d2) < EPSILON) return false;
  if (Math.abs(d3) < EPSILON || Math.abs(d4) < EPSILON) return false;
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Số lần hai cạnh KHÁC NHAU cắt nhau. Đếm theo cặp đoạn thẳng, nên một cặp cạnh cắt nhau
 * hai lần được tính hai - đó là đúng: hai lần cắt là hai lần mắt phải lần đường.
 */
export function edgeCrossings(layout: Layout): number {
  const segments: Array<{ edge: number; a: Point; b: Point }> = [];
  for (const edge of layout.edges) {
    for (let i = 1; i < edge.points.length; i += 1) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      if (a === undefined || b === undefined) continue;
      if (Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON) continue;
      segments.push({ edge: edge.index, a, b });
    }
  }

  let crossings = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const first = segments[i];
    if (first === undefined) continue;
    for (let j = i + 1; j < segments.length; j += 1) {
      const second = segments[j];
      if (second === undefined || second.edge === first.edge) continue;
      if (segmentsCross(first.a, first.b, second.a, second.b)) crossings += 1;
    }
  }
  return crossings;
}
