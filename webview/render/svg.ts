// webview/render/svg.ts
// Vẽ node + edge từ kết quả ELK. Chạm DOM nên không test tự động (phần thuần đã tách ra
// `shapes.ts`, `node-style.ts`, `metrics.ts`).

import type { DisplayGraph, DisplayNode } from "../model/display-graph";
import { borderFor, styleForKind } from "../model/node-style";
import type { Layout } from "../layout/run-elk";
import type { DisplaySettings } from "../settings";
import { monoCharWidth } from "../settings";
import { geometryFor } from "./shapes";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface RenderOptions {
  /** sourceId -> chọn node (mở panel chi tiết). */
  onSelect: (sourceId: string) => void;
  /** sourceId -> thu gọn / mở lại vùng. */
  onToggleCollapse: (sourceId: string) => void;
  /** Id HIỂN THỊ của node đang collapse -> số node ẩn dưới nó (đếm theo sourceId). */
  hiddenCounts: ReadonlyMap<string, number>;
  selectedSourceId: string | undefined;
  settings: DisplaySettings;
}

function element<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function truncate(text: string, width: number, fontSize: number): string {
  // Trừ đúng phần đệm mà `elk-input.ts` đã cộng vào, không thì chữ chạm viền. Bề rộng ký tự
  // phải theo CỠ CHỮ HIỆN TẠI, không phải một hằng số - nếu không, tăng cỡ chữ là tràn node.
  const max = Math.max(3, Math.floor((width - 26) / monoCharWidth(fontSize)));
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** `defs` dùng chung: đầu mũi tên cho cạnh xuôi và cho cạnh quay lui. */
function buildDefs(): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, "defs");
  for (const [id, className] of [
    ["cf-arrow", "cf-arrow"],
    ["cf-arrow-back", "cf-arrow cf-arrow-back"],
  ] as const) {
    const marker = element("marker", {
      id,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      // Mũi tên nhỏ: ở graph vài trăm node, mũi tên to biến mọi cạnh thành một vệt đặc.
      markerWidth: 4.5,
      markerHeight: 4.5,
      orient: "auto-start-reverse",
    });
    const path = element("path", { d: "M0 0 L10 5 L0 10 Z" });
    path.setAttribute("class", className);
    marker.append(path);
    defs.append(marker);
  }
  return defs;
}

