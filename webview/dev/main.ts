/// <reference types="vite/client" />
// webview/dev/main.ts
// Dev harness: nạp golden JSON trong browser thường, dùng ĐÚNG `createView` mà webview thật
// dùng. Mục đích là thấy graph và sửa layout mà không phải khởi động lại Extension
// Development Host mỗi lần.
//
// Chạy: `npm run dev`
//
// Đây KHÔNG phải tầng thứ tư: nó chỉ là một bên gọi khác của `createView`, và nó nhận đúng
// một `FlowGraph` JSON như webview thật nhận qua `postMessage`.

// CSS phải import như MODULE, không phải `<link href="../styles.css">` trong index.html:
// root của vite là `webview/dev`, nên href đó giải ra URL `/../styles.css` - ngoài root, dev
// server trả 404. `vite build` thì rollup vẫn resolve được, nên bug CHỈ hiện ở `npm run dev`:
// không có CSS -> `fill="var(--cf-fill-*)"` không định nghĩa -> node đen, chữ đen.
import "../styles.css";

import type { FlowGraph } from "../../shared/types";
import { createView } from "../view";
import { initialState, restoreState, serializeState, type ViewState } from "../state";

// Vite biến pattern này thành map { đường dẫn -> loader }.
//  - `golden/` : fixture đã commit, nhỏ, dùng để kiểm hành vi.
//  - `local/`  : code THẬT do `npm run import:local` nạp vào. Đã .gitignore.
const fixtures = import.meta.glob<{ default: unknown }>("../__tests__/golden/*.json");
const locals = import.meta.glob<{ default: unknown }>("./local/*.json");
const goldens = { ...fixtures, ...locals };

const select = document.querySelector<HTMLSelectElement>("#golden");
const reload = document.querySelector<HTMLButtonElement>("#reload");
const host = document.querySelector<HTMLElement>("#view");
if (select === null || reload === null || host === null) throw new Error("thiếu phần tử harness");
// Gán lại sau khi đã kiểm null: TS không mang narrowing vào thân hàm (closure có thể chạy sau).
const picker = select;

// `local` lên trước và xếp theo ĐỘ LỚN giảm dần (tiền tố tên file là số node có pad 0) -
// hàm to là lý do tool này tồn tại, đừng bắt người dùng cuộn tìm.
const localNames = Object.keys(locals).sort().reverse();
const fixtureNames = Object.keys(fixtures).sort();
const names = [...localNames, ...fixtureNames];

function addGroup(label: string, paths: readonly string[], strip: string): void {
  if (paths.length === 0) return;
  const group = document.createElement("optgroup");
  group.label = label;
  for (const item of paths) {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item.replace(strip, "").replace(".json", "");
    group.append(option);
  }
  picker.append(group);
}

addGroup(`local — code của bạn (${localNames.length})`, localNames, "./local/");
addGroup(`fixture (${fixtureNames.length})`, fixtureNames, "../__tests__/golden/");
if (localNames.length === 0) {
  const hint = document.createElement("span");
  hint.className = "cf-dev-note";
  hint.textContent = "chưa có local — chạy: npm run import:local -- <đường-dẫn>";
  picker.after(hint);
}

// Giả lập getState/setState của VS Code bằng sessionStorage: harness phải đi qua đúng đường
// phục hồi trạng thái mà webview thật đi, không thì bug phục hồi chỉ lộ ra trong extension.
const STORAGE_KEY = "codeflow.dev.state";
function loadState(): ViewState {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw === null) return initialState();
  try {
    return restoreState(JSON.parse(raw));
  } catch {
    return initialState();
  }
}

const view = createView(host, {
  restored: loadState(),
  onReveal: (sourceId) => {
    // Không có editor trong harness - in ra để kiểm chứng đúng sourceId được gửi đi.
    console.log("revealNode", sourceId);
  },
  onStateChange: (state) => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state)));
  },
});

async function show(path: string): Promise<void> {
  const loader = goldens[path];
  if (loader === undefined) return;
  const module = await loader();
  // Golden do `npm run golden` sinh từ analyzer thật; harness tin nó, khác với dữ liệu
  // `getState` (do bản webview trước ghi, phải validate).
  view.setGraph(module.default as FlowGraph);
}

select.addEventListener("change", () => void show(select.value));
reload.addEventListener("click", () => void show(select.value));

const first = names[0];
if (first !== undefined) void show(first);
