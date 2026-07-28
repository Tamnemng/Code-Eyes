// webview/model/collapse.ts
// Thu gọn subtree theo `parentDisplayId`. Hàm thuần: (graph, tập đang collapse) -> graph con
// + số node đang ẩn dưới mỗi node.
//
// GIỚI HẠN ĐÃ BIẾT: `parentId` của analyzer chỉ phủ try/catch/finally, nên collapse chỉ tác
// dụng lên các khối đó - thân vòng lặp và nhánh `if` không thu gọn được. Chỗ sửa đúng là
// analyzer, KHÔNG phải suy ra ở đây bằng dominator. Xem TODO.md mục 1.
//
// KHOÁ: tập đang collapse lưu bằng `sourceId`, KHÔNG phải id hiển thị. Người dùng click một
// node, nhưng vùng đó có thể có k bản sao ở tầng vẽ (fanout §14.2) - hoặc cả k cùng thu gọn,
// hoặc không bản nào. Nửa vời là bug người dùng nhìn thấy ngay.

import type { DisplayEdge, DisplayGraph, DisplayNode } from "./display-graph";

export interface CollapsedView {
  graph: DisplayGraph;
  /**
   * Id HIỂN THỊ của node đang collapse -> số node đang ẩn dưới nó, đếm theo `sourceId`
   * phân biệt (TODO.md mục 3: bản sao fanout không cộng vào bất kỳ tổng nào).
   * Chỉ chứa node còn nhìn thấy - node bị collapse mà bản thân đã bị ẩn thì không có badge.
   */
  hiddenCounts: Map<string, number>;
}

/** Tổ tiên gần nhất còn hiện, hoặc chính nó nếu nó đang hiện. */
function liftToVisible(
  id: string,
  byId: ReadonlyMap<string, DisplayNode>,
  visible: ReadonlySet<string>,
): string | undefined {
  let current: string | undefined = id;
  while (current !== undefined && !visible.has(current)) {
    current = byId.get(current)?.parentDisplayId;
  }
  return current;
}

export function applyCollapse(
  graph: DisplayGraph,
  collapsedSourceIds: ReadonlySet<string>,
): CollapsedView {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const isCollapsed = (node: DisplayNode): boolean => collapsedSourceIds.has(node.sourceId);

  // Ẩn khi có TỔ TIÊN THẬT SỰ nào đang collapse. Bản thân node bị collapse vẫn hiện - nó là
  // chỗ để click mở lại và là nơi treo badge.
  const hiddenBy = new Map<string, string>();
  for (const node of graph.nodes) {
    let ancestor = byId.get(node.parentDisplayId ?? "");
    let outermost: string | undefined;
    while (ancestor !== undefined) {
      if (isCollapsed(ancestor)) outermost = ancestor.id;
      ancestor = byId.get(ancestor.parentDisplayId ?? "");
    }
    // Gán cho tổ tiên NGOÀI CÙNG đang collapse: collapse cha của node đã collapse phải cho
    // đúng kết quả như chỉ collapse cha, và badge chỉ nằm ở cha.
    if (outermost !== undefined) hiddenBy.set(node.id, outermost);
  }

  const visible = new Set(graph.nodes.filter((n) => !hiddenBy.has(n.id)).map((n) => n.id));

  const hiddenCounts = new Map<string, number>();
  const hiddenSourceIds = new Map<string, Set<string>>();
  for (const [hiddenId, ownerId] of hiddenBy) {
    const node = byId.get(hiddenId);
    if (node === undefined) continue;
    const set = hiddenSourceIds.get(ownerId);
    if (set === undefined) hiddenSourceIds.set(ownerId, new Set([node.sourceId]));
    else set.add(node.sourceId);
  }
  for (const [ownerId, set] of hiddenSourceIds) hiddenCounts.set(ownerId, set.size);

  // Nâng cạnh: cạnh bắc qua ranh giới phải được GOM lên node đang collapse chứ không mất.
  // Cạnh nằm trọn trong lòng vùng đã gộp thành self-loop -> bỏ, vì nó không còn nói gì.
  const seen = new Set<string>();
  const edges: DisplayEdge[] = [];
  for (const edge of graph.edges) {
    const from = liftToVisible(edge.from, byId, visible);
    const to = liftToVisible(edge.to, byId, visible);
    if (from === undefined || to === undefined || from === to) continue;
    const key = `${from}->${to}:${edge.label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(from === edge.from && to === edge.to ? edge : { ...edge, from, to });
  }

  return {
    graph: { ...graph, nodes: graph.nodes.filter((n) => visible.has(n.id)), edges },
    hiddenCounts,
  };
}

/**
 * Lọc tập collapse đã lưu (`getState`) theo graph HIỆN TẠI.
 *
 * Người dùng sửa code rồi chạy lại lệnh -> graph mới có tập id khác, id cũ trỏ vào node không
 * còn tồn tại. Phải rụng IM LẶNG: không crash, không giữ id mồ côi (id mồ côi sẽ sống lại
 * làm ẩn node lạ nếu analyzer tình cờ cấp lại đúng số đó).
 */
export function pruneCollapsedIds(graph: DisplayGraph, ids: Iterable<string>): Set<string> {
  const known = new Set(graph.nodes.map((n) => n.sourceId));
  return new Set([...ids].filter((id) => known.has(id)));
}