export function renderGraph(
  surface: SVGGElement,
  graph: DisplayGraph,
  layout: Layout,
  options: RenderOptions,
): void {
  surface.replaceChildren();
  const root = surface.ownerSVGElement;
  if (root !== null && root.querySelector("defs") === null) root.prepend(buildDefs());

  // Cỡ chữ và độ dày cạnh đi qua CSS custom property, không phải attribute từng phần tử:
  // đổi settings chỉ cần đặt lại hai biến này, không phải vẽ lại để sửa từng node.
  if (root !== null) {
    root.style.setProperty("--cf-text-node", `${options.settings.fontSize}px`);
    root.style.setProperty("--cf-edge-width", String(options.settings.edgeWidth));
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  // Id hiển thị của node đang chọn - một sourceId có thể có nhiều bản sao (fanout §14.2),
  // và cạnh của MỌI bản sao đều phải sáng lên cùng lúc.
  const selectedDisplayIds = new Set(
    options.selectedSourceId === undefined
      ? []
      : graph.nodes.filter((n) => n.sourceId === options.selectedSourceId).map((n) => n.id),
  );
  const hasChildren = new Set(
    graph.nodes.map((n) => n.parentDisplayId).filter((id): id is string => id !== undefined),
  );

  // Edge trước, node sau: node phải nằm trên cạnh, không bị cạnh vẽ đè lên chữ.
  const edgeLayer = element("g", { class: "cf-edges" });
  const nodeLayer = element("g", { class: "cf-nodes" });
  surface.append(edgeLayer, nodeLayer);

  for (const laid of layout.edges) {
    const edge = graph.edges[laid.index];
    if (edge === undefined || laid.points.length < 2) continue;

    const points = laid.points.map((p) => `${p.x},${p.y}`).join(" ");
    // Mặc định mọi cạnh mờ như nhau; chỉ cạnh dính node đang chọn mới sáng. Cạnh nào cũng
    // sáng thì trên graph 500 node không đọc được cạnh nào.
    const active = selectedDisplayIds.has(edge.from) || selectedDisplayIds.has(edge.to);
    const classes = ["cf-edge"];
    if (edge.isBackEdge) classes.push("cf-edge-back");
    if (active) classes.push("cf-edge-active");
    const line = element("polyline", {
      points,
      class: classes.join(" "),
      "marker-end": edge.isBackEdge ? "url(#cf-arrow-back)" : "url(#cf-arrow)",
      // Đầu mút để đổi highlight TẠI CHỖ khi đổi node đang chọn - không phải dựng lại DOM
      // (trên graph 700 node, dựng lại là vài trăm ms mỗi lần bấm).
      "data-from": edge.from,
      "data-to": edge.to,
    });
    if (edge.label !== null && edge.label !== undefined) {
      line.setAttribute("data-label", edge.label);
    }
    edgeLayer.append(line);

    if (laid.label !== undefined) {
      // Nền chữ: nhãn nằm trên cạnh, không có nền thì chữ và cạnh chồng nhau không đọc được.
      const padding = 2;
      edgeLayer.append(
        element("rect", {
          x: laid.label.x - padding,
          y: laid.label.y - padding,
          width: laid.label.width + padding * 2,
          height: laid.label.height + padding * 2,
          rx: 2,
          class: "cf-edge-label-bg",
        }),
      );
      const text = element("text", {
        x: laid.label.x,
        y: laid.label.y + laid.label.height - 3,
        class: `cf-edge-label cf-edge-label-${laid.label.text}`,
      });
      text.textContent = laid.label.text;
      edgeLayer.append(text);
    }
  }

  for (const laid of layout.nodes) {
    const node = byId.get(laid.id);
    if (node === undefined) continue;
    nodeLayer.append(
      buildNode(node, laid, {
        ...options,
        collapsible: hasChildren.has(node.id) || options.hiddenCounts.has(node.id),
      }),
    );
  }
}

function buildNode(
  node: DisplayNode,
  laid: Layout["nodes"][number],
  options: RenderOptions & { collapsible: boolean },
): SVGGElement {
  const style = styleForKind(node.node.kind);
  const geometry = geometryFor(style.shape, laid.width, laid.height);
  const border = borderFor(node.node);
  const selected = options.selectedSourceId === node.sourceId;

  const group = element("g", {
    class: `cf-node cf-node-${node.node.kind} cf-border-${border}${selected ? " cf-selected" : ""}`,
    transform: `translate(${laid.x},${laid.y})`,
    "data-source-id": node.sourceId,
    tabindex: 0,
    role: "button",
  });

  // KHÔNG đặt `fill="var(--cf-fill-…)"` như presentation attribute: `var()` trong
  // presentation attribute của SVG không được hỗ trợ đáng tin, giá trị thành không hợp lệ và
  // fill rơi về ĐEN mặc định. Đẩy qua custom property inline, còn khai báo `fill` để CSS lo -
  // như vậy `:hover` vẫn ghi đè được (inline `style.fill` thì hover sẽ thua).
  group.style.setProperty("--cf-node-fill", style.fill);
  const outline = element("path", { d: geometry.outline, class: "cf-shape" });
  group.append(outline);
  for (const accent of geometry.accents) {
    group.append(element("path", { d: accent, class: "cf-accent" }));
  }

  const label = element("text", {
    x: laid.width / 2,
    y: laid.height / 2 + 4,
    class: "cf-node-label",
    "text-anchor": "middle",
  });
  label.textContent = truncate(node.displayLabel, laid.width, options.settings.fontSize);
  group.append(label);

  // Dấu "suy luận một chiều" (SEMANTICS §14.3): `unknown` + có `parsed` KHÔNG phải analyzer mù,
  // nên không vẽ nét đứt, nhưng cũng không được im lặng như `certain`.
  if (border === "solid-inferred") {
    const mark = element("text", { x: laid.width - 9, y: 14, class: "cf-inferred-mark" });
    mark.textContent = "◐";
    group.append(mark);
  }

  const hidden = options.hiddenCounts.get(node.id);
  if (hidden !== undefined && hidden > 0) {
    const badge = element("g", { class: "cf-badge" });
    badge.append(element("rect", { x: laid.width - 30, y: laid.height - 9, width: 34, height: 16, rx: 8 }));
    const count = element("text", { x: laid.width - 13, y: laid.height + 2, "text-anchor": "middle" });
    count.textContent = `+${hidden}`;
    badge.append(count);
    group.append(badge);
  }

  if (options.collapsible) {
    const toggle = element("g", { class: "cf-toggle", role: "button" });
    toggle.append(element("circle", { cx: 9, cy: 9, r: 7 }));
    const sign = element("text", { x: 9, y: 13, "text-anchor": "middle" });
    sign.textContent = hidden === undefined ? "−" : "+";
    toggle.append(sign);
    toggle.addEventListener("click", (event) => {
      event.stopPropagation(); // Bấm nút thu gọn KHÔNG đồng thời là chọn node.
      options.onToggleCollapse(node.sourceId);
    });
    group.append(toggle);
  }

  group.addEventListener("click", () => options.onSelect(node.sourceId));
  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      options.onSelect(node.sourceId);
    }
  });

  return group;
}
