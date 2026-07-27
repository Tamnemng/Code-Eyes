// Fixture: toán tử ba ngôi phải tạo nhánh thật, không gộp vào statement.

export function pickColor(kind: string): string {
  const color = kind === "urgent" ? "RED" : "GRAY";
  return color;
}

export function pickSize(n: number): string {
  const size = n > 10 ? "big" : n > 5 ? "mid" : "small";
  return size;
}

export function describeCount(count: number): string {
  const prefix = "item";
  const suffix = count > 1 ? "many" : "one";
  const out = prefix + suffix;
  return out;
}
