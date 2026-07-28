# TODO / Giới hạn đã biết

Ghi lại các giới hạn được quyết định có chủ ý, để chúng không biến mất khi đổi giai đoạn.
Không phải bug — mỗi mục nói rõ **chỗ sửa đúng nằm ở tầng nào**.

---

## 1. `parentId` chỉ phủ try / catch / finally → collapse gần như vô dụng trên hàm lớn

`analyzer/typescript/builder.ts` gán `parentId` luôn bằng `scope.regionId`, và `regionId`
chỉ nhận đúng ba giá trị: `tryId` (builder.ts:864), `catchId` (builder.ts:876),
`finallyId` (builder.ts:899).

Hệ quả: node `loop` và node `condition` **không có node con nào**. Tính năng collapse của
Giai đoạn 2 vì thế chỉ tác dụng lên khối `try`/`catch`/`finally`; thân vòng lặp và nhánh
`if` không thu gọn được. Trên hàm legacy 2000 dòng — nơi độ sâu chủ yếu là loop lồng if —
collapse gần như không giúp gì.

Đây KHÔNG phải bug analyzer: SEMANTICS §7 mô tả đúng hành vi này.

**Collapse hữu dụng thật sự cần analyzer mở rộng `parentId`** cho thân loop và cho nhánh
`if`. Chỗ sửa đúng là **analyzer**, KHÔNG phải webview.

Đã cân nhắc và **bác bỏ**: cho webview tự suy ra vùng chứa từ hình dạng graph
(dominator / cấu trúc chu trình). Làm thế tạo ra một định nghĩa "scope" thứ hai sống trong
tầng render — tức là đẩy logic ngữ nghĩa vào đúng tầng mà ràng buộc 1 cấm — và nếu sau này
analyzer bổ sung `parentId` cho loop thì hai định nghĩa xung đột nhau.

Khi làm: sửa SEMANTICS + test analyzer TRƯỚC, rồi mới sửa `builder.ts`. Webview không cần
đổi gì ngoài việc collapse tự nhiên phủ thêm node — logic `collapse.ts` đã thuần theo
`parentId`.

### ĐO TRÊN CODE THẬT: `parentId` lưỡng cực, collapse KHÔNG dùng được

Nạp `swa-be/src/services` bằng `npm run import:local` (8357 hàm, 4334 hàm ≥ 20 node), rồi đo
5 hàm lớn nhất. `sau autoCollapse` = số node còn nhìn thấy với `initialCollapsedIds`:

| hàm | node | có `parentId` | root có con | sau autoCollapse | ELK | layout |
| --- | --- | --- | --- | --- | --- | --- |
| `ReceiveService.actionReceivedNew` | 1050 | 1045 | 2 | **5** | 212ms | 378×716 |
| `ProductionOrderService.confirm` | 744 | 739 | 2 | **5** | 46ms | 378×716 |
| `ShipService.syncASNSGB` | 714 | **0** | 0 | **714** | **6406ms** | **19936×33322** |
| `MasterTaskService.createByTransaction` | 642 | 635 | 2 | 7 | 32ms | 406×1026 |
| `PutAwayService.getLocationByStrategy` | 453 | 441 | 2 | 12 | 62ms | 698×1540 |

Hai chế độ thất bại, cùng một nguyên nhân:

1. **Cả thân hàm nằm trong MỘT khối try** (4/5 hàm trên). Thu gọn vùng đó ẩn 99.5% graph →
   người dùng mở hàm 1050 node và thấy **5 hộp**. Vô dụng.
2. **Không có try nào** (`syncASNSGB`). 0 node collapse được → `autoCollapse` QUYẾT ĐỊNH thu
   gọn nhưng KHÔNG CÓ GÌ để thu gọn → vẽ trọn 714 node, ELK 6.4 giây, layout gần 20k×33k px.
   `USER_THRESHOLD`/`RENDER_GUARD` vì thế không thật sự bảo vệ được gì: chúng đo đúng nhưng
   không có đòn bẩy nào để hành động.

Kết luận: **collapse như đặc tả Giai đoạn 2 không hoạt động trên codebase này.** Không phải
bug ở `collapse.ts` (logic đúng, có test); nó là hệ quả trực tiếp của việc `parentId` chỉ phủ
try/catch/finally. Không có mức trung gian nào giữa "cả hàm" và "không gì".

