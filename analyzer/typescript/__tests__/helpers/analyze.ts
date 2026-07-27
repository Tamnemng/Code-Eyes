import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeFunctionAtCursor } from "../../index";
import type { FlowGraph } from "../../../../shared/types";

export const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

export function fixturePath(file: string): string {
  return path.join(FIXTURES_DIR, file);
}

export function readFixture(file: string): string {
  return readFileSync(fixturePath(file), "utf8");
}

/**
 * Đặt con trỏ tại lần xuất hiện ĐẦU TIÊN của `token` trong fixture.
 * `token` thường là tên hàm, nhưng cũng có thể là một identifier nằm bên trong
 * thân hàm lồng (để kiểm hành vi "chọn hàm trong cùng" - SEMANTICS §13).
 * Trả về { line: 1-based, column: 0-based } đúng quy ước của AnalyzeRequest.
 */
export function cursorAt(file: string, token: string): { line: number; column: number } {
  const source = readFixture(file);
  const offset = source.search(new RegExp(`\\b${token}\\b`));
  if (offset < 0) {
    throw new Error(`Không tìm thấy token "${token}" trong fixture ${file}`);
  }
  const before = source.slice(0, offset);
  return {
    line: before.split("\n").length,
    column: offset - (before.lastIndexOf("\n") + 1),
  };
}

/** Phân tích một hàm trong fixture. Đây là cửa duy nhất mà test gọi vào analyzer. */
export function analyzeFixture(file: string, token: string): FlowGraph {
  const { line, column } = cursorAt(file, token);
  return analyzeFunctionAtCursor({
    filePath: fixturePath(file),
    line,
    column,
    sourceText: readFixture(file),
  });
}
