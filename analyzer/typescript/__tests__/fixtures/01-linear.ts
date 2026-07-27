// Fixture: chuỗi statement tuyến tính phải gộp thành MỘT node "statement".
// Không typecheck file này (đã exclude trong tsconfig) - nó là dữ liệu đầu vào.

export function computeTotal(items: number[]): number {
  const count = items.length;
  let total = 0;
  total += count;
  const label = "total";
  console.log(label, total);
  return total;
}

export function logOnly(name: string): void {
  const greeting = "hi " + name;
  console.log(greeting);
}

export function noop(): void {}
