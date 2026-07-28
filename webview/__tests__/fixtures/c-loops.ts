// Fixture NGUỒN cho golden của webview.
//
// Ba case biên back edge mà SEMANTICS §4 nêu, phải khoá bằng test vì webview cài lại DFS
// độc lập với helper của analyzer (TODO.md mục 5):
//
//  - `scan`    : NHIỀU cạnh ngược (1 đường chảy cuối thân + 2 `continue` nhắm header).
//  - `drain`   : do-while → ĐÚNG 1 cạnh ngược, dù header chu trình không phải node `loop`.
//  - `bailOut` : thân không bao giờ hoàn thành bình thường (`break outer` qua `finally`)
//                → 0 cạnh ngược. Không được crash, không được coi là bug.

export function scan(items: string[]): number {
  let total = 0;
  for (const item of items) {
    if (item === "skip") {
      continue;
    }
    if (item === "stop") {
      break;
    }
    if (item === "again") {
      continue;
    }
    total += item.length;
  }
  return total;
}

export function drain(n: number): number {
  let i = 0;
  do {
    i += 1;
  } while (i < n);
  return i;
}

export function bailOut(rows: string[]): string {
  outer: for (const row of rows) {
    try {
      console.log(row);
      break outer;
    } finally {
      console.log("once");
    }
  }
  return "done";
}
