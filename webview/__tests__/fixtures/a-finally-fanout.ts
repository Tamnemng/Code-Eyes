// Fixture NGUỒN cho golden của webview. Không compile, không chạy - analyzer chỉ parse nó
// thành text. Nằm trong `__tests__/fixtures/` nên bị loại khỏi cả tsconfig lẫn vitest.
//
// Mục tiêu: node `finally` có in-degree cao VÀ out-degree = 2.
// Out-degree 2 là cái mà mọi fixture Giai đoạn 1 đều không có (ở đó out luôn = 1), vì nó
// cần thân try VỪA có return sớm VỪA hoàn thành bình thường được. Đây chính là hub bậc cao
// mà SEMANTICS §14.2 buộc renderer phải tách, và là over-approximation §7 mô tả.

export function shipOrder(order: string): string {
  let status = "pending";
  try {
    if (order === "") {
      return "empty";
    }
    if (order === "bad") {
      return "rejected";
    }
    if (order === "hold") {
      throw new Error("held");
    }
    status = "ok";
  } finally {
    console.log("audit");
  }
  return status;
}
