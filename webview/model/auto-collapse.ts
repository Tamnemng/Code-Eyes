// webview/model/auto-collapse.ts
// Tập collapse ban đầu. Hàm thuần trên `DisplayGraph`, trả về `sourceId`.

import type { DisplayGraph } from "./display-graph";
import { sourceNodeCount } from "./display-graph";

/**
 * Ngưỡng người-dùng-thấy, đếm theo `sourceId` phân biệt. Con số này khớp 1:1 với
 * `FlowGraph.nodes.length` và với con số Giai đoạn 3 (filter) sẽ báo.
 */
export const USER_THRESHOLD = 300;

/**
 * Ngưỡng phòng vệ render, đếm theo node HIỂN THỊ thật.
 *
 * Cần ngưỡng thứ hai vì `USER_THRESHOLD` đo sai đại lượng cho mục đích hiệu năng: 300
 * `sourceId` với nhiều vùng `finally` fanout mạnh có thể ra 500-600 node vẽ (đo được: golden
 * `pipeline` phình 16 -> 32 node, tức 2x).
 *
 * HẰNG CỐ ĐỊNH: `FANOUT_ENABLED` đổi con số ĐO ĐƯỢC, không đổi mức chặn.
 */
export const RENDER_GUARD = 500;

/**
 * - Vùng `finally` LUÔN collapse (TODO.md 3c): trên hàm legacy nghìn node, đó không phải thứ
 *   người ta mở đầu tiên. Không phụ thuộc kết quả đo fanout ở 3b.
 * - Vượt một trong hai ngưỡng -> chỉ tầng ngoài cùng mở: collapse mọi node không có cha mà
 *   CÓ con. Node không có con thì không collapse - badge "đang ẩn 0" là vô nghĩa.
 */
export function initialCollapsedIds(graph: DisplayGraph): Set<string> {
  const hasChildren = new Set(
    graph.nodes.map((n) => n.parentDisplayId).filter((id): id is string => id !== undefined),
  );
  const collapsed = new Set<string>();

  for (const node of graph.nodes) {
    if (node.node.kind === "finally" && hasChildren.has(node.id)) collapsed.add(node.sourceId);
  }

  const tooManyForUser = sourceNodeCount(graph) > USER_THRESHOLD;
  const tooManyToRender = graph.nodes.length > RENDER_GUARD;
  if (tooManyForUser || tooManyToRender) {
    // Progressive disclosure: giữ workflow/try ngoài cùng để người dùng vẫn thấy câu chuyện cấp cao,
    // nhưng gập từng nhánh if/loop bên dưới. Mở một nhánh sẽ lộ ra các nhánh con vẫn đang gập.
    for (const node of graph.nodes) {
      if (
        hasChildren.has(node.id) &&
        (node.node.kind === "condition" ||
          node.node.kind === "loop" ||
          node.node.kind === "switch-case" ||
          ((node.node.kind === "try" || node.node.kind === "catch") &&
            node.parentDisplayId !== undefined))
      ) {
        collapsed.add(node.sourceId);
      }
    }

    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const hiddenByProgressiveCollapse = (node: (typeof graph.nodes)[number]): boolean => {
      let ancestor = byId.get(node.parentDisplayId ?? "");
      while (ancestor !== undefined) {
        if (collapsed.has(ancestor.sourceId)) return true;
        ancestor = byId.get(ancestor.parentDisplayId ?? "");
      }
      return false;
    };
    const visibleAfterProgressive = graph.nodes.filter(
      (node) => !hiddenByProgressiveCollapse(node),
    ).length;

    // Graph tuyến tính hoặc chỉ có một try khổng lồ mà không có khối con vẫn cần guard cũ để ELK
    // không treo. Chỉ fallback khi progressive collapse chưa đưa graph xuống ngưỡng người dùng.
    if (visibleAfterProgressive > USER_THRESHOLD) {
      for (const node of graph.nodes) {
        if (node.parentDisplayId === undefined && hasChildren.has(node.id)) {
          collapsed.add(node.sourceId);
        }
      }
    }
  }

  return collapsed;
}
