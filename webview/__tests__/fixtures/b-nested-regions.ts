// Fixture NGUỒN cho golden của webview.
//
// Mục tiêu: vùng try lồng, trong đó `finally` BÊN TRONG có `parentId` trỏ về vùng try
// BÊN NGOÀI (đã kiểm bằng probe: parentId của node đánh dấu = vùng nó NẰM TRONG).
// Collapse node `try` ngoài vì thế phải ẩn cả node `finally` trong VÀ mọi bản sao fanout
// của nó - đây là case "collapse một vùng chứa node đã fanout" phải có test.
//
// `finally` trong cũng có in-degree cao (2 return sớm + đường chảy bình thường + exception).

export function pipeline(input: string): string {
  try {
    try {
      if (input === "") {
        return "empty";
      }
      if (input === "x") {
        return "ex";
      }
      console.log(input);
    } finally {
      console.log("inner cleanup");
    }
    return "done";
  } catch (err) {
    return "failed";
  } finally {
    console.log("outer cleanup");
  }
}
