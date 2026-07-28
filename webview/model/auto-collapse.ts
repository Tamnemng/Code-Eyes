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
    for (const node of graph.nodes) {
      if (node.parentDisplayId === undefined && hasChildren.has(node.id)) {
        collapsed.add(node.sourceId);
      }
    }
  }

  return collapsed;
}
