import { describe, expect, it } from "vitest";

import type { DisplayGraph } from "../model/display-graph";
import { toDisplayGraph } from "../model/display-graph";
import { applyCollapse, pruneCollapsedIds } from "../model/collapse";
import { fanoutFinallyRegions } from "../model/finally-fanout";
import { loadGolden } from "./helpers/golden";

function plain(name: string): DisplayGraph {
  return toDisplayGraph(loadGolden(name));
}

function visibleIds(graph: DisplayGraph): string[] {
  return graph.nodes.map((n) => n.id);
}

describe("applyCollapse - subtree theo parentDisplayId", () => {
  it("không collapse gì -> graph không đổi", () => {
    const before = plain("b-nested-regions-pipeline");
    const view = applyCollapse(before, new Set());
    expect(visibleIds(view.graph)).toEqual(visibleIds(before));
    expect(view.graph.edges).toHaveLength(before.edges.length);
    expect(view.hiddenCounts.size).toBe(0);
  });

  it("collapse try ngoài: ẩn CẢ subtree lồng nhau, node bị collapse vẫn hiện", () => {
    // pipeline: n_3 = try ngoài. Con trực tiếp: n_6 (try trong), n_7 (finally trong), ...
    // Con của con: n_13 (thân finally trong) - phải ẩn theo, không chỉ một tầng.
    const before = plain("b-nested-regions-pipeline");
    const view = applyCollapse(before, new Set(["n_3"]));
    const visible = new Set(visibleIds(view.graph));

    expect(visible.has("n_3")).toBe(true);
    for (const hidden of ["n_6", "n_7", "n_13"]) {
      expect(visible.has(hidden), `${hidden} phải bị ẩn`).toBe(false);
    }
    // Anh em của n_3 (catch/finally NGOÀI, parentId = undefined) KHÔNG bị ẩn.
    expect(visible.has("n_4")).toBe(true);
    expect(visible.has("n_5")).toBe(true);
  });

  it("badge đếm theo sourceId phân biệt, không theo node hiển thị", () => {
    const before = plain("b-nested-regions-pipeline");
    const view = applyCollapse(before, new Set(["n_3"]));
    const hiddenSourceIds = new Set(
      before.nodes
        .filter((n) => !visibleIds(view.graph).includes(n.id) )
        .map((n) => n.sourceId),
    );
    expect(view.hiddenCounts.get("n_3")).toBe(hiddenSourceIds.size);
    expect(view.hiddenCounts.get("n_3")).toBeGreaterThan(0);
  });

  it("collapse node cha CỦA node đã collapse: kết quả bằng chỉ collapse cha", () => {
    const before = plain("b-nested-regions-pipeline");
    const onlyParent = applyCollapse(before, new Set(["n_3"]));
    const both = applyCollapse(before, new Set(["n_3", "n_7"]));

    expect(visibleIds(both.graph)).toEqual(visibleIds(onlyParent.graph));
    // Badge chỉ nằm trên node còn NHÌN THẤY. n_7 đã bị ẩn nên không có badge.
    expect(both.hiddenCounts.has("n_7")).toBe(false);
    expect(both.hiddenCounts.get("n_3")).toBe(onlyParent.hiddenCounts.get("n_3"));
  });
});