Chỗ sửa đúng vẫn là **analyzer**: gán `parentId` cho thân vòng lặp và nhánh `if`. Khi đó hàm
1050 node sẽ thu gọn được theo từng tầng loop/if thay vì nhảy từ 1050 xuống 5.

**KHÔNG** chữa bằng cách cho webview suy ra scope (dominator/chu trình) — xem lý do bác bỏ ở trên.

---

## 2. Trạng thái collapse không sống qua restart VS Code

Webview dùng `getState`/`setState` để giữ `collapsedIds` + zoom/pan + selection qua vòng
dispose/restore khi tab ẩn rồi hiện lại. Chủ ý **không** dùng `retainContextWhenHidden`:
giữ context cho graph 1000 node là trả RAM cho một tab người dùng không xem.

Giới hạn: chỉ sống **trong một session**. Panel sống lại sau khi restart VS Code cần
`WebviewPanelSerializer` — ngoài phạm vi Giai đoạn 2, chưa làm.

---

## 3. Fanout node `finally`: mọi con số đếm theo `sourceId`

Renderer nhân bản node `finally` theo từng cạnh vào (SEMANTICS §14.2). Bản sao là quyết
định **trình bày**, nên:

- Mọi con số hiển thị cho người dùng (badge collapse, "đang ẩn N/M", thống kê) đếm theo
  tập `sourceId` phân biệt → khớp 1:1 với `FlowGraph.nodes.length` và với con số Giai đoạn 3
  sẽ báo. Bản sao `finally (3/7)` không cộng vào bất kỳ tổng nào.
- `autoCollapse` có **hai** ngưỡng: `USER_THRESHOLD = 300` đếm `sourceId` (con số người dùng
  thấy), `RENDER_GUARD = 500` đếm node hiển thị thật sau fanout (bảo vệ hiệu năng render —
  300 `sourceId` với nhiều finally fanout mạnh có thể ra 500–600 node vẽ). Kích hoạt khi
  **một trong hai** vượt.

Bất biến khoá "fanout là thuần trình bày" (test trong `webview/__tests__`):

1. Chiếu mọi edge hiển thị về `(sourceId_from, sourceId_to)` rồi khử trùng lặp → **bằng
   đúng** tập edge gốc đã khử trùng lặp. Không cặp mới, không mất cặp.
   (Lưu ý: **số** edge tăng, và phải tăng — node `finally` 7 vào / 2 ra = 9 edge, sau fanout
   thành 7 bản × (1 vào + 2 ra) = 21 edge. Đó là bản chất của việc tách hub.)
2. Reachability từ `entry`, chiếu theo `sourceId`, không đổi.
3. Round-trip: gộp mọi bản sao theo `sourceId` → tái tạo đúng `FlowGraph` đầu vào.

Nếu một trong ba bất biến gãy thì fanout thật là **biến đổi ngữ nghĩa**, không phải trình
bày → DỪNG và báo, không nới assertion.

---

## 3b. Fanout có đáng không — GIAO THỨC ĐO, đăng ký TRƯỚC khi đo

Mặc định hiện tại: xem `FANOUT_ENABLED` trong `webview/model/finally-fanout.ts`.

§14.2 tự khai lý do của nó: *"một hàm có 6 điểm `return` trong `try` sẽ cho node `finally`
7 cạnh vào và **2 cạnh ra** — một hub bậc cao"*. Đo trên golden thật thì **tiền đề vế
out-degree sai**: hub không nằm ở node `finally` (out-degree 1) mà ở **node cuối thân**
`finally`, và out-degree ở đó là **2–3**, không phải 2 cố định.

| golden | vào marker | ra khỏi thân | cạnh quanh vùng, hiện tại | sau khi nhân bản cả vùng |
| --- | --- | --- | --- | --- |
| `a-finally-fanout-shipOrder` | 5 | 2 | 5 + 1 + 2 = **8** | 5 + 5 + 10 = **20** |
| `b-nested-regions-pipeline` (vùng trong) | 4 | 3 | 4 + 1 + 3 = **8** | 4 + 4 + 12 = **20** |

Fanout đổi cạnh **vào** dài lấy cạnh **ra** nhân ×k. Không cắt bớt cạnh ra được: muốn biết
bản sao nào đi đích nào phải suy lại `PendingExit`, mà đó là kiến thức của analyzer, không
có trong graph. Một điều khoản "PHẢI" dựa trên tiền đề sai thì thành **giả thuyết cần kiểm**,
không còn hiệu lực đương nhiên.

