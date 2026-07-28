import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_NODE_KINDS, styleForKind } from "../model/node-style";

const css = readFileSync(path.join(import.meta.dirname, "..", "styles.css"), "utf8");

/** Tên biến bên trong `var(--x)` / `var(--x, fallback)`. */
function varName(value: string): string | undefined {
  return /^var\((--[a-z0-9-]+)/i.exec(value)?.[1];
}

describe("styles.css phải định nghĩa mọi token mà bảng style trỏ tới", () => {
  // Lớp bug này im lặng: biến không tồn tại -> giá trị không hợp lệ -> fill về ĐEN mặc định,
  // chữ đen trên node đen. Không có test nào khác bắt được vì nó không phải lỗi kiểu.
  it.each(ALL_NODE_KINDS)("%s: biến fill được khai báo", (kind) => {
    const name = varName(styleForKind(kind).fill);
    expect(name, `fill của ${kind} phải là var(--…)`).toBeDefined();
    expect(css, `${String(name)} chưa được khai báo trong styles.css`).toContain(`${String(name)}:`);
  });

  it.each(ALL_NODE_KINDS)("%s: có class accent .cf-node-%s", (kind) => {
    expect(css).toContain(`.cf-node-${kind}`);
  });

  it.each(ALL_NODE_KINDS)("%s: biến accent của class đó cũng được khai báo", (kind) => {
    const rule = new RegExp(`\\.cf-node-${kind}\\s*\\{[^}]*--cf-node-accent:\\s*var\\((--[a-z0-9-]+)`, "i");
    const name = rule.exec(css)?.[1];
    expect(name, `.cf-node-${kind} phải gán --cf-node-accent`).toBeDefined();
    expect(css).toContain(`${String(name)}:`);
  });
});

describe("styles.css - các class mà svg.ts và detail.ts dựa vào", () => {
  const REQUIRED = [
    ".cf-shape",
    ".cf-accent",
    ".cf-node-label",
    ".cf-edge",
    ".cf-edge-back",
    ".cf-edge-active",
    ".cf-edge-label",
    ".cf-edge-label-bg",
    ".cf-arrow",
    ".cf-arrow-back",
    ".cf-badge",
    ".cf-toggle",
    ".cf-inferred-mark",
    ".cf-selected",
    // ba mức viền §14.3
    ".cf-border-solid",
    ".cf-border-solid-inferred",
    ".cf-border-dashed",
  ] as const;

  it.each(REQUIRED)("%s có style", (selector) => {
    expect(css).toContain(selector);
  });

  it("fill của node khai báo trong CSS, KHÔNG qua presentation attribute", () => {
    // `var()` trong presentation attribute của SVG không đáng tin -> fill rơi về đen.
    // `--cf-node-fill` do svg.ts đặt inline; khai báo `fill` phải nằm ở đây để :hover ghi đè được.
    expect(css).toMatch(/\.cf-shape\s*\{[^}]*fill:\s*var\(--cf-node-fill/);
  });

  it("có trạng thái hover và selected rõ ràng", () => {
    expect(css).toMatch(/\.cf-node:hover\s+\.cf-shape/);
    expect(css).toMatch(/\.cf-node\.cf-selected\s+\.cf-shape/);
  });

  it("màu cứng CHỈ được nằm trong khối khai báo token, không trong rule của component", () => {
    // Khối token = `:root` (mặc định) và `[data-cf-palette="…"]` (bảng màu người dùng chọn).
    // Rule của component chỉ được dùng `var(--…)`; có màu cứng ở đó là đường tắt sẽ phá
    // theme VS Code và phá luôn tính năng đổi bảng màu.
    const withoutTokens = css.replace(/(?::root|\[data-cf-palette="[a-z]+"\])\s*\{[\s\S]*?\n\}/g, "");
    const hardCoded = withoutTokens.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(hardCoded, `màu cứng ngoài khối token: ${hardCoded.join(", ")}`).toHaveLength(0);
  });

  it("mọi palette đều chỉ khai báo token, không đặt thuộc tính CSS thường", () => {
    for (const palette of ["soft", "contrast"] as const) {
      const block = new RegExp(`\\[data-cf-palette="${palette}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
      expect(block?.[1], `thiếu khối palette ${palette}`).toBeDefined();
      for (const line of (block?.[1] ?? "").split("\n")) {
        const declaration = line.trim();
        if (declaration === "" || declaration.startsWith("/*")) continue;
        expect(declaration.startsWith("--cf-"), `${palette}: "${declaration}" không phải token`).toBe(
          true,
        );
      }
    }
  });

  it("độ dày cạnh và cỡ chữ node đi qua biến do settings điều khiển", () => {
    expect(css).toMatch(/\.cf-edge\s*\{[^}]*stroke-width:\s*var\(--cf-edge-width/);
    expect(css).toMatch(/\.cf-node-label\s*\{[^}]*font-size:\s*var\(--cf-text-node/);
    expect(css).toContain("--cf-edge-width:");
    expect(css).toContain("--cf-text-node:");
  });

  it("KHÔNG transition trên phần tử graph - đó là nguồn lag khi pan graph lớn", () => {
    for (const selector of [".cf-edge", ".cf-node .cf-shape"] as const) {
      const block = new RegExp(`\\${selector.replace(/ /g, "\\s+")}\\s*\\{([^}]*)\\}`).exec(css);
      // Bỏ comment trước khi kiểm: chính comment giải thích "KHÔNG transition" cũng chứa từ đó.
      const declarations = (block?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(declarations, `${selector} không được có transition`).not.toContain("transition");
    }
  });
});
