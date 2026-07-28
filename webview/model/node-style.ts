// webview/model/node-style.ts
// Bảng thuần `NodeKind` -> hình dạng/màu, và `(confidence, parsed)` -> nét viền.
//
// HAI TRỤC TRỰC GIAO, cố tình không gộp thành một ma trận 14 × 3: phần lớn ô của ma trận đó
// không tồn tại (một `statement` `unknown` theo §11 thì KHÔNG BAO GIỜ có `parsed`), và điền
// kỳ vọng cho ô không thể xảy ra là bịa test.
//
// Yêu cầu thật là "không kind nào rơi vào default im lặng". Chặn ở compile time bằng `never`
// ở nhánh default, cộng `ALL_NODE_KINDS` được test khẳng định bằng nhau với `NodeKind` ở
// TẦNG KIỂU - thêm một kind vào schema là tsc đỏ, không cần ai nhớ.

import type { FlowNode, NodeKind } from "../../shared/types";

/** Phải bằng ĐÚNG union `NodeKind`. `03-node-style.test.ts` khẳng định điều đó qua kiểu. */
export const ALL_NODE_KINDS = [
  "entry",
  "exit",
  "statement",
  "condition",
  "loop",
  "switch-case",
  "try",
  "catch",
  "finally",
  "return",
  "throw",
  "break",
  "continue",
  "call",
] as const;

/**
 * Hình dạng, KHÔNG chỉ màu. Chỉ phân biệt bằng màu thì người mù màu và bản in đen trắng
 * đọc không ra - graph điều khiển mà không thấy đâu là node rẽ nhánh thì vô dụng.
 */
export type NodeShape =
  | "stadium" // entry / exit
  | "box" // statement
  | "diamond" // condition - rẽ nhánh
  | "hexagon" // loop
  | "trapezoid" // switch-case
  | "region" // try / catch / finally - node đánh dấu vùng
  | "terminal" // return / throw / break / continue - đường thoát
  | "subroutine"; // call - thân hàm lồng, KHÔNG inline (§9)

export interface KindStyle {
  shape: NodeShape;
  /** Biến CSS, không phải màu cứng: webview phải theo theme sáng/tối của VS Code. */
  fill: string;
}

export function styleForKind(kind: NodeKind): KindStyle {
  switch (kind) {
    case "entry":
      return { shape: "stadium", fill: "var(--cf-fill-entry)" };
    case "exit":
      return { shape: "stadium", fill: "var(--cf-fill-exit)" };
    case "statement":
      return { shape: "box", fill: "var(--cf-fill-statement)" };
    case "condition":
      return { shape: "diamond", fill: "var(--cf-fill-condition)" };
    case "loop":
      return { shape: "hexagon", fill: "var(--cf-fill-loop)" };
    case "switch-case":
      return { shape: "trapezoid", fill: "var(--cf-fill-switch-case)" };
    case "try":
      return { shape: "region", fill: "var(--cf-fill-try)" };
    case "catch":
      return { shape: "region", fill: "var(--cf-fill-catch)" };
    case "finally":
      return { shape: "region", fill: "var(--cf-fill-finally)" };
    case "return":
      return { shape: "terminal", fill: "var(--cf-fill-return)" };
    case "throw":
      return { shape: "terminal", fill: "var(--cf-fill-throw)" };
    case "break":
      return { shape: "terminal", fill: "var(--cf-fill-break)" };
    case "continue":
      return { shape: "terminal", fill: "var(--cf-fill-continue)" };
    case "call":
      return { shape: "subroutine", fill: "var(--cf-fill-call)" };
    default: {
      // Thêm một `NodeKind` mà quên bảng này → tsc đỏ ngay tại dòng dưới.
      const unhandled: never = kind;
      throw new Error(`NodeKind chưa có style: ${String(unhandled)}`);
    }
  }
}

/**
 * BA mức, không phải hai (SEMANTICS §14.3).
 *
 * Sau khi §12 tách `parsed` khỏi `confidence`, `unknown` KHÔNG còn nghĩa là "analyzer mù".
 * Vẽ nét đứt cho mọi node `unknown` sẽ khiến phần lớn điều kiện thật (`a === "A" && b`)
 * trông như không đọc được - đúng cái mà việc tách hai trục sinh ra để tránh.
 */
export type BorderTreatment =
  | "solid" // certain - analyzer hiểu trọn
  | "solid-inferred" // unknown + có parsed - kết luận MỘT CHIỀU, vẫn dùng được cho filter
  | "dashed"; // unknown, không parsed - analyzer thật sự không đọc được

export function borderFor(node: FlowNode): BorderTreatment {
  if (node.confidence === "certain") return "solid";
  // Có `condition.raw` mà không có `parsed` (vd chuỗi `||`, §12) vẫn là "không suy luận
  // được" - raw chỉ là source text, không phải kết luận.
  return node.condition?.parsed === undefined ? "dashed" : "solid-inferred";
}
