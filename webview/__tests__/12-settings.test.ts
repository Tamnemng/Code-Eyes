import { describe, expect, it } from "vitest";

import {
  LIMITS,
  LOCALES,
  PALETTES,
  affectsLayout,
  clampSettings,
  defaultSettings,
  monoCharWidth,
  restoreSettings,
} from "../settings";

describe("clampSettings", () => {
  it("giá trị hợp lệ đi qua nguyên vẹn", () => {
    expect(clampSettings({ nodeScale: 1.5, fontSize: 14, edgeWidth: 2, palette: "soft", locale: "en" })).toEqual({
      nodeScale: 1.5,
      fontSize: 14,
      edgeWidth: 2,
      palette: "soft",
      locale: "en",
    });
  });

  it("kẹp về biên, không trả giá trị vô nghĩa", () => {
    const tiny = clampSettings({ nodeScale: 0, fontSize: 0, edgeWidth: 0 });
    expect(tiny.nodeScale).toBe(LIMITS.nodeScale.min);
    expect(tiny.fontSize).toBe(LIMITS.fontSize.min);
    expect(tiny.edgeWidth).toBe(LIMITS.edgeWidth.min);

    const huge = clampSettings({ nodeScale: 99, fontSize: 99, edgeWidth: 99 });
    expect(huge.nodeScale).toBe(LIMITS.nodeScale.max);
    expect(huge.fontSize).toBe(LIMITS.fontSize.max);
    expect(huge.edgeWidth).toBe(LIMITS.edgeWidth.max);
  });

  it("NaN / kiểu sai -> lấy mặc định từng field, không lan NaN vào layout", () => {
    expect(clampSettings({ nodeScale: Number.NaN })).toEqual(defaultSettings());
    // @ts-expect-error - cố tình truyền kiểu sai: dữ liệu này đến từ getState, không tin được
    expect(clampSettings({ fontSize: "to" })).toEqual(defaultSettings());
  });

  it("palette lạ -> default", () => {
    // @ts-expect-error - palette của bản webview cũ có thể không còn tồn tại
    expect(clampSettings({ palette: "neon" }).palette).toBe("default");
  });

  it("ngôn ngữ chỉ nhận vi/en, giá trị lạ trở về tiếng Việt", () => {
    expect(clampSettings({ locale: "en" }).locale).toBe("en");
    // @ts-expect-error - state cũ hoặc hỏng có thể chứa locale lạ
    expect(clampSettings({ locale: "fr" }).locale).toBe("vi");
  });

  it("bỏ trống -> đúng mặc định", () => {
    expect(clampSettings({})).toEqual(defaultSettings());
  });
});

describe("restoreSettings - dữ liệu không tin được", () => {
  it("rác các loại -> mặc định, không throw", () => {
    for (const raw of [undefined, null, 0, "x", [], true]) {
      expect(() => restoreSettings(raw)).not.toThrow();
      expect(restoreSettings(raw)).toEqual(defaultSettings());
    }
  });

  it("lấy được phần hiểu được, bỏ phần không", () => {
    const restored = restoreSettings({ nodeScale: 1.4, fontSize: "to", palette: "contrast", la: 1 });
    expect(restored.nodeScale).toBe(1.4);
    expect(restored.fontSize).toBe(defaultSettings().fontSize);
    expect(restored.palette).toBe("contrast");
  });

  it("round-trip qua JSON", () => {
    const settings = clampSettings({ nodeScale: 2, fontSize: 16, edgeWidth: 3, palette: "soft" });
    expect(restoreSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  });
});

describe("monoCharWidth", () => {
  it("tỉ lệ theo cỡ chữ - ELK không đo text nên con số này quyết định node có vừa chữ", () => {
    expect(monoCharWidth(10)).toBeCloseTo(6);
    expect(monoCharWidth(20)).toBeCloseTo(12);
    expect(monoCharWidth(20)).toBeGreaterThan(monoCharWidth(10));
  });
});

describe("affectsLayout", () => {
  it("đổi cỡ node hoặc cỡ chữ -> phải chạy lại ELK", () => {
    const base = defaultSettings();
    expect(affectsLayout(base, { ...base, nodeScale: 1.2 })).toBe(true);
    expect(affectsLayout(base, { ...base, fontSize: 15 })).toBe(true);
  });

  it("đổi độ dày cạnh hoặc bảng màu -> chỉ CSS, KHÔNG cần layout lại", () => {
    const base = defaultSettings();
    expect(affectsLayout(base, { ...base, edgeWidth: 3 })).toBe(false);
    expect(affectsLayout(base, { ...base, palette: "contrast" })).toBe(false);
    expect(affectsLayout(base, { ...base, locale: "en" })).toBe(false);
  });

  it("không đổi gì -> false", () => {
    expect(affectsLayout(defaultSettings(), defaultSettings())).toBe(false);
  });
});

describe("PALETTES", () => {
  it("mọi palette đều clamp qua được chính nó", () => {
    for (const palette of PALETTES) {
      expect(clampSettings({ palette }).palette).toBe(palette);
    }
  });
});

describe("LOCALES", () => {
  it("có đúng hai ngôn ngữ Việt và Anh", () => {
    expect(LOCALES).toEqual(["vi", "en"]);
  });
});
