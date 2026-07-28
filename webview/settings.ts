// webview/settings.ts
// Tuỳ chỉnh hiển thị: cỡ node, cỡ chữ, độ dày đường nối, bảng màu. Thuần, không chạm DOM.
//
// `nodeScale` và `fontSize` ẢNH HƯỞNG LAYOUT (ELK cần kích thước node bằng số, xem
// `elk-input.ts`), nên đổi hai giá trị này phải chạy lại layout. `edgeWidth` và `palette`
// chỉ là CSS, đổi xong vẽ lại là đủ.

export type Palette = "default" | "soft" | "contrast";

export const PALETTES: readonly Palette[] = ["default", "soft", "contrast"];

export interface DisplaySettings {
  /** Hệ số nhân kích thước node. 1 = mặc định. */
  nodeScale: number;
  /** Cỡ chữ nhãn node, px. */
  fontSize: number;
  /** Độ dày đường nối, px. */
  edgeWidth: number;
  palette: Palette;
}

export const LIMITS = {
  nodeScale: { min: 0.6, max: 2.5, step: 0.1 },
  fontSize: { min: 8, max: 22, step: 1 },
  edgeWidth: { min: 0.5, max: 4, step: 0.1 },
} as const;

export function defaultSettings(): DisplaySettings {
  return { nodeScale: 1, fontSize: 12, edgeWidth: 1.1, palette: "default" };
}

function clamp(value: unknown, limits: { min: number; max: number }, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, value));
}

export function clampSettings(raw: Partial<DisplaySettings>): DisplaySettings {
  const base = defaultSettings();
  return {
    nodeScale: clamp(raw.nodeScale, LIMITS.nodeScale, base.nodeScale),
    fontSize: clamp(raw.fontSize, LIMITS.fontSize, base.fontSize),
    edgeWidth: clamp(raw.edgeWidth, LIMITS.edgeWidth, base.edgeWidth),
    palette: raw.palette !== undefined && PALETTES.includes(raw.palette) ? raw.palette : base.palette,
  };
}

/**
 * Bề rộng một ký tự của font mono ở cỡ chữ đã cho. ELK không đo text nên con số này quyết
 * định node có vừa chữ hay không - hệ số 0.6 là tỉ lệ advance width điển hình của font mono.
 */
export function monoCharWidth(fontSize: number): number {
  return fontSize * 0.6;
}

/** Đổi kích thước có làm layout khác đi không - dùng để biết có cần chạy lại ELK. */
export function affectsLayout(a: DisplaySettings, b: DisplaySettings): boolean {
  return a.nodeScale !== b.nodeScale || a.fontSize !== b.fontSize;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Phục hồi từ dữ liệu không tin được (bản webview trước ghi ra). Không throw. */
export function restoreSettings(raw: unknown): DisplaySettings {
  if (!isRecord(raw)) return defaultSettings();
  return clampSettings({
    nodeScale: typeof raw["nodeScale"] === "number" ? raw["nodeScale"] : undefined,
    fontSize: typeof raw["fontSize"] === "number" ? raw["fontSize"] : undefined,
    edgeWidth: typeof raw["edgeWidth"] === "number" ? raw["edgeWidth"] : undefined,
    palette: typeof raw["palette"] === "string" ? (raw["palette"] as Palette) : undefined,
  });
}