### Điều kiện đo (chốt TRƯỚC, không được đổi sau khi thấy kết quả)

- **Đối tượng**: hàm legacy THẬT, không phải fixture. Tối thiểu **3 hàm**, trong đó ít nhất
  một hàm có **≥ 2 vùng `finally`** và một vùng **nằm trong vòng lặp** (cạnh ra quay về
  `loop` là loại cạnh dài xấu nhất).
- **Metric**: lấy từ output ELK, KHÔNG phải mắt nhìn.
  - primary: **số cạnh cắt nhau**
  - secondary: **tổng chiều dài cạnh**
- **Luật quyết định**: fanout THẮNG khi giảm crossings **≥ 20%** mà tổng chiều dài tăng
  **≤ 10%**. Hoà, mập mờ, hoặc chỉ thắng một hàm → **mặc định TẮT**: tắt là hành vi đơn
  giản hơn và ít node hơn.
- **Ghi lại SỐ LIỆU THẬT vào đây**, không chỉ ghi kết luận. Sáu tháng nữa cần biết đã đo
  cái gì trên hàm nào.
- Sau khi có số liệu: được phép thêm **đúng một đoạn** vào `SEMANTICS.md` §14.2 ghi rõ tiền
  đề out-degree = 2 là sai (thật là 2–3) và kết luận đo được. Cấp phép riêng cho việc này,
  không đụng gì khác trong `analyzer/`.

### Số liệu đã có (chưa phải phép đo quyết định)

Phình node/edge khi `fanoutFinallyRegions` chạy trên golden — đo bằng chính hàm đó, không
phải ước lượng:

| golden | node | edge |
| --- | --- | --- |
| `a-finally-fanout-shipOrder` | 14 → 22 | 18 → 30 |
| `b-nested-regions-pipeline` | 16 → **32** | 21 → **43** |
| `c-loops-bailOut` | 9 → 11 | 11 → 14 |
| `e-all-kinds-everything` | 22 → 24 | 27 → 30 |

`pipeline` phình **2×** vì vùng lồng nhau tăng trưởng NHÂN: vùng `finally` trong nhân trước
(4 bản), 4 bản thân của nó đều trỏ vào marker ngoài → marker ngoài fanout theo in-degree MỚI
chứ không phải in-degree ban đầu. Đây là lý do `RENDER_GUARD` phải đếm node hiển thị.

### KẾT QUẢ ĐÚNG PROTOCOL — trên codebase legacy thật

Chạy `npm run measure:legacy -- <file.ts> ...` (script: `scripts/measure-legacy.ts`). Script
quét AST tìm mọi hàm có thân, chạy analyzer, giữ hàm có vùng `finally`, xếp theo độ xấu, rồi
chạy ELK hai lần mỗi hàm.

Đối tượng: `swa-be` (codebase legacy của người dùng, NestJS). 5 file có `finally`, tìm được
**17 hàm** có vùng finally, đo 6 hàm xấu nhất.

| hàm | node | vùng finally | trong loop | crossings | tổng chiều dài | theo luật |
| --- | --- | --- | --- | --- | --- | --- |
| `processLoop` | 31 → 63 | 1 | **CÓ** | 7 → **259** (+3600%) | 28882 → 230556 (+698.3%) | không |
| `BullQueueService.startQueueMonitoring` | 25 → 31 | 1 | **CÓ** | 0 → 3 | 11428 → 21999 (+92.5%) | không |
| `PreAllocateDetailService.preallocateRationing` | 261 → 288 | **2** | không | 95 → **152** (+60.0%) | 361655 → 403100 (+11.5%) | không |
| `(anonymous)` (local-queue) | 49 → 55 | 1 | không | 0 → 2 | 31325 → 43685 (+39.5%) | không |
| `LocalQueueService.pushNew` | 31 → 37 | 1 | không | 0 → 5 | 11503 → 14468 (+25.8%) | không |
| `PreAllocateDetailService.preAllocateBySo` | 405 → 417 | 1 | không | 120 → 111 (**−7.5%**) | 407919 → 416416 (+2.1%) | không |

**0/6 hàm thắng. `FANOUT_ENABLED = false`, và lần này là kết luận có căn cứ hai chiều.**

