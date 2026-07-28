// Fixture NGUỒN cho golden của webview - WORST CASE có chủ ý cho phép đo fanout.
//
// KHÔNG phải code legacy thật. Nó tồn tại để cho CHẶN TRÊN: nếu fanout không thắng cả ở
// đây thì gần như chắc nó không thắng ở đâu. Kết quả đo trên file này KHÔNG thoả protocol
// TODO.md 3b (protocol đòi hàm legacy thật) - xem ghi chú giới hạn ở đó.
//
// Hình dạng nhắm tới:
//  - 2 vùng `finally`, một vùng NẰM TRONG vòng lặp -> cạnh ra của nó quay về node `loop`,
//    loại cạnh dài xấu nhất;
//  - nhiều đường thoát khác nhau khỏi thân try (continue / break / throw / return / chảy
//    bình thường) -> in-degree của marker cao;
//  - vùng ngoài có cả `catch` lẫn `finally` và thân try hoàn thành bình thường được ->
//    node cuối thân finally có nhiều cạnh ra.

export function processBatch(rows: string[], mode: string): number {
  let done = 0;
  try {
    for (const row of rows) {
      try {
        if (row === "") {
          continue;
        }
        if (row === "stop") {
          break;
        }
        if (row === "bad") {
          throw new Error("bad row");
        }
        if (row === "skip") {
          return done;
        }
        done += 1;
      } finally {
        console.log("row done");
      }
    }
    if (mode === "strict") {
      return done;
    }
    if (mode === "loose") {
      return -1;
    }
    done += 100;
  } catch (err) {
    return -2;
  } finally {
    console.log("batch done");
  }
  return done;
}
