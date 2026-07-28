# Hợp đồng ngữ nghĩa - Analyzer TypeScript (Giai đoạn 1)

Test được viết TRƯỚC code. File này ghi lại mọi quyết định ngữ nghĩa mà các test đang
khoá lại, để implementation không phải đoán. Nếu muốn đổi ngữ nghĩa → sửa file này +
sửa test TRƯỚC, rồi mới sửa code.

## 0. Quy ước chung

- **Toạ độ**: `line` 1-based, `column` 0-based. Áp dụng cho `AnalyzeRequest` và `FlowNode.range`.
- **Id node**: `n_<số>`, cấp phát tăng dần, deterministic. Phân tích cùng một file 2 lần
  phải cho graph deep-equal (có test `00-invariants`).
- **`entry` / `exit`**: đúng 1 node mỗi loại cho mỗi graph.
  - `entry.label` = `entry: <functionName>`, `entry.code` = dòng chữ ký hàm.
  - `exit.label` = `exit`, `exit.code` = `""`.
  - `entry` không có edge vào; `exit` không có edge ra.
- **Không có node "merge"** trong schema → các nhánh hội tụ trực tiếp vào node kế tiếp.
- **Không im lặng bỏ nhánh**: construct không xử lý được → đẩy mô tả vào `graph.warnings`,
  giữ node lại, không throw.
- **Nhãn edge**: chỉ 4 nhãn được emit từ node rẽ nhánh (`true` / `false` / `case` / `default`),
  cộng `exception` cho luồng ngoại lệ. Mọi edge khác có `label` = `null`.
  Nhãn **`loop-back` KHÔNG BAO GIỜ được emit** (xem §4 và §14) - dù schema vẫn khai báo nó.

## 1. Statement tuyến tính

Các statement liên tiếp **không rẽ nhánh** được gộp vào MỘT node `statement`.

- `code` = toàn bộ source của cụm đã gộp.
- `label` = text ngắn của statement đầu tiên (rút gọn nếu dài).
- Statement bị **tách khỏi cụm** nếu nó chứa: điều kiện ba ngôi, vòng lặp, switch,
  try, return/throw/break/continue, hoặc thân hàm lồng (arrow / function expression).
- `await` KHÔNG tách cụm (xem §10).
- Kết thúc thân hàm mà không return → edge ngầm tới `exit` (label `null`).
- Thân hàm rỗng → chỉ có `entry` → `exit`.

## 2. if / else / else-if

- `if` → node `condition`, edge `true` vào nhánh then, edge `false` vào nhánh else.
- Không có `else` → edge `false` đi thẳng tới node kế tiếp sau `if` (hoặc `exit`).
- `else if` là `if` lồng trong AST → KHÔNG tạo node riêng cho khối `else`;
  edge `false` của điều kiện ngoài trỏ thẳng vào node `condition` bên trong.

## 3. Toán tử ba ngôi

Ba ngôi tạo nhánh thật, không gộp vào statement:

- Node `condition` cho phần test.
- MỘT node `statement` cho mỗi nhánh (`code` = source của biểu thức nhánh đó).
- Hai nhánh hội tụ vào node kế tiếp.
- Ba ngôi lồng nhau → mỗi tầng một node `condition`.

## 4. Vòng lặp

Mọi loại vòng lặp (`for`, `for-of`, `for-in`, `for await-of`, `while`) → MỘT node `loop`
mang toàn bộ header (kể cả phần init của `for`).

- `loop` --`true`--> node đầu của thân.
- Node cuối của thân --`null`--> `loop`.
- `loop` --`false`--> node sau vòng lặp.

`do-while` chạy thân trước:

- edge `null` từ node trước vào node đầu của thân,
- node cuối của thân --`null`--> node `loop` (node này giữ điều kiện `while (...)`),
- `loop` --`true`--> node đầu của thân,
- `loop` --`false`--> node sau vòng lặp.

Vòng lặp vô hạn tường minh (`while (true)`, `for (;;)`): **không** emit edge `false`.
Đường ra duy nhất là `break` / `return` / `throw` bên trong thân. Đây là kết luận chắc
chắn, không phải bỏ sót nhánh.

