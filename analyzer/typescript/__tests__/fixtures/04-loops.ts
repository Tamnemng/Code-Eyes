// Fixture: for, for-of, for-in, while, do-while.
// Cạnh ngược KHÔNG được đánh nhãn - test suy ra bằng DFS (SEMANTICS §4).

export function sumTo(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += i;
  }
  return total;
}

export function joinNames(names: string[]): string {
  let out = "";
  for (const name of names) {
    out += name;
  }
  return out;
}

export function keysOf(obj: Record<string, number>): string[] {
  const keys: string[] = [];
  for (const key in obj) {
    keys.push(key);
  }
  return keys;
}

export function countdown(n: number): number {
  let steps = 0;
  while (n > 0) {
    n -= 1;
    steps += 1;
  }
  return steps;
}

export function atLeastOnce(n: number): number {
  let steps = 0;
  do {
    n -= 1;
    steps += 1;
  } while (n > 0);
  return steps;
}

// while (true): không có edge "false"; đường ra duy nhất là break.
export function drainQueue(queue: string[]): number {
  let handled = 0;
  while (true) {
    const item = queue.pop();
    if (item === "stop") {
      break;
    }
    handled += 1;
  }
  return handled;
}
