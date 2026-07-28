// shared/protocol.ts
// Giao thức message giữa extension host và webview.
//
// CHỈ chứa KIỂU - không runtime code. Lý do: `extension/` và `webview/` là hai tầng tách
// rời (ràng buộc 1); nếu file này có runtime code thì nó thành tầng thứ tư mà cả hai bên
// đều phụ thuộc vào. Việc thu hẹp kiểu (narrowing) từ message thô là việc của từng bên.
//
// Không sửa `shared/types.ts`. File này chỉ import kiểu từ đó.

import type { FlowGraph } from "./types";

/**
 * Mã lỗi analyzer có thể trả về. Hai mã đầu là hai `Error` mà
 * `analyzeFunctionAtCursor` throw theo hợp đồng (xem `analyzer/typescript/index.ts`);
 * `UNKNOWN` là lưới an toàn cho mọi thứ khác - host không được để lỗi lạ làm chết command.
 */
export type AnalyzeErrorCode = "NO_FUNCTION_AT_CURSOR" | "CURSOR_OUT_OF_RANGE" | "UNKNOWN";

/** Host -> webview. */
export type HostToWebview =
  | { type: "graph"; graph: FlowGraph }
  | { type: "analyzeError"; code: AnalyzeErrorCode; message: string };

/** Webview -> host. */
export type WebviewToHost =
  /**
   * Webview đã mount và sẵn sàng nhận graph. Host CHỜ message này rồi mới gửi `graph`.
   * Cần thiết vì webview bị reload mỗi lần tab ẩn rồi hiện lại (không dùng
   * `retainContextWhenHidden`) - mỗi lần reload là một `ready` mới, host resend graph
   * đang giữ. Xem `TODO.md` về giới hạn khi restart VS Code.
   */
  | { type: "ready" }
  /**
   * Yêu cầu nhảy tới node trong editor gốc.
   *
   * `nodeId` là id GỐC trong `FlowGraph` (`FlowNode.id`), KHÔNG phải id node hiển thị -
   * bản sao `finally` do renderer nhân bản (SEMANTICS §14.2) mang id riêng ở tầng vẽ và
   * id đó không tồn tại ngoài webview. Host tra `range` từ `FlowGraph` nó đang giữ, nên
   * range chỉ có một nguồn sự thật và webview không gửi toạ độ ngược lại.
   */
  | { type: "revealNode"; nodeId: string };
