// webview/render/detail.ts
// Panel bên: `code` đầy đủ + `kind` + `confidence` + nút "Jump to line".

import type { FlowNode } from "../../shared/types";
import type { DisplayGraph } from "../model/display-graph";
import { borderFor } from "../model/node-style";

const BORDER_EXPLANATION: Record<ReturnType<typeof borderFor>, string> = {
  solid: "Analyzer hiểu trọn node này.",
  "solid-inferred":
    "Suy luận MỘT CHIỀU: điều kiện phức hợp có một hạng tử đọc được. " +
    "Filter chỉ được cắt nhánh true khi hạng tử đó chắc chắn false (SEMANTICS §12).",
  dashed: "Analyzer KHÔNG đọc được điều kiện này. Cả hai nhánh phải giữ.",
};

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
}

export function renderDetail(
  panel: HTMLElement,
  graph: DisplayGraph,
  sourceId: string | undefined,
  options: DetailOptions,
): void {
  panel.replaceChildren();

  if (sourceId === undefined) {
    const empty = document.createElement("p");
    empty.className = "cf-detail-empty";
    empty.textContent = "Chọn một node để xem code đầy đủ.";
    panel.append(empty);
    return;
  }

  const copies = graph.nodes.filter((n) => n.sourceId === sourceId);
  const node: FlowNode | undefined = copies[0]?.node;
  if (node === undefined) {
    const gone = document.createElement("p");
    gone.className = "cf-detail-empty";
    gone.textContent = "Node đã chọn không còn trong graph đang hiển thị.";
    panel.append(gone);
    return;
  }

  const title = document.createElement("h2");
  title.textContent = node.label;
  panel.append(title);

  const border = borderFor(node);
  panel.append(
    row("kind", node.kind),
    row("confidence", node.confidence),
    row("dòng", `${node.range.startLine}–${node.range.endLine}`),
  );
  if (node.condition !== undefined) {
    panel.append(row("condition", node.condition.raw));
    panel.append(
      row(
        "parsed",
        node.condition.parsed === undefined
          ? "(không suy luận được)"
          : `${node.condition.parsed.variable} ${node.condition.parsed.operator} ` +
            `${JSON.stringify(node.condition.parsed.value)}`,
      ),
    );
  }

  const note = document.createElement("p");
  note.className = "cf-detail-note";
  note.textContent = BORDER_EXPLANATION[border];
  panel.append(note);

  // Bản sao fanout: người dùng thấy `finally (3/7)` có nhiều mũi tên ra sẽ tưởng là bug.
  // Bắt buộc giải thích (TODO.md mục 4).
  if (copies.length > 1) {
    const fanout = document.createElement("p");
    fanout.className = "cf-detail-note cf-detail-warn";
    fanout.textContent =
      `Node này được vẽ thành ${copies.length} bản sao (một bản cho mỗi đường vào). ` +
      "Mỗi bản giữ CẢ các mũi tên ra, nên một return sớm vẫn 'thấy' đường chảy tiếp sau " +
      "khối try. Đó là over-approximation có chủ ý của analyzer (SEMANTICS §7), không phải " +
      "bug: thà báo thừa hơn báo thiếu. Trong FlowGraph nó vẫn là MỘT node.";
    panel.append(fanout);
  }

  const code = document.createElement("pre");
  code.className = "cf-detail-code";
  code.textContent = node.code === "" ? "(không có source)" : node.code;
  panel.append(code);

  const jump = document.createElement("button");
  jump.type = "button";
  jump.className = "cf-jump";
  jump.textContent = `Jump to line ${node.range.startLine}`;
  jump.addEventListener("click", () => options.onJump(sourceId));
  panel.append(jump);
}
