import { describe, expect, expectTypeOf, it } from "vitest";

import type { FlowNode, NodeKind } from "../../shared/types";
import { ALL_NODE_KINDS, borderFor, styleForKind } from "../model/node-style";
import { loadGolden } from "./helpers/golden";

describe("styleForKind - không kind nào rơi vào default im lặng", () => {
  it("ALL_NODE_KINDS phủ ĐÚNG NodeKind, không thiếu không thừa", () => {
    // Kiểm ở tầng KIỂU, nên thêm một NodeKind vào schema là tsc đỏ ngay - không cần
    // ai nhớ cập nhật test. Cộng với `never` check ở nhánh default của styleForKind,
    // đây là hai lớp chặn ở compile time.
    expectTypeOf<(typeof ALL_NODE_KINDS)[number]>().toEqualTypeOf<NodeKind>();
  });

  it.each(ALL_NODE_KINDS)("%s: có style tường minh", (kind) => {
    const style = styleForKind(kind);
    expect(style.fill, kind).toMatch(/^var\(--/);
    expect(style.shape, kind).toBeTruthy();
  });

  it("node rẽ nhánh và node tuần tự phải khác hình - đọc được khi không có màu", () => {
    // Ràng buộc khả dụng: chỉ khác màu là không đủ cho người mù màu.
    expect(styleForKind("condition").shape).not.toBe(styleForKind("statement").shape);
    expect(styleForKind("loop").shape).not.toBe(styleForKind("statement").shape);
    expect(styleForKind("entry").shape).not.toBe(styleForKind("statement").shape);
  });

  it("entry và exit cùng hình nhưng khác màu", () => {
    expect(styleForKind("exit").shape).toBe(styleForKind("entry").shape);
    expect(styleForKind("exit").fill).not.toBe(styleForKind("entry").fill);
  });
});

/** Node tối thiểu để thử `borderFor` - chỉ ba field mà nó đọc. */
function node(
  confidence: FlowNode["confidence"],
  parsed: boolean,
  kind: NodeKind = "condition",
): FlowNode {
  return {
    id: "n_1",
    kind,
    label: "x",
    code: "x",
    range: { startLine: 1, startCol: 0, endLine: 1, endCol: 1 },
    confidence,
    ...(parsed
      ? { condition: { raw: 'x === "A"', parsed: { variable: "x", operator: "==", value: "A" } } }
      : {}),
  };
}

describe("borderFor - ba mức SEMANTICS §14.3, không phải hai", () => {
  it("certain -> nét liền", () => {
    expect(borderFor(node("certain", true))).toBe("solid");
    expect(borderFor(node("certain", false))).toBe("solid");
  });

  it("unknown + có parsed -> nét liền, thêm dấu suy luận một chiều", () => {
    expect(borderFor(node("unknown", true))).toBe("solid-inferred");
  });

  it("unknown + không parsed -> nét đứt", () => {
    expect(borderFor(node("unknown", false))).toBe("dashed");
  });

  it("condition.raw có mà parsed không -> vẫn là nét đứt", () => {
    // §12: `x || y` cho raw nhưng KHÔNG cho parsed. Có raw không đồng nghĩa suy luận được.
    const n: FlowNode = { ...node("unknown", false), condition: { raw: "a || b" } };
    expect(borderFor(n)).toBe("dashed");
  });
});

describe("borderFor trên dữ liệu analyzer thật", () => {
  it("route: đủ cả ba mức xuất hiện", () => {
    const treatments = new Set(loadGolden("d-confidence-route").nodes.map(borderFor));
    expect(treatments).toEqual(new Set(["solid", "solid-inferred", "dashed"]));
  });

  it("statement unknown là nét đứt - ô 'statement + unknown + parsed' không tồn tại", () => {
    // §11 chỉ hạ confidence, không bao giờ điền parsed cho statement. Khẳng định điều đó
    // trên dữ liệu thật thay vì bịa kỳ vọng cho một ô vô nghĩa.
    const statements = loadGolden("d-confidence-route").nodes.filter(
      (n) => n.kind === "statement" && n.confidence === "unknown",
    );
    expect(statements.length).toBeGreaterThan(0);
    for (const n of statements) {
      expect(n.condition?.parsed).toBeUndefined();
      expect(borderFor(n)).toBe("dashed");
    }
  });

  it("mọi node của mọi golden nhận được style, không ngoại lệ", () => {
    for (const name of [
      "a-finally-fanout-shipOrder",
      "b-nested-regions-pipeline",
      "c-loops-scan",
      "c-loops-drain",
      "c-loops-bailOut",
      "d-confidence-route",
      "e-all-kinds-everything",
    ] as const) {
      for (const n of loadGolden(name).nodes) {
        expect(styleForKind(n.kind).shape, `${name}/${n.id}`).toBeTruthy();
        expect(borderFor(n), `${name}/${n.id}`).toBeTruthy();
      }
    }
  });

  it("e-all-kinds phủ đủ 14 kind - bảng style được thử trên toàn bộ schema", () => {
    const kinds = new Set(loadGolden("e-all-kinds-everything").nodes.map((n) => n.kind));
    expect(kinds.size).toBe(ALL_NODE_KINDS.length);
  });
});
