// Fixture NGUỒN cho golden của webview.
//
// Mục tiêu: cả ba mức hiển thị của SEMANTICS §14.3 phải xuất hiện thật, để test nét viền
// chạy trên dữ liệu analyzer sinh ra chứ không phải trên tổ hợp tôi tự bịa:
//
//  - `req.code === "A"`         → certain + parsed        → nét liền
//  - `req.mode === "fast" && f` → unknown + parsed (§12)  → nét liền + dấu suy luận 1 chiều
//  - `req.code.length > 3`      → unknown, không parsed    → nét đứt
//  - `req.code?.trim() ?? "x"`  → statement unknown, không parsed (§11) → nét đứt
//
// Dòng thứ tư cũng chứng minh ô "statement + unknown + có parsed" là KHÔNG THỂ XẢY RA:
// §11 chỉ hạ confidence, không bao giờ điền parsed cho statement.

export function route(req: { code: string; mode: string }, flag: boolean): string {
  if (req.code === "A") {
    return "alpha";
  }
  if (req.mode === "fast" && flag) {
    return "quick";
  }
  if (req.code.length > 3) {
    return "long";
  }
  const label = req.code?.trim() ?? "none";
  switch (req.mode) {
    case "slow":
      return "s" + label;
    default:
      return label;
  }
}
