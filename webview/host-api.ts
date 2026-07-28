// webview/host-api.ts
// Vỏ mỏng quanh API mà VS Code tiêm vào webview. Tách ra một file để phần logic còn lại
// không phải chạm vào global, và để test không cần stub global nào.

import type { WebviewToHost } from "../shared/protocol";

export interface HostApi {
  postMessage(message: WebviewToHost): void;
  /**
   * Trạng thái sống qua vòng dispose/restore khi tab ẩn rồi hiện lại. `unknown` là có chủ
   * ý: dữ liệu này do bản webview TRƯỚC ghi ra và không có gì bảo đảm nó đúng hình dạng
   * ta mong đợi (bản cũ, schema đã đổi), nên bên đọc phải tự kiểm.
   */
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  // Do VS Code tiêm vào scope của webview lúc runtime; không tồn tại khi test.
  function acquireVsCodeApi(): HostApi;
}

export function acquireHostApi(): HostApi {
  return acquireVsCodeApi();
}