Trường hợp biên: `while (true)` **không có** `break`/`return`/`throw` nào (vòng lặp vô hạn
thật). Khi đó `exit` không có edge vào, và bất biến "mọi node đều đến được từ entry" trong
`00-invariants` sẽ gãy ở node `exit`. Đó là **kết quả đúng, không phải bug** - hàm thật sự
không bao giờ kết thúc bình thường. Nếu sau này có fixture như vậy thì khai báo miễn trừ
trong catalog, đừng sửa analyzer.

### Nhãn edge và back edge

Edge xuất phát từ node `condition` / `loop` LUÔN mang nhãn `true` / `false` / `case` /
`default`, kể cả khi đích là đầu vòng lặp. Lý do: Giai đoạn 3 cần nhãn `true`/`false` để
lan truyền ràng buộc biến; mất nhãn đó là mất thông tin filter.

Hệ quả: **back edge không được lưu trong graph**. Với `do-while`, cạnh ngược chính là
edge `true` của điều kiện ở cuối; với `for`, `while` là edge `null` từ node cuối thân.
Không có một nhãn nào đánh dấu được cả hai trường hợp mà không giẫm lên `true`/`false`.

Back edge là **thuộc tính cấu trúc của graph**, không phải metadata: renderer suy ra bằng
DFS (cạnh trỏ về node đang nằm trên stack DFS). CFG sinh từ code TypeScript có cấu trúc
luôn là reducible nên tập back edge không phụ thuộc thứ tự duyệt. ELK layered dù sao cũng
tự phát hiện chu trình để phá vòng khi layout.

Bất biến được kiểm trong `00-invariants` (chạy trên mọi fixture):

- mỗi node `loop` nằm trên ít nhất một chu trình → cạnh ngược của nó luôn suy ra được;
- mọi back edge đều có ít nhất một node `loop` trên chu trình của nó → không có chu trình mồ côi;
- số back edge ≥ số node `loop`.

Lưu ý: một vòng lặp có thể có NHIỀU cạnh ngược - đúng bằng số đường quay về **header của
chu trình**, tức là 1 (đường chảy tự nhiên ở cuối thân) + số `continue` nhắm tới header đó.
Vì vậy bất biến chung không thể chốt "đúng một cạnh"; test của từng fixture chốt con số
chính xác bằng `expectBackEdgeCount`.

`do-while` là ngoại lệ của phép đếm trên, vì header chu trình KHÔNG phải node `loop`:

- node `loop` của `do-while` là điều kiện, nằm ở **cuối** thân;
- header chu trình là node **đầu thân**, và đường duy nhất vào nó từ trong chu trình là
  edge `true` của node `loop` → **đúng 1 cạnh ngược**, bất kể có bao nhiêu `continue`;
- `continue` nhắm tới node `loop`, mà node đó nằm *bên trong* chu trình chứ không phải ở
  đầu, nên edge `continue → loop` không phải cạnh ngược (theo cả định nghĩa DFS lẫn định
  nghĩa "đích thống trị nguồn").

Trường hợp biên thứ hai: thân vòng lặp **không bao giờ hoàn thành bình thường** (mọi đường
đều `break`/`return`/`throw`, ví dụ `for (...) { try { break outer } finally {...} }`). Khi
đó vòng lặp không có cạnh ngược nào và bất biến "mỗi loop nằm trên một chu trình" gãy - đây
là **kết quả đúng**: thân chạy tối đa một lần. Case như vậy khai báo `allowAcyclicLoop: true`
trong catalog, không sửa analyzer.

## 5. break / continue

- `break` → node `break`, edge `null` tới node **sau vòng lặp/switch gần nhất**.
- `continue` → node `continue`, edge `null` về node `loop` gần nhất.
  Kể cả `do-while`: `continue` trong `do-while` nhảy tới **bước kiểm điều kiện**, mà node
  `loop` của `do-while` chính là điều kiện ở cuối - nên vẫn là "về node `loop`", không phải
  về đầu thân. (Bản trước của file này ghi "về node đầu thân" - sai ngữ nghĩa JS, đã sửa.
  Chưa có fixture nào phủ `continue` trong `do-while`.)
