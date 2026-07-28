// Fixture NGUỒN cho golden của webview.
//
// Mục tiêu: MỘT hàm chạm đủ 14 `NodeKind`, để test bảng style chứng minh được là không
// kind nào rơi vào default im lặng - trên dữ liệu thật, không phải trên danh sách tôi gõ tay.
//
// entry, exit           : mọi graph đều có
// statement             : `let total = 0;`
// call                  : thân arrow `bump` (§9 - KHÔNG inline, một node `call`)
// loop                  : `for (const item of items)`
// condition             : `if (...)` và discriminant của `switch`
// switch-case           : `case "fast":` / `default:`
// break, continue       : trong thân loop
// try, catch, finally    : khối try trong thân loop
// throw                 : trong catch
// return                : cuối hàm

export function everything(items: string[], mode: string): number {
  let total = 0;
  const bump = (n: number) => n + 1;
  for (const item of items) {
    if (item === "skip") {
      continue;
    }
    if (item === "stop") {
      break;
    }
    switch (mode) {
      case "fast":
        total = bump(total);
        break;
      default:
        total += item.length;
    }
    try {
      total += 1;
    } catch (err) {
      throw new Error("nope");
    } finally {
      total += 0;
    }
  }
  return total;
}
