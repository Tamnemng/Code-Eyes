import { describe, expect, it } from "vitest";

import { ALL_NODE_KINDS, styleForKind } from "../model/node-style";
import { geometryFor } from "../render/shapes";

const SHAPES = [...new Set(ALL_NODE_KINDS.map((k) => styleForKind(k).shape))];

describe("geometryFor - mọi shape dùng bởi bảng style đều dựng được", () => {
  it("14 kind ánh xạ về ít nhất 5 shape khác nhau", () => {
    expect(SHAPES.length).toBeGreaterThanOrEqual(5);
  });

  it.each(SHAPES)("%s: outline là path đóng, không NaN", (shape) => {
    const geometry = geometryFor(shape, 120, 40);
    expect(geometry.outline.startsWith("M")).toBe(true);
    expect(geometry.outline).toMatch(/[Zz]$/);
    expect(geometry.outline).not.toContain("NaN");
    for (const accent of geometry.accents) expect(accent).not.toContain("NaN");
  });

  it.each(SHAPES)("%s: kích thước suy biến không sinh NaN hay path rỗng", (shape) => {
    for (const [w, h] of [
      [0, 0],
      [1, 1],
      [4, 200],
      [200, 4],
    ] as const) {
      const geometry = geometryFor(shape, w, h);
      expect(geometry.outline, `${shape} ${w}x${h}`).not.toContain("NaN");
      expect(geometry.outline.length, `${shape} ${w}x${h}`).toBeGreaterThan(0);
    }
  });
});

describe("geometryFor - hình phải PHÂN BIỆT ĐƯỢC khi không có màu", () => {
  it("mỗi shape cho một hình khác nhau ở cùng kích thước", () => {
    // Ràng buộc khả dụng: người mù màu và bản in đen trắng vẫn phải đọc ra node rẽ nhánh.
    // So cả accent, không chỉ outline: `region` cố ý dùng chung outline với `box` và phân
    // biệt bằng viền đôi. Chỉ so outline là bỏ qua đúng phần mang thông tin.
    const geometries = SHAPES.map((s) => JSON.stringify(geometryFor(s, 120, 40)));
    expect(new Set(geometries).size).toBe(SHAPES.length);
  });

  it("region dùng chung outline với box nhưng KHÁC nhờ accent", () => {
    const region = geometryFor("region", 120, 40);
    const box = geometryFor("box", 120, 40);
    expect(region.outline).toBe(box.outline);
    expect(region.accents).not.toEqual(box.accents);
  });

  it("diamond là tứ giác 4 đỉnh", () => {
    const outline = geometryFor("diamond", 100, 40).outline;
    expect(outline.match(/[ML]/g)).toHaveLength(4);
  });

  it("region và subroutine có accent (viền trong / vạch dọc)", () => {
    expect(geometryFor("region", 120, 40).accents.length).toBeGreaterThan(0);
    expect(geometryFor("subroutine", 120, 40).accents.length).toBeGreaterThan(0);
  });

  it("box không có accent - node thường phải là node thường", () => {
    expect(geometryFor("box", 120, 40).accents).toHaveLength(0);
  });

  it("stadium bo tròn hết chiều cao, terminal thì không", () => {
    expect(geometryFor("stadium", 120, 40).outline).not.toBe(
      geometryFor("terminal", 120, 40).outline,
    );
  });
});

describe("geometryFor - thuần", () => {
  it("cùng input -> cùng output", () => {
    expect(geometryFor("hexagon", 100, 30)).toEqual(geometryFor("hexagon", 100, 30));
  });
});