- Có label (`break outer;`) → nhắm tới vòng lặp mang label đó, không phải vòng lặp gần nhất.
- `break` bên trong `switch` nằm trong vòng lặp → thoát **switch**, không thoát vòng lặp.
- `break`/`continue` thoát khỏi một khối `try` có `finally` → phải đi qua node `finally`
  trước (giống `return`, xem §7).
- Sau `break`/`continue`/`return`/`throw`, các statement còn lại trong cùng block là
  unreachable: node vẫn được tạo nhưng KHÔNG có edge vào, kèm warning `unreachable`.

## 6. switch

- Discriminant → node `condition`, `label` = `code` = `switch (<discriminant>)`,
  `condition.raw` = source của discriminant, `condition.parsed` = `undefined`
  (bản thân discriminant không phải phép so sánh).
  `confidence` = `certain` nếu discriminant là identifier / property access đơn giản.
- Mỗi `case` / `default` → một node `switch-case`. `label` = `code` = phần header của clause
  (`case "A":` / `default:`), KHÔNG bao gồm thân clause; thân là các node riêng.
  - edge từ discriminant tới case: label `case`; tới `default`: label `default`.
  - Node `switch-case` MANG `condition` (mở rộng hợp lệ, field optional):
    `raw` = `case "A"`, `parsed` = `{ variable: <discriminant>, operator: "==", value: "A" }`
    khi case là string literal; `default` → `raw = "default"`, `parsed = undefined`.
- **Không có clause `default`**: discriminant vẫn phải có một edge nhãn `default` đi thẳng
  tới node sau switch (trường hợp không case nào khớp). Thiếu edge này là bỏ sót nhánh.
- **Fallthrough**: case không có `break` → edge `null` từ node cuối của case đó sang node
  `switch-case` kế tiếp. Case rỗng (`case "high":` liền `case "urgent":`) → edge thẳng từ
  `switch-case` này sang `switch-case` kế.
- Case cuối không `break` → edge tới node sau switch.

**Ràng buộc cho Giai đoạn 3 (filter)**: fallthrough nghĩa là khi ràng buộc chọn `case "A"`,
filter phải giữ lại **thân của các case phía sau mà "A" rơi vào**, dù `condition.parsed`
của các case đó nói giá trị khác. Prune theo node `switch-case` là sai; phải prune theo
khả năng đạt tới (reachability) từ case đã chọn. Fixture `resolveClient` khoá hành vi này.

## 7. try / catch / finally

Node đánh dấu vùng: `try`, `catch`, `finally`. Statement bên trong là node riêng
(`parentId` trỏ về node đánh dấu tương ứng).

- `label`/`code`: `try` → label `try`, code = source toàn bộ statement `try`.
  `catch` → label `catch (<param>)`, code = source của clause catch.
  `finally` → label `finally`, code = source của clause finally.
- `try` --`null`--> node đầu thân try.
- **Đúng một** edge `exception` từ node `try` tới `catch` (hoặc tới `finally` nếu không có
  `catch`, hoặc tới `exit` nếu không có cả hai), biểu diễn "bất kỳ statement nào trong try
  đều có thể ném".
- Mỗi node `throw` tường minh trong thân try → thêm edge `exception` tới `catch`
  (hoặc `finally` nếu không có catch).
- **finally chạy trên MỌI đường thoát**: node cuối thân try, mọi node `return`/`break`/
  `continue` trong try, node cuối thân catch, và `throw` trong catch → đều có edge tới node
  `finally`. KHÔNG có edge trực tiếp từ `return` trong try/catch tới `exit`.
- Không có `finally` → các đường trên nối thẳng tới đích kế tiếp (`exit` với `return`).
- `finally` --`null`--> node đầu thân finally; node cuối thân finally → node sau khối try
  (và/hoặc `exit` nếu có đường return/throw dẫn vào).
- **`return` bên trong thân `finally`** ghi đè hoàn thành đang treo (return/exception của
  try). Analyzer vẫn dựng edge bình thường, nhưng phải đẩy warning
  `return inside finally overrides pending completion at line <n>` - đây là nguồn bug kinh điển.
