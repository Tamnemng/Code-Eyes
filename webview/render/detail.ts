// webview/render/detail.ts
// Panel bên: `code` đầy đủ + `kind` + `confidence` + nút "Jump to line".

import type { CalleeLink } from "../../shared/protocol";
import type { FlowNode } from "../../shared/types";
import { messagesFor } from "../i18n";
import type { DisplayGraph } from "../model/display-graph";
import { borderFor } from "../model/node-style";
import type { Locale } from "../settings";

function row(label: string, value: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "cf-detail-row";
  const key = document.createElement("span");
  key.className = "cf-detail-key";
  key.textContent = label;
  const val = document.createElement("span");
  val.className = "cf-detail-value";
  val.textContent = value;
  wrapper.append(key, val);
  return wrapper;
}

export interface DetailOptions {
  onJump: (sourceId: string) => void;
  onClose: () => void;
  callees: readonly CalleeLink[];
  onOpenCallee: (targetId: string) => void;
  locale: Locale;
}

export function renderDetail(
  panel: HTMLElement,
  graph: DisplayGraph,
  sourceId: string | undefined,
  options: DetailOptions,
): void {
  panel.replaceChildren();
  const messages = messagesFor(options.locale).detail;

  if (sourceId === undefined) {
    const empty = document.createElement("p");
    empty.className = "cf-detail-empty";
    empty.textContent = messages.selectNode;
    panel.append(empty);
    return;
  }

  const copies = graph.nodes.filter((n) => n.sourceId === sourceId);
  const node: FlowNode | undefined = copies[0]?.node;
  if (node === undefined) {
    const gone = document.createElement("p");
    gone.className = "cf-detail-empty";
    gone.textContent = messages.missingNode;
    panel.append(gone);
    return;
  }

  const title = document.createElement("h2");
  title.textContent = node.label;
  const header = document.createElement("div");
  header.className = "cf-detail-header";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "cf-detail-close";
  close.setAttribute("aria-label", messages.close);
  close.textContent = "×";
  close.addEventListener("click", options.onClose);
  header.append(title, close);
  panel.append(header);

  const border = borderFor(node);
  panel.append(
    row("kind", node.kind),
    row("confidence", node.confidence),
    row(messages.line, `${node.range.startLine}–${node.range.endLine}`),
  );
  if (node.condition !== undefined) {
    panel.append(row("condition", node.condition.raw));
    panel.append(
      row(
        "parsed",
        node.condition.parsed === undefined
          ? messages.unparsed
          : `${node.condition.parsed.variable} ${node.condition.parsed.operator} ` +
            `${JSON.stringify(node.condition.parsed.value)}`,
      ),
    );
  }

  const note = document.createElement("p");
  note.className = "cf-detail-note";
  note.textContent =
    border === "solid"
      ? messages.borderSolid
      : border === "solid-inferred"
        ? messages.borderInferred
        : messages.borderDashed;
  panel.append(note);

  // Bản sao fanout: người dùng thấy `finally (3/7)` có nhiều mũi tên ra sẽ tưởng là bug.
  // Bắt buộc giải thích (TODO.md mục 4).
  if (copies.length > 1) {
    const fanout = document.createElement("p");
    fanout.className = "cf-detail-note cf-detail-warn";
    fanout.textContent = messages.fanout(copies.length);
    panel.append(fanout);
  }

  const code = document.createElement("pre");
  code.className = "cf-detail-code";
  code.textContent = node.code === "" ? messages.noSource : node.code;
  panel.append(code);

  const callees = options.callees.filter((callee) => callee.nodeId === node.id);
  if (callees.length > 0) {
    const callActions = document.createElement("div");
    callActions.className = "cf-callee-actions";
    for (const callee of callees) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "cf-open-callee";
      open.textContent = `↗ ${callee.label}()`;
      open.title = messages.openSource(callee.label);
      open.addEventListener("click", () => options.onOpenCallee(callee.targetId));
      callActions.append(open);
    }
    panel.append(callActions);
  }

  const jump = document.createElement("button");
  jump.type = "button";
  jump.className = "cf-jump";
  jump.textContent = messages.jumpToLine(node.range.startLine);
  jump.addEventListener("click", () => options.onJump(sourceId));
  panel.append(jump);
}