describe("applyCollapse - edge bắc qua ranh giới phải được GOM, không được mất", () => {
  it("edge từ node bị ẩn ra ngoài -> nâng lên node đang collapse", () => {
    const before = plain("b-nested-regions-pipeline");
    const view = applyCollapse(before, new Set(["n_3"]));

    // Ranh giới của vùng n_3 nằm ở đâu: n_5 (finally NGOÀI) và n_4 (catch) đều có
    // parentId = undefined nên vẫn hiện. Cạnh n_13 -> n_5 và n_13 -[exception]-> n_4 bắc
    // qua ranh giới, phải được nâng lên n_3.
    expect(view.graph.edges.filter((e) => e.from === "n_3" && e.to === "n_5")).toHaveLength(1);
    expect(
      view.graph.edges.filter((e) => e.from === "n_3" && e.to === "n_4" && e.label === "exception"),
    ).toHaveLength(1);

    // Không còn cạnh nào dính node đã ẩn.
    for (const hidden of ["n_13", "n_9", "n_14"]) {
      expect(
        view.graph.edges.some((e) => e.from === hidden || e.to === hidden),
        `còn cạnh dính ${hidden}`,
      ).toBe(false);
    }
  });

  it("edge nằm TRỌN trong vùng đã gộp -> self-loop, bỏ đi là đúng", () => {
    // `n_14 return "done";` cũng có parentId = n_3 (nằm trong thân try ngoài), nên cạnh
    // n_13 -> n_14 nâng thành n_3 -> n_3. Giữ nó lại là vẽ một vòng lặp không tồn tại.
    const before = plain("b-nested-regions-pipeline");
    expect(before.nodes.find((n) => n.id === "n_14")?.parentDisplayId).toBe("n_3");

    const view = applyCollapse(before, new Set(["n_3"]));
    expect(view.graph.edges.some((e) => e.from === "n_3" && e.to === "n_3")).toBe(false);
  });

  it("mọi edge gốc đều có ảnh: hoặc thành edge đã nâng, hoặc là self-loop bị bỏ", () => {
    for (const name of ["b-nested-regions-pipeline", "e-all-kinds-everything"] as const) {
      const before = plain(name);
      const collapsed = new Set(
        before.nodes.filter((n) => n.node.kind === "try" || n.node.kind === "finally").map((n) => n.sourceId),
      );
      const view = applyCollapse(before, collapsed);

      const visible = new Set(visibleIds(view.graph));
      const nearestVisible = (id: string): string => {
        let current: string | undefined = id;
        const byId = new Map(before.nodes.map((n) => [n.id, n]));
        while (current !== undefined && !visible.has(current)) {
          current = byId.get(current)?.parentDisplayId;
        }
        if (current === undefined) throw new Error(`${name}: ${id} không có tổ tiên nào hiện`);
        return current;
      };

      const present = new Set(view.graph.edges.map((e) => `${e.from}->${e.to}:${e.label ?? ""}`));
      for (const e of before.edges) {
        const from = nearestVisible(e.from);
        const to = nearestVisible(e.to);
        if (from === to) continue; // self-loop trong lòng vùng đã gộp - bỏ là đúng
        expect(present.has(`${from}->${to}:${e.label ?? ""}`), `${name}: mất ${e.from}->${e.to}`).toBe(
          true,
        );
      }
    }
  });

  it("edge trùng nhau sau khi nâng thì gom làm một, không nhân bản", () => {
    const before = plain("b-nested-regions-pipeline");
    const view = applyCollapse(before, new Set(["n_3"]));
    const keys = view.graph.edges.map((e) => `${e.from}->${e.to}:${e.label ?? ""}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("không tạo self-loop", () => {
    const before = plain("e-all-kinds-everything");
    const collapsed = new Set(before.nodes.filter((n) => n.node.kind === "try").map((n) => n.sourceId));
    for (const e of applyCollapse(before, collapsed).graph.edges) {
      expect(e.from).not.toBe(e.to);
    }
  });

  it("cờ isBackEdge sống sót qua việc nâng cạnh", () => {
    const before = plain("e-all-kinds-everything");
    const marked: DisplayGraph = {
      ...before,
      edges: before.edges.map((e) => (e.to === "n_5" ? { ...e, isBackEdge: true } : e)),
    };
    const view = applyCollapse(marked, new Set(["n_16"]));
    expect(view.graph.edges.some((e) => e.isBackEdge)).toBe(true);
  });
});

describe("applyCollapse - collapsedIds là sourceId, không phải id hiển thị", () => {
  it("collapse một vùng đã fanout: MỌI bản sao cùng thu gọn, không có bản nào sót", () => {
    // Đây là case dễ lọt nhất: người dùng click MỘT node, nhưng vùng đó có k bản sao ở tầng
    // vẽ. Hoặc cả k cùng ẩn, hoặc không bản nào - không được nửa vời.
    const fanned = fanoutFinallyRegions(plain("b-nested-regions-pipeline"));
    const markerCopies = fanned.nodes.filter((n) => n.sourceId === "n_7");
    expect(markerCopies.length).toBeGreaterThan(1);

    const view = applyCollapse(fanned, new Set(["n_7"]));
    const visible = new Set(visibleIds(view.graph));

    // Mọi bản sao marker vẫn hiện (chúng LÀ node bị collapse)...
    for (const m of markerCopies) expect(visible.has(m.id), m.id).toBe(true);
    // ...và mọi bản sao THÂN đều ẩn, không sót bản nào.
    expect(fanned.nodes.filter((n) => n.sourceId === "n_13").length).toBeGreaterThan(1);
    for (const b of fanned.nodes.filter((n) => n.sourceId === "n_13")) {
      expect(visible.has(b.id), `bản sao thân ${b.id} phải ẩn`).toBe(false);
    }
  });

  it("collapse vùng ngoài trên graph đã fanout: bản sao của vùng trong cũng ẩn hết", () => {
    const fanned = fanoutFinallyRegions(plain("b-nested-regions-pipeline"));
    const view = applyCollapse(fanned, new Set(["n_3"]));
    const visible = new Set(visibleIds(view.graph));
    for (const n of fanned.nodes) {
      if (n.sourceId === "n_7" || n.sourceId === "n_13" || n.sourceId === "n_6") {
        expect(visible.has(n.id), `${n.id} (${n.sourceId}) phải ẩn`).toBe(false);
      }
    }
  });

  it("badge trên graph đã fanout vẫn đếm theo sourceId, không đếm bản sao", () => {
    const fanned = fanoutFinallyRegions(plain("b-nested-regions-pipeline"));
    const view = applyCollapse(fanned, new Set(["n_7"]));
    // Vùng finally trong có đúng MỘT node thân (`n_13`) dù có nhiều bản sao.
    for (const [, count] of view.hiddenCounts) expect(count).toBe(1);
  });
});

describe("pruneCollapsedIds - graph đổi thì id cũ phải rụng im lặng", () => {
  it("bỏ id không còn tồn tại, không throw", () => {
    const graph = plain("b-nested-regions-pipeline");
    const kept = pruneCollapsedIds(graph, ["n_3", "n_999", "khong-ton-tai"]);
    expect(kept).toEqual(new Set(["n_3"]));
  });

  it("graph mới không còn node nào cũ -> tập rỗng, không giữ id mồ côi", () => {
    expect(pruneCollapsedIds(plain("c-loops-drain"), ["n_3", "n_7", "n_13"]).size).toBeLessThan(3);
    expect(pruneCollapsedIds(plain("c-loops-drain"), ["zzz"])).toEqual(new Set());
  });

  it("so khớp theo sourceId nên vẫn đúng trên graph đã fanout", () => {
    const fanned = fanoutFinallyRegions(plain("b-nested-regions-pipeline"));
    expect(pruneCollapsedIds(fanned, ["n_7", "n_7#1", "n_404"])).toEqual(new Set(["n_7"]));
  });

  it("input rỗng -> ra rỗng", () => {
    expect(pruneCollapsedIds(plain("c-loops-scan"), [])).toEqual(new Set());
  });
});

describe("applyCollapse - thuần", () => {
  it("không đột biến input", () => {
    const before = plain("b-nested-regions-pipeline");
    const snapshot = JSON.stringify(before);
    applyCollapse(before, new Set(["n_3", "n_5"]));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("cùng input -> cùng output", () => {
    const before = plain("e-all-kinds-everything");
    const a = applyCollapse(before, new Set(["n_16"]));
    const b = applyCollapse(before, new Set(["n_16"]));
    expect(JSON.stringify(a.graph)).toBe(JSON.stringify(b.graph));
  });

  it("id collapse không có trong graph thì bị bỏ qua, không crash", () => {
    const before = plain("c-loops-scan");
    const view = applyCollapse(before, new Set(["khong-co"]));
    expect(visibleIds(view.graph)).toEqual(visibleIds(before));
  });
});
