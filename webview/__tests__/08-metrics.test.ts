import { describe, expect, it } from "vitest";

import { edgeCrossings, totalEdgeLength } from "../layout/metrics";
import type { Layout } from "../layout/run-elk";

function layout(edges: Array<Array<[number, number]>>): Layout {
  return {
    width: 100,
    height: 100,
    nodes: [],
    edges: edges.map((points, index) => ({
      index,
      points: points.map(([x, y]) => ({ x, y })),
    })),
  };
}

describe("totalEdgeLength", () => {
  it("cộng chiều dài từng khúc của đường gấp khúc", () => {
    expect(totalEdgeLength(layout([[[0, 0], [3, 4]]]))).toBeCloseTo(5);
    expect(totalEdgeLength(layout([[[0, 0], [0, 10], [10, 10]]]))).toBeCloseTo(20);
  });

  it("không có edge -> 0", () => {
    expect(totalEdgeLength(layout([]))).toBe(0);
  });

  it("edge một điểm -> 0, không NaN", () => {
    expect(totalEdgeLength(layout([[[5, 5]]]))).toBe(0);
  });
});

describe("edgeCrossings", () => {
  it("hai đoạn cắt nhau ở điểm trong -> 1", () => {
    expect(edgeCrossings(layout([
      [[0, 0], [10, 10]],
      [[0, 10], [10, 0]],
    ]))).toBe(1);
  });

  it("song song -> 0", () => {
    expect(edgeCrossings(layout([
      [[0, 0], [10, 0]],
      [[0, 5], [10, 5]],
    ]))).toBe(0);
  });

  it("chạm nhau ở ĐẦU MÚT không tính là cắt", () => {
    // Cạnh cùng ra từ một node luôn gặp nhau ở node đó. Đếm vào thì mọi node bậc cao tự
    // động "cắt nhau" và metric mất nghĩa.
    expect(edgeCrossings(layout([
      [[0, 0], [10, 10]],
      [[0, 0], [10, 0]],
    ]))).toBe(0);
    expect(edgeCrossings(layout([
      [[0, 0], [5, 5]],
      [[5, 5], [10, 0]],
    ]))).toBe(0);
  });

  it("hai khúc của CÙNG một cạnh không tự cắt nhau", () => {
    expect(edgeCrossings(layout([[[0, 0], [10, 10], [0, 10], [10, 0]]]))).toBe(0);
  });

  it("một cặp cạnh cắt hai lần -> đếm 2", () => {
    expect(edgeCrossings(layout([
      [[0, 5], [20, 5]],
      [[5, 0], [5, 10], [15, 10], [15, 0]],
    ]))).toBe(2);
  });

  it("đoạn dài 0 bị bỏ qua, không sinh cắt ảo", () => {
    expect(edgeCrossings(layout([
      [[0, 0], [0, 0], [10, 10]],
      [[0, 10], [10, 0]],
    ]))).toBe(1);
  });
});
