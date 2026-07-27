// Fixture tổ hợp: chỗ các construct giao nhau, nơi analyzer dễ sai nhất.

// 1) return bên trong vòng lặp bên trong try/finally.
export function findFirst(items: string[]): string {
  try {
    for (const item of items) {
      if (item !== "") {
        return item;
      }
    }
    return "none";
  } finally {
    console.log("scan done");
  }
}

// 2) continue bên trong try/finally: phải chạy finally TRƯỚC khi quay lại đầu vòng lặp.
export function sumValid(items: string[]): number {
  let total = 0;
  for (const item of items) {
    try {
      if (item === "skip") {
        continue;
      }
      total += item.length;
    } finally {
      total += 1;
    }
  }
  return total;
}

// 3) return bên trong khối finally: ghi đè hoàn thành đang treo -> phải có warning.
export function overridden(raw: string): string {
  try {
    return raw;
  } finally {
    if (raw === "") {
      return "empty";
    }
    console.log("kept");
  }
}
