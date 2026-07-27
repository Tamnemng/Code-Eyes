// Fixture: condition.parsed chỉ điền cho các dạng đơn giản.
// Mọi dạng khác -> parsed undefined + confidence "unknown".

export function routeClient(
  clientCode: string,
  region: string,
  count: number,
  tags: string[],
): string {
  if (clientCode === "A") {
    return "alpha";
  }
  if (clientCode == "B") {
    return "bravo";
  }
  if ("Z" === clientCode) {
    return "zulu";
  }
  if (region !== "EU") {
    return "non-eu";
  }
  if (clientCode.startsWith("X")) {
    return "x-family";
  }
  if (["C", "D"].includes(clientCode)) {
    return "cd";
  }
  if (count > 10) {
    return "many";
  }
  if (tags.length === count) {
    return "tagged";
  }
  switch (region) {
    case "US":
      return "us";
    default:
      return "other";
  }
}

// && trong biểu thức điều kiện KHÔNG phải nhánh ngầm -> không warning.
// parsed lấy từ hạng tử parse được, nhưng chỉ kết luận MỘT CHIỀU -> confidence unknown.
export function canEdit(role: string, active: boolean): string {
  if (role === "admin" && active) {
    return "yes";
  }
  return "no";
}

// || KHÔNG điền parsed: kết luận chắc chắn chạy ngược chiều, schema không ghi được chiều.
export function isBlocked(status: string, banned: boolean): string {
  if (status === "blocked" || banned) {
    return "blocked";
  }
  return "open";
}

// Thứ tự lấy hạng tử trong chuỗi &&: trái sang phải, hạng tử parse được ĐẦU TIÊN.
export function chainOrder(clientCode: string, tags: string[]): string {
  if (tags.length > 0 && clientCode === "A") {
    return "tagged-alpha";
  }
  if (clientCode === "B" && clientCode.startsWith("B")) {
    return "double-parse";
  }
  return "none";
}
