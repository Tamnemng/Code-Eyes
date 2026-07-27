// Fixture của bộ test ĐỘC LẬP (Phần A) - do người review viết, không phải tác giả analyzer.
// Nhắm vào: finally lồng nhau, do-while, fallthrough nhiều tầng, và một ca phủ định
// để bắt lỗi định tuyến thừa qua finally không tồn tại.

declare function cleanupInner(): void;
declare function cleanupOuter(): void;
declare function cleanup(): void;
declare function done(): void;
declare function log(value: number): void;

// A1: return xuyên hai tầng finally.
// Đường đúng: return -> finally trong -> finally ngoài -> exit.
export function nestedFinallyReturn(x: string): string {
  try {
    try {
      return "inner";
    } finally {
      cleanupInner();
    }
  } finally {
    cleanupOuter();
  }
}

// A2: break có label xuyên hai tầng finally, phải chạy CẢ HAI trước khi tới sau vòng lặp.
export function nestedFinallyBreak(items: string[]): void {
  outer: for (const a of items) {
    try {
      try {
        break outer;
      } finally {
        cleanupInner();
      }
    } finally {
      cleanupOuter();
    }
  }
  done();
}

// A3: throw xuyên hai tầng finally, không có catch nào.
export function nestedFinallyThrow(x: string): string {
  try {
    try {
      throw new Error(x);
    } finally {
      cleanupInner();
    }
  } finally {
    cleanupOuter();
  }
  return "unreachable";
}

// A4: return trong finally tầng trong đè lên completion đang treo của tầng ngoài.
export function finallyOverridesNested(): string {
  try {
    try {
      return "a";
    } finally {
      return "b";
    }
  } finally {
    cleanupOuter();
  }
}

// A5: do-while - cạnh ngược và đích của continue.
export function doWhileBackEdge(n: number): number {
  let i = 0;
  do {
    i = i + 1;
    if (i > n) {
      continue;
    }
    log(i);
  } while (i < n);
  return i;
}

// A6: fallthrough nhiều tầng, có clause rỗng xen giữa và default nhận fallthrough.
export function multiFallthrough(code: string): string {
  let out = "";
  switch (code) {
    case "A":
      out = "a";
    case "B":
    case "C":
      out = out + "bc";
      break;
    case "D":
      out = "d";
    default:
      out = out + "z";
  }
  return out;
}

// A7: return trong vòng lặp trong try/finally.
export function returnInLoopInTry(items: string[]): string {
  try {
    for (const it of items) {
      if (it === "A") {
        return it;
      }
    }
    return "none";
  } finally {
    cleanup();
  }
}

// A8: ca phủ định - KHÔNG có finally thì return phải đi thẳng ra exit.
export function noFinallyDirect(x: string): string {
  try {
    return "a";
  } catch (e) {
    return "b";
  }
  return "c";
}