- **try lồng try**: `throw` trong catch bên trong được bắt bởi `catch` bên NGOÀI (không phải
  chính nó). `return` trong try bên trong, khi try bên trong không có `finally`, đi tới
  `finally` gần nhất bao ngoài nó.

### Đường thoát bị finally chặn phải giữ ĐÍCH THẬT

Đi qua `finally` không được làm mất đích của đường nhảy. Analyzer ghi lại đích đó
(`PendingExit` trong `builder.ts`) rồi nối lại từ các đầu hở của khối finally:

| Đường nhảy | Sau khi finally chạy xong, đi tiếp tới |
|---|---|
| `return` | `finally` bao ngoài kế tiếp, hết thì `exit` |
| `break [label]` | `finally` bao ngoài kế tiếp, hết thì node sau vòng lặp/switch đích |
| `continue [label]` | `finally` bao ngoài kế tiếp, hết thì node `loop` đích |
| exception | handler bao ngoài (`catch`/`finally` ngoài hơn), hết thì `exit`, nhãn `exception` |

Việc này **đệ quy theo tầng**: `return` bên trong hai tầng `finally` lồng nhau đi
`return → finally trong → finally ngoài → exit`. Không có cơ chế này thì đường nhảy bị nhập
vào luồng hoàn thành bình thường của khối try và đích thật biến mất - `break outer` trong
`try/finally` sẽ không bao giờ tới được code sau vòng lặp.

Edge nối lại theo cách này chỉ tạo khi chưa có edge nào cùng cặp `(from, to)`, vì đích của
đường thoát thường trùng với đích của luồng bình thường.

### Khối try không hoàn thành bình thường

Nếu MỌI đường ra khỏi thân try và thân catch đều là `return`/`throw`/`break`/`continue` thì
bản thân câu `try` không hoàn thành bình thường: các đầu hở của khối `finally` chỉ nối tới
đích của các đường thoát treo, KHÔNG nối tới statement sau khối try. Hệ quả: code sau một
khối try luôn ném đúng là code chết (0 edge vào + warning `unreachable code`), thay vì bị
báo là đến được.

Đi kèm: node trong vùng code chết **không phát edge đi ra** - `return` trong code chết không
được tạo đường tới `exit`, nếu không `exit` sẽ có thêm một edge vào không tồn tại trong
thực thi thật.

**Xấp xỉ đã biết**: node `finally` không bị nhân bản theo từng đường vào, nên node cuối của
finally có thể có nhiều edge ra (tới `exit`, tới node sau try, về `loop`...). Tổ hợp
(đường vào × đường ra) vì thế bị over-approximate: một `return` sớm sẽ "thấy" cả đường chảy
tiếp sau khối try. Đây là over-approximation có chủ ý - thà báo thừa còn hơn báo thiếu -
và analyzer giữ một nguồn sự thật duy nhất. **Cái giá phải trả và cách xử lý: xem §14.**

## 8. return / throw

- `return` → node `return`, edge tới `exit` (label `null`), trừ khi nằm trong try/catch có
  `finally` (khi đó đi qua `finally`, xem §7).
- Nhiều `return` → nhiều edge vào `exit`.
- `throw` → node `throw`, edge label `exception`:
  - tới `catch`/`finally` nếu nằm trong try,
  - tới `exit` nếu thoát khỏi hàm.

## 9. Hàm lồng / arrow function

**KHÔNG inline** thân hàm lồng. Mỗi thân hàm lồng (arrow function, function expression,
function declaration lồng) → MỘT node `kind: "call"`:

- `label` = tên hàm, hoặc `(anonymous)`.
- Node `call` nằm tuần tự trong luồng, tại vị trí statement chứa nó.
- Nếu statement chỉ là phần khai báo (`const f = (x) => {...};`) → chỉ tạo node `call`,
  không tạo thêm node `statement`.
- Nếu statement còn nội dung khác (`items.forEach((x) => {...});`) → node `statement`
  cho statement, rồi node `call` cho thân callback, nối tuần tự.