Protocol đòi gì / đã có gì: ≥ 3 hàm legacy thật → **6**. ≥ 1 hàm có ≥ 2 vùng finally →
`preallocateRationing` (2 vùng). ≥ 1 vùng finally **trong vòng lặp** → `processLoop`,
`startQueueMonitoring`. Đủ điều kiện.

Điểm quan trọng về phương pháp: ở đây baseline crossings **khác 0** (7 / 95 / 120), nên nhánh
THẮNG của luật là khả thi về số học — khác với phép đo thăm dò trên fixture bên dưới. Trường
hợp tốt nhất cho fanout là `preAllocateBySo`: giảm 7.5% crossings, còn xa ngưỡng 20%. Trường
hợp xấu nhất là `processLoop` (vùng finally TRONG vòng lặp — đúng case §14.2 lo nhất): tăng
crossings **37 lần**. Cạnh ra của vùng quay về node `loop`, nhân ×5 bản sao, mỗi bản đặt ở một
layer khác nhau.

Kết luận: giả thuyết §14.2 **bị bác** trên phân phối thật. Không phải "chưa đủ dữ liệu".

Ghi chú phụ thu được: analyzer xử lý hàm 405 node của codebase thật không crash.

### Phép đo thăm dò trên fixture (giữ lại để đối chiếu) — KHÔNG thoả protocol

Chạy `npm run measure:fanout` (script: `scripts/measure-fanout.ts`). ELK thật, hai lần mỗi
graph, metric từ `webview/layout/metrics.ts`.

| graph | node | crossings | tổng chiều dài | theo luật |
| --- | --- | --- | --- | --- |
| `a-finally-fanout-shipOrder` | 14 → 22 | 0 → 4 | 3761 → 6495 (+72.7%) | không |
| `b-nested-regions-pipeline` | 16 → 32 | 0 → 10 | 3679 → 11575 (+214.6%) | không |
| `c-loops-bailOut` | 9 → 11 | 0 → 1 | 1687 → 2070 (+22.7%) | không |
| `e-all-kinds-everything` | 22 → 24 | 0 → 1 | 6074 → 8433 (+38.8%) | không |
| `f-worst-case-processBatch` | 27 → 55 | 0 → 59 | 12022 → 58416 (+385.9%) | không |

**Quyết định: `FANOUT_ENABLED = false`.** 0/5 graph thắng; secondary metric xấu đi mạnh ở
mọi graph.

Hai giới hạn của bảng fixture này, vì sao nó KHÔNG dùng để quyết định:

1. Repo này **không có một câu `try`/`finally` nào** ngoài fixture — grep `finally` trên toàn
   bộ source không phải test (`builder.ts`, `condition.ts`, `util.ts`, `implicit-branches.ts`)
   chỉ khớp trong comment và string literal. `f-worst-case-processBatch` là fixture **tự dựng**
   để lấy chặn trên, không phải phân phối thật.
2. Baseline crossings = **0** trên cả 5 graph (ELK đã cho layout không cắt nhau ở cỡ 9–27
   node), nên "giảm 20%" bất khả thi về số học → kết luận chỉ rơi vào nhánh fallback của luật.

Cả hai giới hạn đã được phép đo trên `swa-be` ở trên khắc phục. Giữ bảng fixture lại để đối
chiếu và để test hồi quy nhanh (`npm run measure:fanout` không cần codebase ngoài).

**Điều ĐÃ biết chắc, độc lập với ELK** (đo trực tiếp trên golden): tiền đề out-degree = 2 của
§14.2 sai — hub nằm ở node CUỐI THÂN finally, out-degree 2–3, và vùng lồng nhau làm fanout
tăng trưởng NHÂN.

### Có nên xoá hẳn code fanout?

Chưa. Giả thuyết đã bị bác trên `swa-be`, nhưng `fanoutFinallyRegions` + `measure-legacy.ts`
là cặp công cụ để bác nó lại lần nữa trên codebase khác (phân phối khác có thể cho kết quả
khác, dù hướng hiện tại rất rõ). Chi phí giữ: một hằng `FANOUT_ENABLED` và một nhánh `if` ở
điểm ghép pipeline — mọi module hạ nguồn là hàm thuần trên `DisplayGraph` nên không có chế độ
nào bị nhân đôi. Nếu sau 2-3 codebase nữa vẫn 0 thắng thì xoá cả hàm lẫn cờ.

---

