// webview/layout/elk-input.ts
// `DisplayGraph` -> input của ELK. Hàm thuần, không gọi ELK (xem `run-elk.ts` cho phần đó),
// nên test được mà không cần chạy layout.
//
// Ràng buộc 4: `elk.algorithm = "layered"`, `elk.direction = "DOWN"`. Không force-directed.

import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";

import type { DisplayGraph, DisplayNode } from "../model/display-graph";
import type { DisplaySettings } from "../settings";
import { defaultSettings, monoCharWidth } from "../settings";

/** Ước lượng kích thước node từ label. ELK không đo text - ta phải đưa số. */
// Đệm trong node: chữ dính viền là một trong hai nguyên nhân "trông chật" hay gặp nhất.
const PADDING_X = 30;
const PADDING_Y = 20;
const MIN_WIDTH = 76;
const MAX_LABEL_CHARS = 40;
/** Khoảng cách cơ sở, được nhân theo `nodeScale` để node to thì graph cũng thưa ra theo. */
const BASE_LAYER_SPACING = 72;
const BASE_NODE_SPACING = 48;

const EDGE_LABEL_CHAR_WIDTH = 6;
const EDGE_LABEL_HEIGHT = 14;

function sizeOf(node: DisplayNode, settings: DisplaySettings): { width: number; height: number } {
  const lines = node.displayLabel.split("\n");
  const longest = Math.min(
    MAX_LABEL_CHARS,
    lines.reduce((max, line) => Math.max(max, line.length), 0),
  );
  // Kích thước phải theo CỠ CHỮ THẬT: ELK không đo text, nên nếu chữ to ra mà số này không
  // đổi thì chữ tràn khỏi node.
  const charWidth = monoCharWidth(settings.fontSize);
  const lineHeight = Math.round(settings.fontSize * 1.6);
  const width = Math.max(MIN_WIDTH, Math.round(longest * charWidth) + PADDING_X);
  const height = lines.length * lineHeight + PADDING_Y;
  return {
    width: Math.round(width * settings.nodeScale),
    height: Math.round(height * settings.nodeScale),
  };
}

export function toElkGraph(
  graph: DisplayGraph,
  settings: DisplaySettings = defaultSettings(),
): ElkNode {
  const children: ElkNode[] = graph.nodes.map((node) => ({
    id: node.id,
    ...sizeOf(node, settings),
  }));

  const edges: ElkExtendedEdge[] = graph.edges.map((edge, index) => ({
    // Id = vị trí trong `graph.edges`. Đó là ánh xạ xác định để tầng vẽ tra lại
    // `DisplayEdge` (kể cả cờ `isBackEdge`) từ kết quả layout, KHÔNG cần nhồi dữ liệu
    // riêng vào `layoutOptions` - ELK lặng lẽ bỏ qua option lạ nên đó là side-channel dễ vỡ.
    id: `e_${index}`,
    sources: [edge.from],
    targets: [edge.to],
    // Chỉ edge CÓ nhãn mới khai báo label: khai báo cho edge `null` là bắt ELK chừa chỗ
    // cho chuỗi rỗng ở mọi cạnh, làm layout giãn ra vô ích.
    ...(edge.label === null || edge.label === undefined
      ? {}
      : {
          labels: [
            {
              text: edge.label,
              width: Math.round(edge.label.length * EDGE_LABEL_CHAR_WIDTH),
              height: EDGE_LABEL_HEIGHT,
            },
          ],
        }),
  }));

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      // Mặc định của ELK phụ thuộc thứ tự duyệt; chốt cứng để cùng input cho cùng layout.
      "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      // Nguyên nhân "trông xấu" phổ biến nhất là chật, không phải màu. Cho graph thở.
      // Nhân theo `nodeScale`: node to mà khoảng cách giữ nguyên thì lại chật như cũ.
      "elk.layered.spacing.nodeNodeBetweenLayers": String(
        Math.round(BASE_LAYER_SPACING * settings.nodeScale),
      ),
      "elk.spacing.nodeNode": String(Math.round(BASE_NODE_SPACING * settings.nodeScale)),
      "elk.spacing.edgeNode": "28",
      "elk.spacing.edgeEdge": "16",
      "elk.spacing.edgeLabel": "8",
      // Nhãn edge nằm cạnh cạnh, ELK chừa chỗ riêng -> không đè lên nhau.
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.spacing.edgeNodeBetweenLayers": "32",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
      "elk.padding": "[top=28,left=28,bottom=28,right=28]",
    },
    children,
    edges,
  };
}