- Mỗi node `call` kèm một warning `not inlined`.
- Hệ quả bắt buộc: `if` / `for` / `return` bên trong thân hàm lồng KHÔNG sinh node nào.
- Lời gọi hàm thường (`foo()`, `double(item)`) KHÔNG tạo node `call` ở Giai đoạn 1;
  chúng nằm trong node `statement` bình thường.

## 10. async / await

`await` là statement thường, không tạo nhánh. Hàm `async` cho graph giống hệt hàm đồng bộ
tương ứng. `for await (... of ...)` xử lý như `for-of`.

## 11. Nhánh ngầm chưa mô hình hoá (CHỈ trong statement)

`?.`, `??`, `&&`, `||` tạo nhánh ngầm. Giai đoạn 1 không mô hình hoá chúng **khi chúng nằm
trong statement thường** (`const x = a?.b ?? c;`):

- Node chứa chúng nhận `confidence: "unknown"`.
- Warning theo cặp (node, loại construct) - một node chứa cả `&&` và `||` chỉ sinh MỘT
  warning cho nhóm short-circuit:
  - `optional chaining (?.)`
  - `nullish coalescing (??)`
  - `logical short-circuit (&&/||)`
- Format warning: `implicit branch not modeled: <construct> at line <n>`.

**Ngoại lệ quan trọng - biểu thức điều kiện**: `&&` / `||` nằm trong phần test của
`if` / `while` / `do-while` / ba ngôi **không phải nhánh ngầm**. Đó là điều kiện phức hợp
và được xử lý ở tầng parse (§12): không warning, không tự động hạ `confidence` theo §11.

Lý do: `if (a && b)` là cấu trúc cực kỳ phổ biến. Nếu mọi điều kiện có `&&` đều bị đánh
dấu là nhánh ngầm thì phần lớn node điều kiện của codebase thật sẽ vô dụng với filter, và
tính năng chính của tool chết ngay tại đó.

`?.` và `??` trong biểu thức điều kiện vẫn sinh warning (chúng bỏ qua side effect thật),
nhưng `confidence` của node `condition` luôn do §12 quyết định.

## 12. condition.parsed và confidence - HAI TRỤC ĐỘC LẬP

`parsed` trả lời "filter suy luận được gì"; `confidence` trả lời "analyzer hiểu node này
đến đâu". Một node **được phép** vừa có `parsed` vừa `confidence: "unknown"`: đó là
**kết luận một chiều**.

### Dạng parse được (literal là string literal, ở vế nào cũng được)

| Nguồn | parsed |
| --- | --- |
| `x === "A"` / `x == "A"` / `"A" === x` | `{ variable: "x", operator: "==", value: "A" }` |
| `x !== "A"` / `x != "A"` | `{ variable: "x", operator: "!=", value: "A" }` |
| `x.startsWith("A")` | `{ variable: "x", operator: "startsWith", value: "A" }` |
| `["A","B"].includes(x)` | `{ variable: "x", operator: "in", value: ["A","B"] }` |
| `case "A":` | `{ variable: <discriminant>, operator: "==", value: "A" }` |

`variable` là source text của vế biến (cho phép property access: `req.clientCode`).
Nếu vế biến chứa `?.` thì coi như không parse được.

### Bảng quyết định

| Biểu thức điều kiện | parsed | confidence |
| --- | --- | --- |
| Khớp đúng một dạng ở trên, không còn gì khác (`x === "A"`) | có | `certain` |
| Chuỗi `&&` có ít nhất một hạng tử parse được (`x === "A" && f(y)`) | có, lấy **hạng tử parse được ĐẦU TIÊN** từ trái sang | `unknown` |
| Chuỗi `\|\|` (`x === "A" \|\| y`) | `undefined` | `unknown` |
| Không parse được (`count > 10`, `flag === true`, `tags.length === count`, `f(x)`, `!flag`) | `undefined` | `unknown` |

### Hạn chế đã biết của quy tắc "hạng tử đầu tiên từ trái"

Schema chỉ chứa được MỘT `parsed`, nên chuỗi `&&` nhiều hạng tử parse được chỉ giữ lại
hạng tử đầu tiên (`x === "A" && x.startsWith("A")` → chỉ giữ `x === "A"`).

