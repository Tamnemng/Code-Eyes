import { describe, expect, it } from "vitest";

import {
  DEFAULT_DETAIL_WIDTH,
  MAX_DETAIL_RATIO,
  MIN_DETAIL_WIDTH,
  detailWidthFromPointer,
} from "../detail-pane";

describe("detailWidthFromPointer", () => {
  it("sidebar mặc định nhỏ, không chiếm phần lớn graph", () => {
    expect(DEFAULT_DETAIL_WIDTH).toBe(260);
    expect(MAX_DETAIL_RATIO).toBe(0.55);
  });

  it("kéo sang trái/phải đổi width theo cạnh phải container", () => {
    expect(detailWidthFromPointer(0, 1000, 700)).toBe(300);
    expect(detailWidthFromPointer(100, 900, 650)).toBe(250);
  });

  it("kẹp min và tối đa 55% để graph luôn còn chỗ", () => {
    expect(detailWidthFromPointer(0, 1000, 990)).toBe(MIN_DETAIL_WIDTH);
    expect(detailWidthFromPointer(0, 1000, 100)).toBe(550);
  });

  it("container hẹp hơn min vẫn không trả width âm hoặc tràn container", () => {
    expect(detailWidthFromPointer(0, 200, 50)).toBe(110);
    expect(detailWidthFromPointer(10, 10, 10)).toBe(0);
  });
});
