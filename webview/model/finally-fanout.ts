// webview/model/finally-fanout.ts
// Nhân bản vùng `finally` ở mức hiển thị (SEMANTICS §14.2).
//
// GRANULARITY: cả VÙNG, không chỉ node marker. §14.2 viết "một bản sao nhỏ của node
// `finally`", nhưng đo trên dữ liệu thật thì hub không nằm ở marker (out-degree 1) mà ở
// node CUỐI THÂN finally (out-degree 2-3). Nhân bản marker thôi thì hub chỉ tụt xuống một
// node - không giải quyết gì. Xem TODO.md 3b.
//
// MẶC ĐỊNH TẮT cho tới khi có số liệu. Tiền đề "7 vào / 2 ra" của §14.2 sai ở vế out-degree,
// nên điều khoản đó thành giả thuyết cần kiểm, và giao thức đo đã đăng ký TRƯỚC ở TODO.md
// 3b (primary: số cạnh cắt nhau; thắng khi giảm >= 20% mà chiều dài tăng <= 10%).
// Hàm này vẫn được cài và test đầy đủ - phải có nó mới đo được.

import type { DisplayEdge, DisplayGraph, DisplayNode } from "./display-graph";

/**
 * Pipeline render có gọi `fanoutFinallyRegions` hay không. MỘT nhánh ở đúng một chỗ ghép -
 * mọi module hạ nguồn (`collapse`, `autoCollapse`, `toElkGraph`) đều là hàm thuần trên
 * `DisplayGraph` nên không có chế độ nào để nhân đôi.
 *
 * Đổi giá trị này chỉ khi có số liệu ghi vào TODO.md 3b.
 */
export const FANOUT_ENABLED = false;

/**
 * Tập id HIỂN THỊ thuộc vùng của một marker: chính nó + mọi hậu duệ theo `parentDisplayId`.
 * Phải đi theo id hiển thị chứ không phải `sourceId`: sau lần nhân bản đầu tiên, nhiều bản
 * sao chung `sourceId` và quan hệ theo `sourceId` sẽ gom nhầm chúng thành một vùng.
 */
function regionOf(graph: DisplayGraph, markerId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const n of graph.nodes) {
    const parent = n.parentDisplayId;
    if (parent === undefined) continue;
    const list = childrenOf.get(parent);
    if (list === undefined) childrenOf.set(parent, [n.id]);
    else list.push(n.id);
  }

  const region = new Set<string>([markerId]);
  const stack = [markerId];
  while (stack.length > 0) {
    for (const child of childrenOf.get(stack.pop() as string) ?? []) {
      if (region.has(child)) continue;
      region.add(child);
      stack.push(child);
    }
  }
  return region;
}

function inDegree(graph: DisplayGraph, id: string): number {
  return graph.edges.filter((e) => e.to === id).length;
}

/** Nhân bản đúng MỘT vùng. Trả `undefined` nếu vùng này không tách được. */
function fanoutOne(graph: DisplayGraph, markerId: string): DisplayGraph | undefined {
  const regionIds = regionOf(graph, markerId);

  const inbound = graph.edges.filter((e) => e.to === markerId && !regionIds.has(e.from));
  if (inbound.length <= 1) return undefined; // Không có hub để tách.

  // Phòng vệ: cạnh từ ngoài đi thẳng vào một node BÊN TRONG vùng (không qua marker) thì
  // không có cách chia bản sao nào là đúng - bỏ qua vùng này thay vì đoán bừa.
  if (graph.edges.some((e) => !regionIds.has(e.from) && regionIds.has(e.to) && e.to !== markerId)) {
    return undefined;
  }

  const internal = graph.edges.filter((e) => regionIds.has(e.from) && regionIds.has(e.to));
  const outbound = graph.edges.filter((e) => regionIds.has(e.from) && !regionIds.has(e.to));
  const untouched = graph.edges.filter((e) => !regionIds.has(e.from) && !regionIds.has(e.to));

  const copies = inbound.length;
  const copyId = (originalId: string, index: number): string => `${originalId}#${index + 1}`;

  const nodes: DisplayNode[] = [];
  for (const node of graph.nodes) {
    if (!regionIds.has(node.id)) {
      nodes.push(node);
      continue;
    }
    for (let i = 0; i < copies; i += 1) {
      const parent = node.parentDisplayId;
      nodes.push({
        id: copyId(node.id, i),
        sourceId: node.sourceId,
        // Chỉ marker mang bộ đếm - §14.2 dạng `finally (1/7)`. Thân giữ nhãn của nó.
        displayLabel:
          node.id === markerId ? `${node.node.label} (${i + 1}/${copies})` : node.displayLabel,
        // Cha nằm trong vùng thì trỏ về cha CÙNG BẢN SAO; nằm ngoài thì giữ nguyên.
        parentDisplayId:
          parent !== undefined && regionIds.has(parent) ? copyId(parent, i) : parent,
        node: node.node,
      });
    }
  }

  const edges: DisplayEdge[] = [...untouched];
  for (let i = 0; i < copies; i += 1) {
    const entryEdge = inbound[i];
    if (entryEdge !== undefined) edges.push({ ...entryEdge, to: copyId(markerId, i) });
    for (const e of internal) {
      edges.push({ ...e, from: copyId(e.from, i), to: copyId(e.to, i) });
    }
    for (const e of outbound) {
      // Mỗi bản sao GIỮ CẢ các cạnh ra. Không cắt bớt được: muốn biết bản sao nào đi đích
      // nào phải suy lại `PendingExit`, kiến thức của analyzer không có trong graph. Đây
      // đúng là over-approximation §7 mô tả - xem TODO.md mục 4.
      edges.push({ ...e, from: copyId(e.from, i) });
    }
  }

  return { ...graph, nodes, edges };
}

/**
 * Nhân bản mọi vùng `finally` có nhiều hơn một cạnh vào, cho tới điểm bất động (mọi marker
 * còn đúng 1 cạnh vào).
 *
 * Xử lý VÙNG TRONG CÙNG TRƯỚC: nhân bản vùng ngoài trước rồi mới tới vùng trong sẽ khiến k
 * bản sao thân của vùng trong đổ dồn vào một bản sao của marker ngoài, tái tạo lại đúng cái
 * hub vừa tách (và phải nhân bản chồng lần hai, sinh id `#1#1`).
 *
 * Hệ quả còn lại: vùng lồng nhau vẫn tăng trưởng NHÂN - marker ngoài cuối cùng có số bản sao
 * bằng in-degree SAU khi vùng trong đã nhân. Có chủ ý, và là một trong những thứ phép đo ở
 * TODO.md 3b phải tính vào.
 */
export function fanoutFinallyRegions(graph: DisplayGraph): DisplayGraph {
  let current = graph;
  const skipped = new Set<string>();

  for (;;) {
    const candidates = current.nodes.filter(
      (n) => n.node.kind === "finally" && !skipped.has(n.id) && inDegree(current, n.id) > 1,
    );
    if (candidates.length === 0) return current;

    // Trong cùng trước: vùng của nó không chứa marker đủ điều kiện nào khác.
    const innermost =
      candidates.find((c) => {
        const region = regionOf(current, c.id);
        return !candidates.some((other) => other.id !== c.id && region.has(other.id));
      }) ?? candidates[0];
    if (innermost === undefined) return current;

    const after = fanoutOne(current, innermost.id);
    if (after === undefined) {
      skipped.add(innermost.id);
      continue;
    }
    current = after;
  }
}
