// webview/main.ts
// Entry của webview thật. Chỉ làm ba việc: bắt tay `ready`, thu hẹp message đến, và nối
// `createView` với API host. Mọi thứ khác nằm trong `view.ts` - dùng chung với dev harness.

import "./styles.css";

import type { FlowGraph } from "../shared/types";
import type { AnalyzeErrorCode, HostToWebview } from "../shared/protocol";
import { acquireHostApi } from "./host-api";
import { restoreState, serializeState } from "./state";
import { createView } from "./view";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ERROR_CODES: readonly AnalyzeErrorCode[] = [
  "NO_FUNCTION_AT_CURSOR",
  "CURSOR_OUT_OF_RANGE",
  "UNKNOWN",
];

/**
 * Thu hẹp message thô. `shared/protocol.ts` cố tình chỉ có KIỂU, nên việc kiểm là của bên
 * nhận - và ở đây `event.data` là `unknown` thật sự: cast thẳng sang `HostToWebview` là tin
 * một thứ không ai kiểm.
 */
function parseMessage(data: unknown): HostToWebview | undefined {
  if (!isRecord(data)) return undefined;
  if (data["type"] === "graph" && isRecord(data["graph"])) {
    // `graph` do host gửi, mà host vừa lấy trực tiếp từ analyzer - tin được ở mức này.
    return { type: "graph", graph: data["graph"] as unknown as FlowGraph };
  }
  if (data["type"] === "analyzeError") {
    const code = data["code"];
    const message = data["message"];
    return {
      type: "analyzeError",
      code: ERROR_CODES.includes(code as AnalyzeErrorCode) ? (code as AnalyzeErrorCode) : "UNKNOWN",
      message: typeof message === "string" ? message : "Lỗi không rõ.",
    };
  }
  return undefined;
}

const host = acquireHostApi();
const root = document.getElementById("root") ?? document.body;

const view = createView(root, {
  restored: restoreState(host.getState()),
  onReveal: (nodeId) => host.postMessage({ type: "revealNode", nodeId }),
  onStateChange: (state) => host.setState(serializeState(state)),
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = parseMessage(event.data);
  if (message === undefined) return;
  if (message.type === "graph") view.setGraph(message.graph);
  else view.showError(message.message);
});

// Host CHỜ message này rồi mới gửi graph. Mỗi lần tab ẩn rồi hiện lại là một `ready` mới -
// webview bị reload (không dùng `retainContextWhenHidden`), host resend graph đang giữ.
host.postMessage({ type: "ready" });
