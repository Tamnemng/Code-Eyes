// Entry webview thật: handshake, validate message runtime và nối view với extension host.

import "./styles.css";

import type {
  AnalyzeErrorCode,
  CalleeLink,
  GraphNavigation,
  HostToWebview,
} from "../shared/protocol";
import type { FlowGraph } from "../shared/types";
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

function parseCallees(value: unknown): CalleeLink[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: CalleeLink[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item["targetId"] !== "string" ||
      typeof item["nodeId"] !== "string" ||
      typeof item["label"] !== "string"
    ) {
      return undefined;
    }
    result.push({
      targetId: item["targetId"],
      nodeId: item["nodeId"],
      label: item["label"],
    });
  }
  return result;
}

function parseNavigation(value: unknown): GraphNavigation | undefined {
  if (
    !isRecord(value) ||
    !Array.isArray(value["breadcrumbs"]) ||
    !value["breadcrumbs"].every((item) => typeof item === "string") ||
    typeof value["canGoBack"] !== "boolean"
  ) {
    return undefined;
  }
  return {
    breadcrumbs: value["breadcrumbs"],
    canGoBack: value["canGoBack"],
  };
}

/** `event.data` là unknown thật sự; chỉ graph do analyzer sinh được tin sau khi kiểm envelope. */
function parseMessage(data: unknown): HostToWebview | undefined {
  if (!isRecord(data)) return undefined;
  if (data["type"] === "graph" && isRecord(data["graph"])) {
    const callees = parseCallees(data["callees"]);
    const navigation = parseNavigation(data["navigation"]);
    if (callees === undefined || navigation === undefined) return undefined;
    return {
      type: "graph",
      graph: data["graph"] as unknown as FlowGraph,
      callees,
      navigation,
    };
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
  onOpenCallee: (targetId) => host.postMessage({ type: "openCallee", targetId }),
  onNavigateBack: () => host.postMessage({ type: "navigateBack" }),
  onStateChange: (state) => host.setState(serializeState(state)),
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = parseMessage(event.data);
  if (message === undefined) return;
  if (message.type === "graph") {
    view.setGraph(message.graph, {
      callees: message.callees,
      navigation: message.navigation,
    });
  } else {
    view.showError(message.message);
  }
});

// Host chỉ gửi graph sau handshake này; script reload thì ready mới khiến host resend frame hiện tại.
host.postMessage({ type: "ready" });
