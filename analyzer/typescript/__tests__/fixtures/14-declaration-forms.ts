// Fixture: các dạng khai báo hàm mà con trỏ có thể rơi vào,
// và hành vi khi con trỏ nằm BÊN TRONG một hàm lồng.

export class OrderService {
  private prefix: string;

  constructor(prefix: string) {
    if (prefix === "") {
      this.prefix = "default";
      return;
    }
    this.prefix = prefix;
  }

  get label(): string {
    if (this.prefix === "vip") {
      return "VIP";
    }
    return this.prefix;
  }

  route(code: string): string {
    if (code === "A") {
      return this.prefix + "-alpha";
    }
    return this.prefix + "-other";
  }
}

export const handlers = {
  onSubmit(code: string): string {
    if (code === "ok") {
      return "submitted";
    }
    return "rejected";
  },
};

// Con trỏ đặt trong thân arrow bên dưới -> phải phân tích chính arrow đó,
// không phải hàm bao ngoài. (Không nhắc tên định danh trong comment: helper
// đặt con trỏ tìm lần xuất hiện ĐẦU TIÊN của token trong file.)
export function withCallback(items: string[]): number {
  let total = 0;
  items.forEach((item) => {
    const insideCallback = item.length;
    if (insideCallback > 0) {
      total += insideCallback;
    }
  });
  return total;
}
