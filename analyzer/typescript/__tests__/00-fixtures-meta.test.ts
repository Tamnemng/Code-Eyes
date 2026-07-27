import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { FIXTURES_DIR, cursorAt, readFixture } from "./helpers/analyze";
import { CATALOG, cursorToken } from "./helpers/catalog";

// Test về chính bộ khung test (không gọi analyzer). Phải XANH ngay cả khi
// analyzer chưa được viết - nếu đỏ nghĩa là fixture/catalog lệch nhau.
describe("bộ khung fixture", () => {
  it("mọi file trong fixtures/ đều được khai báo trong CATALOG", () => {
    const onDisk = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".ts"));
    const declared = new Set(CATALOG.map((c) => c.file));
    expect([...onDisk].sort()).toEqual([...declared].sort());
  });

  it.each(CATALOG)("con trỏ của $file :: $fn trỏ đúng vào token", (testCase) => {
    const token = cursorToken(testCase);
    const { line, column } = cursorAt(testCase.file, token);
    const lines = readFixture(testCase.file).split("\n");

    expect(line).toBeGreaterThanOrEqual(1);
    expect(line).toBeLessThanOrEqual(lines.length);

    const text = lines[line - 1] as string;
    expect(text).toContain(token);
    expect(text.slice(column)).toMatch(new RegExp(`^${token}\\b`));
    // con trỏ không được rơi vào comment
    expect(text.trimStart().startsWith("//")).toBe(false);
    expect(text.trimStart().startsWith("*")).toBe(false);
  });

  it("không fixture nào trùng tên hàm trong cùng một file", () => {
    const seen = new Set<string>();
    for (const c of CATALOG) {
      const key = `${c.file}::${c.fn}`;
      expect(seen.has(key), `khai báo trùng: ${key}`).toBe(false);
      seen.add(key);
    }
  });
});
