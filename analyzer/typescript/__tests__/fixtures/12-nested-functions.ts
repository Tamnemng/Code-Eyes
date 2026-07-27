// Fixture: arrow function / hàm lồng KHÔNG được inline.
// Mỗi thân hàm lồng -> 1 node kind:"call" + 1 warning.
// Hệ quả: `if` bên trong `double` KHÔNG được sinh node condition nào.

export function summarize(items: number[]): string {
  const double = (n: number) => {
    if (n > 10) {
      return n;
    }
    return n * 2;
  };
  let total = 0;
  for (const item of items) {
    total += double(item);
  }
  const format = function tally(v: number): string {
    return "total=" + v;
  };
  items.forEach((item) => {
    total += item;
  });
  return format(total);
}
