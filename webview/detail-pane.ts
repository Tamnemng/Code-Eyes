export const DEFAULT_DETAIL_WIDTH = 260;
export const MIN_DETAIL_WIDTH = 180;
export const MAX_DETAIL_RATIO = 0.55;

/**
 * Tính chiều rộng sidebar từ vị trí con trỏ. Thuần để khóa hai bất biến:
 * sidebar không nhỏ đến vô dụng và không bao giờ lấy quá 55% vùng graph.
 */
export function detailWidthFromPointer(
  containerLeft: number,
  containerRight: number,
  pointerX: number,
): number {
  const available = Math.max(0, containerRight - containerLeft);
  const maximum = available * MAX_DETAIL_RATIO;
  if (maximum === 0) return 0;
  const minimum = Math.min(MIN_DETAIL_WIDTH, maximum);
  return Math.round(Math.min(maximum, Math.max(minimum, containerRight - pointerX)));
}