## 3c. Vùng `finally` mặc định collapse — làm bất kể kết quả đo

Không phải đối thủ của 3b. 3b hỏi "khi người dùng MỞ vùng đó ra thì vẽ kiểu gì"; mục này là
mặc định UI: trên hàm legacy 1000 node, vùng `finally` không phải thứ người ta mở đầu tiên.
Rẻ, dùng lại đúng cơ chế collapse đã có.

Lưu ý bản chất: collapse KHÔNG xoá hub, nó gộp hub vào node marker (cạnh ra của thân được
nâng lên marker). Lợi ích ở đây là giảm số node, không phải tách hub.

---

## 4. Bản sao `finally` có 2 cạnh ra — trông như bug, không phải bug

Fanout nhân bản theo cạnh **vào**, nhưng mỗi bản sao vẫn giữ **cả** cạnh ra. Nó vì thế bảo
toàn đúng cái over-approximation mà SEMANTICS §7 mô tả: một `return` sớm trong `try` vẫn
"thấy" đường chảy tiếp sau khối try. Không sửa được ở tầng render, và cũng không nên —
analyzer cố ý báo thừa hơn báo thiếu.

Người dùng nhìn `finally (3/7)` có hai mũi tên ra sẽ tưởng là bug. Panel chi tiết của node
fanout PHẢI có một dòng giải thích, dẫn về SEMANTICS §7.

---

## 5. Back edge phải suy lại trong webview, không dùng chung code với test analyzer

Analyzer không bao giờ emit nhãn `loop-back` (SEMANTICS §4, khoá bởi test
`00-invariants.test.ts:112`). Back edge là nghĩa vụ của renderer (§14.1): DFS từ `entry`,
cạnh trỏ về node đang trên stack.

`analyzer/typescript/__tests__/helpers/graph.ts` đã có một bản DFS như vậy, nhưng webview
**không được** import nó — ràng buộc 1. `webview/model/back-edges.ts` là bản cài đặt thứ
hai, độc lập, của cùng thuật toán. Trùng lặp có chủ ý.

Ba case biên §4 nêu, phải có test khoá: loop nhiều cạnh ngược (`continue` nhắm header),
`do-while` (đúng 1 cạnh ngược bất kể số `continue`), loop acyclic
(`for { try { break outer } finally {} }` → 0 cạnh ngược, không được crash).

---

## 6. `graphKey` chưa phân biệt hai phiên bản source của cùng một hàm

`webview/state.ts` hiện tạo key bằng `<filePath>#<functionName>`. Khi người dùng sửa nội
dung nhưng vẫn ở cùng hàm, key không đổi. Analyzer cấp id tuần tự (`n_1`, `n_2`, ...), nên
`n_7` của graph mới có thể là một node khác hoàn toàn so với `n_7` của graph cũ.

`pruneCollapsedIds` chỉ bỏ id không còn tồn tại; nó không phát hiện trường hợp id vẫn tồn
tại nhưng đã đổi nghĩa. Hệ quả: collapse/selection phục hồi từ `getState` có thể áp vào node
khác sau khi source đổi.

Extension host dùng riêng `{ document.uri, document.version }` để từ chối `revealNode` trên
range cũ; việc đó bảo vệ editor nhưng không giải quyết state bên trong webview.

Chỗ sửa đúng: thêm fingerprint ổn định của graph/source vào `graphKey` ở tầng webview state,
không đổi `FlowGraph` schema chỉ để lưu trạng thái trình bày.

---

## 7. ELK vẫn block main thread trên graph lớn

`elkjs/lib/elk.bundled.js` đang chạy layout trên main thread của webview. `view.ts` hoãn một
`requestAnimationFrame` để trạng thái busy kịp hiện, nhưng sau đó UI vẫn đóng băng trong lúc
ELK tính. Số đã đo: khoảng 0.65 giây ở 642 node đến 5.9–6.4 giây ở graph 714–1050 node.

Cache và ba đường vẽ đã loại việc chạy lại ELK khi chỉ chọn node/đổi palette/đổi độ dày cạnh;
phần block còn lại xảy ra khi graph, collapse, node scale hoặc font size làm layout đổi.

Chỗ sửa đúng: chạy ELK trong Web Worker. Khi làm trong VS Code webview, extension host phải
cấp URI worker nằm trong `localResourceRoots` và CSP phải cho phép đúng worker đó; không nới
ra script/worker ngoài.
