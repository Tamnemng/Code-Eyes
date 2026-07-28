// webview/render/shapes.ts
// `NodeShape` -> hình học SVG. Hàm thuần (chỉ trả string path), không chạm DOM, nên test được.
//
// Hình phải phân biệt được KHI KHÔNG CÓ MÀU: node rẽ nhánh và node tuần tự chỉ khác màu là
// người mù màu và bản in đen trắng đọc không ra, mà "đâu là chỗ rẽ nhánh" chính là thông tin
// duy nhất tool này bán.

import type { NodeShape } from "../model/node-style";

export interface ShapeGeometry {
  /** Path chính: fill + stroke. Luôn là path đóng. */
  outline: string;
  /** Path phụ, CHỈ stroke - viền trong của `region`, vạch dọc của `subroutine`. */
  accents: string[];
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * Chữ nhật bo góc tại `(ox, oy)`. `r` bị kẹp để không vượt nửa cạnh ngắn (nguồn NaN kinh điển).
 * Có offset để dựng được viền TRONG của `region` mà không phải dịch path bằng thao tác chuỗi.
 */
function roundedRect(w: number, h: number, radius: number, ox = 0, oy = 0): string {
  const r = round(Math.max(0, Math.min(radius, w / 2, h / 2)));
  const left = round(ox);
  const top = round(oy);
  const right = round(ox + w);
  const bottom = round(oy + h);
  if (r === 0) return `M${left} ${top} L${right} ${top} L${right} ${bottom} L${left} ${bottom} Z`;
  return (
    `M${round(ox + r)} ${top} L${round(ox + w - r)} ${top} A${r} ${r} 0 0 1 ${right} ${round(oy + r)} ` +
    `L${right} ${round(oy + h - r)} A${r} ${r} 0 0 1 ${round(ox + w - r)} ${bottom} ` +
    `L${round(ox + r)} ${bottom} A${r} ${r} 0 0 1 ${left} ${round(oy + h - r)} ` +
    `L${left} ${round(oy + r)} A${r} ${r} 0 0 1 ${round(ox + r)} ${top} Z`
  );
}

function polygon(points: ReadonlyArray<readonly [number, number]>): string {
  const parts = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`);
  return `${parts.join(" ")} Z`;
}

export function geometryFor(shape: NodeShape, width: number, height: number): ShapeGeometry {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  // Vát góc, kẹp theo cả hai chiều để hình không tự lộn khi node rất hẹp hoặc rất thấp.
  const notch = round(Math.min(14, w / 4, h / 2));

  switch (shape) {
    case "stadium":
      return { outline: roundedRect(w, h, h / 2), accents: [] };

    case "box":
      return { outline: roundedRect(w, h, 6), accents: [] };

    case "terminal":
      // Bo góc rõ nhưng KHÔNG bo hết chiều cao - phải khác `stadium` của entry/exit.
      return { outline: roundedRect(w, h, Math.min(13, h / 3)), accents: [] };

    case "diamond":
      return {
        outline: polygon([
          [w / 2, 0],
          [w, h / 2],
          [w / 2, h],
          [0, h / 2],
        ]),
        accents: [],
      };

    case "hexagon":
      return {
        outline: polygon([
          [notch, 0],
          [w - notch, 0],
          [w, h / 2],
          [w - notch, h],
          [notch, h],
          [0, h / 2],
        ]),
        accents: [],
      };

    case "trapezoid":
      return {
        outline: polygon([
          [notch, 0],
          [w - notch, 0],
          [w, h],
          [0, h],
        ]),
        accents: [],
      };

    case "region": {
      // Viền đôi: node đánh dấu vùng, không phải node thực thi một câu lệnh.
      const inset = round(Math.min(5, w / 6, h / 6));
      return {
        // Cùng outline với `box` là CÓ Ý: phân biệt bằng viền đôi, không bằng bo góc khác.
        outline: roundedRect(w, h, 6),
        accents: inset <= 0 ? [] : [roundedRect(w - inset * 2, h - inset * 2, 4, inset, inset)],
      };
    }

    case "subroutine": {
      // Hai vạch dọc: ký hiệu flowchart cổ điển cho "gọi ra ngoài" - ở đây là thân hàm lồng
      // KHÔNG được inline (SEMANTICS §9).
      const bar = round(Math.min(9, w / 5));
      return {
        outline: roundedRect(w, h, 5),
        accents:
          bar <= 0
            ? []
            : [`M${bar} 0 L${bar} ${round(h)} Z`, `M${round(w - bar)} 0 L${round(w - bar)} ${round(h)} Z`],
      };
    }

    default: {
      const unhandled: never = shape;
      throw new Error(`NodeShape chưa có hình học: ${String(unhandled)}`);
    }
  }
}
