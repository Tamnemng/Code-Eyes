import { describe, expect, it } from "vitest";

import { messagesFor } from "../i18n";

describe("webview i18n", () => {
  it("có bản dịch Việt và Anh riêng cho các khu vực chính", () => {
    const vi = messagesFor("vi");
    const en = messagesFor("en");

    for (const key of [
      "filterTitle",
      "settingsTitle",
      "nodeScale",
      "palette",
      "resetSettings",
      "graphError",
    ] as const) {
      expect(vi[key]).not.toBe("");
      expect(en[key]).not.toBe("");
      expect(vi[key]).not.toBe(en[key]);
    }
  });

  it("dịch cả chuỗi động của filter, cảnh báo và panel chi tiết", () => {
    const vi = messagesFor("vi");
    const en = messagesFor("en");

    expect(vi.hiddenNodes(3, 10)).toBe("Đang ẩn 3/10");
    expect(en.hiddenNodes(3, 10)).toBe("Hiding 3/10");
    expect(vi.warningCount(2)).toContain("cảnh báo");
    expect(en.warningCount(2)).toBe("2 warnings");
    expect(vi.detail.jumpToLine(12)).toBe("Nhảy tới dòng 12");
    expect(en.detail.jumpToLine(12)).toBe("Jump to line 12");
  });
});
