// webview/render/interact.ts
// Zoom (wheel) + pan (drag) + reset view. Chạm DOM.

import type { Transform } from "../state";
import { clampScale } from "../state";

export interface InteractOptions {
  /** Gọi mỗi khi transform đổi, để lưu vào `setState`. */
  onChange: (transform: Transform) => void;
}

export interface InteractHandles {
  apply: (transform: Transform) => void;
  /** Đưa graph vừa khít vào khung nhìn. */
  fit: (contentWidth: number, contentHeight: number) => void;
  destroy: () => void;
}

const FIT_PADDING = 32;
/**
 * Cho phép phóng TO khi vừa khít, không kẹp ở 1.
 *
 * Kẹp ở 1 làm graph nhỏ (6-30 node, tức phần lớn hàm) chỉ chiếm một góc canvas trong khi
 * còn thừa cả màn hình. Chặn trên 1.6 để hàm 3 node không bị bung thành áp phích.
 */
const FIT_MAX_SCALE = 1.6;

export function attachInteractions(
  root: SVGSVGElement,
  surface: SVGGElement,
  initial: Transform,
  options: InteractOptions,
): InteractHandles {
  let transform: Transform = { ...initial };
  /** Đã bấm xuống nhưng chưa vượt ngưỡng -> chưa coi là kéo, để click còn cơ hội xảy ra. */
  let pressed = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let startX = 0;
  let startY = 0;

  const paint = (): void => {
    surface.setAttribute(
      "transform",
      `translate(${transform.x},${transform.y}) scale(${transform.scale})`,
    );
  };

  const commit = (): void => {
    paint();
    options.onChange({ ...transform });
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    const next = clampScale(transform.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
    if (next === transform.scale) return;
    // Zoom quanh CON TRỎ, không quanh gốc toạ độ: zoom quanh gốc làm chỗ đang xem trôi đi
    // và trên graph 1000 node thì mất dấu ngay.
    const ratio = next / transform.scale;
    transform = {
      x: pointerX - (pointerX - transform.x) * ratio,
      y: pointerY - (pointerY - transform.y) * ratio,
      scale: next,
    };
    commit();
  };

  // Ngưỡng để phân biệt "bấm chọn" với "kéo pan". Rung tay vài pixel vẫn phải là click.
  const DRAG_THRESHOLD = 3;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    pressed = true;
    startX = event.clientX;
    startY = event.clientY;
    lastX = event.clientX;
    lastY = event.clientY;
    // CỐ TÌNH KHÔNG gọi `setPointerCapture`: capture chuyển hướng mọi pointer event tiếp theo
    // - KỂ CẢ `click` - về element đã capture, nên listener click trên node không bao giờ chạy.
    // Đó chính là bug làm panel chi tiết không mở và nút +/- không ăn.
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!pressed) return;
    if (!dragging) {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      root.classList.add("cf-dragging");
    }
    transform = {
      ...transform,
      x: transform.x + (event.clientX - lastX),
      y: transform.y + (event.clientY - lastY),
    };
    lastX = event.clientX;
    lastY = event.clientY;
    paint(); // Không commit từng frame - chỉ lưu khi nhả chuột.
  };

  const onPointerUp = (): void => {
    if (!pressed) return;
    pressed = false;
    if (!dragging) return; // Chỉ là click - để nó nổi lên node bình thường.
    dragging = false;
    root.classList.remove("cf-dragging");
    // Sau khi kéo, browser vẫn phát một `click`. Chặn đúng cái đó, không thì thả chuột
    // giữa graph lại chọn mất node nằm dưới con trỏ.
    root.addEventListener("click", (click) => click.stopPropagation(), {
      capture: true,
      once: true,
    });
    commit();
  };

  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("pointerdown", onPointerDown);
  // move/up gắn trên window: không có pointer capture nên chuột ra ngoài SVG vẫn phải theo,
  // và nhả chuột ngoài khung vẫn phải kết thúc việc kéo.
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  paint();

  return {
    apply: (next) => {
      transform = { ...next, scale: clampScale(next.scale) };
      paint();
    },
    fit: (contentWidth, contentHeight) => {
      const rect = root.getBoundingClientRect();
      if (contentWidth <= 0 || contentHeight <= 0 || rect.width === 0 || rect.height === 0) return;
      const scale = clampScale(
        Math.min(
          (rect.width - FIT_PADDING * 2) / contentWidth,
          (rect.height - FIT_PADDING * 2) / contentHeight,
          FIT_MAX_SCALE,
        ),
      );
      transform = {
        scale,
        x: (rect.width - contentWidth * scale) / 2,
        // Canh giữa cả hai chiều khi graph thấp hơn khung; graph cao thì ghim lên trên.
        y: Math.max(FIT_PADDING, (rect.height - contentHeight * scale) / 2),
      };
      commit();
    },
    destroy: () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