Điểm mù cụ thể: `if (mode === "fast" && clientCode === "A")` sẽ điền `parsed` theo `mode`.
Khi filter chạy với ràng buộc `clientCode = "B"`, nhánh này **đáng lẽ prune được**
(`clientCode === "A"` chắc chắn false → cả biểu thức false) nhưng filter không thấy, vì ô
`parsed` duy nhất đang bị `mode` chiếm. Kết quả: bỏ lỡ cơ hội prune - **an toàn** (giữ thừa,
không cắt nhầm), nhưng làm giảm tỉ lệ prune.

Giai đoạn 1 giữ nguyên, không sửa. **Nếu Giai đoạn 3 chạy trên codebase thật mà tỉ lệ prune
thấp hơn kỳ vọng, đây là chỗ đầu tiên cần quay lại**: mở rộng `parsed` thành mảng conjunct
(`parsed: ParsedCondition[]`, ngữ nghĩa "tất cả phải đúng"), khi đó filter prune được nhánh
`true` nếu BẤT KỲ conjunct nào cho false. Đổi schema thì cả ba tầng phải đổi theo, nên chỉ
làm khi có số liệu chứng minh.

### Hợp đồng với Giai đoạn 3 (filter) - BẤT ĐỐI XỨNG, phải tôn trọng

| Node | Filter được phép làm gì |
| --- | --- |
| `confidence: "certain"` + có `parsed` | Kết luận hai chiều. parsed cho `false` → prune nhánh `true`; parsed cho `true` → prune nhánh `false`. |
| `confidence: "unknown"` + có `parsed` | **Chỉ một chiều**: parsed cho `false` → toàn bộ biểu thức chắc chắn `false` → prune nhánh `true`. parsed cho `true` → **KHÔNG prune gì** (các hạng tử `&&` còn lại vẫn có thể sai). |
| `confidence: "unknown"` + không `parsed` | Không prune. Giữ cả hai nhánh. |

Tại sao `\|\|` không được điền `parsed`: với `\|\|`, kết luận chắc chắn chạy theo chiều
ngược lại (một hạng tử `true` → cả biểu thức `true`). Schema không có chỗ ghi chiều của
kết luận, mà quy tắc filter ở trên đã cố định là "false ⇒ prune true". Điền `parsed` cho
`\|\|` sẽ khiến filter cắt nhầm nhánh còn sống. Thà không suy luận còn hơn suy luận sai.

## 13. Hàm được chọn: dạng khai báo và vị trí con trỏ

Analyzer chọn **function-like node trong cùng (innermost)** bao quanh con trỏ. Nếu con trỏ
nằm trong thân một hàm lồng thì phân tích chính hàm lồng đó, KHÔNG phải hàm ngoài
(hàm ngoài chỉ thấy nó như một node `call`, xem §9).

Nếu con trỏ không nằm trong hàm nào → throw `NO_FUNCTION_AT_CURSOR` (đây là lỗi đầu vào,
khác với construct không xử lý được).

`FlowGraph.functionName` theo dạng khai báo:

| Dạng | functionName |
| --- | --- |
| `function foo()` | `foo` |
| Method của class: `class Svc { route() {} }` | `Svc.route` |
| Constructor | `Svc.constructor` |
| Getter / setter | `Svc.get label` / `Svc.set label` |
| Method trong object literal: `const handlers = { onSubmit() {} }` | `handlers.onSubmit` |
| Arrow/function expression gán cho biến: `const f = () => {}` | `f` |
| Function expression CÓ tên riêng: `const f = function tally() {}` | `tally` (tên riêng thắng tên biến) |
| Hàm ẩn danh (callback) | `(anonymous)` |

Quy tắc đặt tên này dùng chung cho `functionName` và cho `label` của node `call` (§9), nên
`const format = function tally() {}` cho node `call` nhãn `tally`.

## 14. Ràng buộc bắt buộc cho Giai đoạn 2 (renderer)

Hai xấp xỉ ở tầng analyzer được cố tình đẩy sang tầng hiển thị. Renderer PHẢI xử lý:

1. **Back edge suy ra bằng DFS** (§4). Graph không đánh dấu cạnh ngược. Renderer chạy DFS
   từ node `entry`, cạnh trỏ về node đang trên stack là back edge, và vẽ nó theo kiểu
   cạnh quay lui (không để ELK xếp nó thành một layer xuôi).

2. **Nhân bản node `finally` ở mức hiển thị** (§7). Analyzer giữ MỘT node `finally` để có
   một nguồn sự thật cho filter và cho id ổn định. Nhưng một hàm có 6 điểm `return` trong
   `try` sẽ cho node `finally` 7 cạnh vào và 2 cạnh ra - một hub bậc cao. Trên graph 1000
   node, ELK sẽ kéo các cạnh này xuyên qua nửa layout và tạo ra đúng cái tổ nhện mà tool
   này sinh ra để tránh.

   Renderer nhân bản: mỗi cạnh vào được một bản sao nhỏ của node `finally`, nhãn dạng
   `finally (1/7)`, đặt cạnh node nguồn. Đây thuần tuý là quyết định trình bày - KHÔNG
   đụng vào schema, không đụng vào filter, không đổi id trong `FlowGraph`.

   > **BỔ SUNG (Giai đoạn 2, sau khi đo): điều khoản trên đã bị BÁC.** Giữ nguyên văn bản gốc
   > ở trên để thấy lập luận ban đầu, nhưng đừng thi hành nó.
   >
   > 1. **Tiền đề "2 cạnh ra" sai.** Node `finally` có out-degree **1**; hub out-degree nằm ở
   >    node **cuối thân** `finally`, và số thật là **2-3** (đo trên graph do chính analyzer
   >    này sinh). Hệ quả: nhân bản riêng node marker như câu trên viết thì hub chỉ **tụt xuống
   >    một node**, không giải quyết gì - phải nhân bản **cả vùng** (marker + mọi node có
   >    `parentId` truy về nó) mới có tác dụng.
   > 2. **Vùng lồng nhau làm fanout tăng trưởng NHÂN**, vì marker ngoài nhân theo in-degree
   >    SAU khi vùng trong đã nhân.
   > 3. **Đo trên codebase legacy thật thì fanout LÀM XẤU HƠN**, không tốt hơn. Giao thức đo
   >    (đăng ký trước khi đo) và số liệu đầy đủ: `TODO.md` mục 3b. Tóm tắt: 6 hàm thật,
   >    0/6 thắng; trường hợp tốt nhất chỉ giảm 7.5% cạnh cắt nhau (ngưỡng là 20%); trường hợp
   >    xấu nhất - vùng `finally` **trong vòng lặp**, đúng case điều khoản này lo nhất - tăng
   >    cạnh cắt nhau **37 lần** và tổng chiều dài cạnh **+698%**.
   >
   > Renderer hiện tại vì thế **KHÔNG** fanout (`FANOUT_ENABLED = false` trong
   > `webview/model/finally-fanout.ts`). Hàm nhân bản vẫn được cài và test đầy đủ để đo lại
   > được trên codebase khác. Thay vào đó vùng `finally` **mặc định collapse** - rẻ hơn, dùng
   > lại cơ chế collapse, và giảm số node thật sự.
   >
   > Không sửa gì khác trong `analyzer/`; đoạn này thêm theo cấp phép riêng vì §14 là hợp đồng
   > ràng buộc Giai đoạn 2 và để nguyên một điều khoản đã bị bác sẽ khiến người sau thi hành lại.

3. **Ba mức hiển thị độ chắc chắn, không phải hai** (§12). Sau khi tách `parsed` khỏi
   `confidence`, `confidence: "unknown"` KHÔNG còn đồng nghĩa với "analyzer mù". Nếu vẽ
   nét đứt cho mọi node `unknown` thì phần lớn điều kiện thật (`a === "A" && b`) sẽ trông
   như không đọc được, đúng cái mà việc tách hai trục sinh ra để tránh. Renderer phân biệt:

   | Node | Hiển thị |
   | --- | --- |
   | `certain` (+ `parsed`) | nét liền |
   | `unknown` + có `parsed` | nét liền, thêm dấu hiệu "suy luận một chiều" (vd viền mảnh / icon nhỏ) |
   | `unknown` + không `parsed` | nét đứt - analyzer thật sự không đọc được |
