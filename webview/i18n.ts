import type { Locale } from "./settings";

export interface UiMessages {
  back: string;
  expandAll: string;
  collapseDefault: string;
  resetView: string;
  filterTitle: string;
  filterHeading: string;
  filterHelp: string;
  mockQueryLabel: string;
  mockQueryHelp: string;
  mockConditionAtLine: (line: number) => string;
  clear: string;
  applyFilter: string;
  settingsTitle: string;
  detailResize: string;
  nodeScale: string;
  fontSize: string;
  edgeWidth: string;
  palette: string;
  paletteDefault: string;
  paletteSoft: string;
  paletteContrast: string;
  language: string;
  vietnamese: string;
  english: string;
  resetSettings: string;
  graphError: string;
  filterEmpty: string;
  layoutFailed: (error: string) => string;
  stats: (nodes: number, edges: number, visible: number, total: number, large: boolean) => string;
  enableConstraint: (variable: string) => string;
  candidateConfidence: (certain: number, unknown: number) => string;
  filterPlaceholder: (count: number) => string;
  valueFor: (variable: string) => string;
  openSuggestions: (variable: string) => string;
  hiddenNodes: (hidden: number, total: number) => string;
  warningCount: (count: number) => string;
  largeGraphWarning: (
    sourceNodes: number,
    sourceThreshold: number,
    displayNodes: number,
    renderGuard: number,
  ) => string;
  trace: {
    open: string;
    title: string;
    help: string;
    inputLabel: string;
    start: string;
    stop: string;
    reset: string;
    backStep: string;
    invalidJson: string;
    awaiting: string;
    enterValue: (variable: string) => string;
    useValue: string;
    knownValues: string;
    continueInto: (callee: string) => string;
    returned: string;
    thrown: string;
    broken: string;
    loop: string;
    trail: string;
    mocked: string;
  };
  detail: {
    selectNode: string;
    missingNode: string;
    close: string;
    line: string;
    unparsed: string;
    noSource: string;
    openSource: (callee: string) => string;
    jumpToLine: (line: number) => string;
    borderSolid: string;
    borderInferred: string;
    borderDashed: string;
    gitLineSummary: (added: number, modified: number, deleted: number) => string;
    fanout: (copies: number) => string;
  };
}

const VI: UiMessages = {
  back: "Quay lại graph trước",
  expandAll: "Mở hết",
  collapseDefault: "Thu gọn mặc định",
  resetView: "Đặt lại khung nhìn",
  filterTitle: "Lọc graph theo ràng buộc biến",
  filterHeading: "Ràng buộc biến",
  filterHelp:
    "Chỉ liệt kê biến analyzer suy luận an toàn. Biến unknown vẫn có thể lọc một chiều.",
  mockQueryLabel: "Mock query",
  mockQueryHelp:
    "Ép kết quả true/false của kiểm tra phụ thuộc DB/runtime. Không gọi DB và không chạy source code.",
  mockConditionAtLine: (line) => `Mock kết quả điều kiện tại dòng ${line}`,
  clear: "Xoá",
  applyFilter: "Lọc",
  settingsTitle: "Tuỳ chỉnh hiển thị",
  detailResize: "Đổi chiều rộng chi tiết node",
  nodeScale: "Cỡ node",
  fontSize: "Cỡ chữ",
  edgeWidth: "Đường nối",
  palette: "Bảng màu",
  paletteDefault: "Mặc định",
  paletteSoft: "Dịu",
  paletteContrast: "Tương phản cao",
  language: "Ngôn ngữ",
  vietnamese: "Tiếng Việt",
  english: "English",
  resetSettings: "Về mặc định",
  graphError: "Không dựng được graph",
  filterEmpty: "Hàm này chưa có biến nào đủ an toàn để lọc.",
  layoutFailed: (error) => `Layout thất bại: ${error}`,
  stats: (nodes, edges, visible, total, large) =>
    `${nodes} node · ${edges} edge` +
    (visible === total ? "" : ` · hiện ${visible}/${total}`) +
    (large ? " · graph lớn, layout có thể chậm" : ""),
  enableConstraint: (variable) => `Bật ràng buộc ${variable}`,
  candidateConfidence: (certain, unknown) =>
    `${certain} điều kiện certain` +
    (unknown > 0 ? `, ${unknown} điều kiện suy luận một chiều` : ""),
  filterPlaceholder: (count) => (count > 0 ? `chọn hoặc nhập (${count} gợi ý)` : "giá trị"),
  valueFor: (variable) => `Giá trị của ${variable}`,
  openSuggestions: (variable) => `Mở gợi ý cho ${variable}`,
  hiddenNodes: (hidden, total) => `Đang ẩn ${hidden}/${total}`,
  warningCount: (count) => `${count} cảnh báo`,
  largeGraphWarning: (sourceNodes, sourceThreshold, displayNodes, renderGuard) =>
    `Graph lớn (${sourceNodes} node > ${sourceThreshold}, hoặc ` +
    `${displayNodes} node vẽ > ${renderGuard}) - đã thu từng khối if/loop để đọc theo tầng.`,
  trace: {
    open: "Debug data theo flow",
    title: "Debug giả lập theo dữ liệu",
    help:
      "Dán JSON body. Tool chỉ diễn giải phép gán/điều kiện an toàn, không chạy source và không gọi DB. Chỗ thiếu dữ liệu sẽ dừng để bạn mock.",
    inputLabel: "JSON body đầu vào",
    start: "Bắt đầu chạy",
    stop: "Xem graph đầy đủ",
    reset: "Chạy lại từ đầu",
    backStep: "Quay lại bước trước",
    invalidJson: "Body không phải JSON hợp lệ.",
    awaiting: "Cần bạn quyết định tại đây",
    enterValue: (variable) => `Nhập giá trị mock cho ${variable}`,
    useValue: "Dùng giá trị này",
    knownValues: "Dữ liệu tool đang biết",
    continueInto: (callee) => `Đi tiếp vào ${callee} →`,
    returned: "Kết thúc bằng return / hết hàm",
    thrown: "Kết thúc bằng throw (lỗi)",
    broken: "Dừng tại break",
    loop: "Đường này quay lại loop với cùng dữ liệu mock",
    trail: "Chuỗi function đã đi qua",
    mocked: "MOCK — không phải dữ liệu DB thật",
  },
  detail: {
    selectNode: "Chọn một node để xem code đầy đủ.",
    missingNode: "Node đã chọn không còn trong graph đang hiển thị.",
    close: "Đóng chi tiết node",
    line: "dòng",
    unparsed: "(không suy luận được)",
    noSource: "(không có source)",
    openSource: (callee) => `Mở source của ${callee}`,
    jumpToLine: (line) => `Nhảy tới dòng ${line}`,
    borderSolid: "Analyzer hiểu trọn node này.",
    borderInferred:
      "Suy luận MỘT CHIỀU: điều kiện phức hợp có một hạng tử đọc được. " +
      "Filter chỉ được cắt nhánh true khi hạng tử đó chắc chắn false (SEMANTICS §12).",
    borderDashed: "Analyzer KHÔNG đọc được điều kiện này. Cả hai nhánh phải giữ.",
    gitLineSummary: (added, modified, deleted) =>
      `Chưa commit: +${added} dòng thêm, ~${modified} dòng sửa, −${deleted} dòng xoá`,
    fanout: (copies) =>
      `Node này được vẽ thành ${copies} bản sao (một bản cho mỗi đường vào). ` +
      "Mỗi bản giữ CẢ các mũi tên ra, nên một return sớm vẫn 'thấy' đường chảy tiếp sau " +
      "khối try. Đó là over-approximation có chủ ý của analyzer (SEMANTICS §7), không phải " +
      "bug: thà báo thừa hơn báo thiếu. Trong FlowGraph nó vẫn là MỘT node.",
  },
};

const EN: UiMessages = {
  back: "Go back to the previous graph",
  expandAll: "Expand all",
  collapseDefault: "Collapse to default",
  resetView: "Reset view",
  filterTitle: "Filter graph by variable constraints",
  filterHeading: "Variable constraints",
  filterHelp:
    "Only variables the analyzer can safely infer are listed. Unknown conditions may still support one-way filtering.",
  mockQueryLabel: "Mock query",
  mockQueryHelp:
    "Force a DB/runtime-dependent check to true or false. This does not call the DB or execute source code.",
  mockConditionAtLine: (line) => `Mock condition result at line ${line}`,
  clear: "Clear",
  applyFilter: "Filter",
  settingsTitle: "Display settings",
  detailResize: "Resize node details",
  nodeScale: "Node size",
  fontSize: "Font size",
  edgeWidth: "Edge width",
  palette: "Color palette",
  paletteDefault: "Default",
  paletteSoft: "Soft",
  paletteContrast: "High contrast",
  language: "Language",
  vietnamese: "Tiếng Việt",
  english: "English",
  resetSettings: "Reset settings",
  graphError: "Could not render graph",
  filterEmpty: "This function has no variables that are safe enough to filter.",
  layoutFailed: (error) => `Layout failed: ${error}`,
  stats: (nodes, edges, visible, total, large) =>
    `${nodes} nodes · ${edges} edges` +
    (visible === total ? "" : ` · showing ${visible}/${total}`) +
    (large ? " · large graph, layout may be slow" : ""),
  enableConstraint: (variable) => `Enable constraint ${variable}`,
  candidateConfidence: (certain, unknown) =>
    `${certain} certain conditions` +
    (unknown > 0 ? `, ${unknown} one-way inferred conditions` : ""),
  filterPlaceholder: (count) => (count > 0 ? `select or enter (${count} suggestions)` : "value"),
  valueFor: (variable) => `Value for ${variable}`,
  openSuggestions: (variable) => `Open suggestions for ${variable}`,
  hiddenNodes: (hidden, total) => `Hiding ${hidden}/${total}`,
  warningCount: (count) => `${count} ${count === 1 ? "warning" : "warnings"}`,
  largeGraphWarning: (sourceNodes, sourceThreshold, displayNodes, renderGuard) =>
    `Large graph (${sourceNodes} nodes > ${sourceThreshold}, or ` +
    `${displayNodes} rendered nodes > ${renderGuard}) - if/loop blocks were collapsed for progressive reading.`,
  trace: {
    open: "Debug data through flow",
    title: "Guided data simulation",
    help:
      "Paste the JSON body. The tool only interprets safe assignments and conditions; it never executes source or calls the DB. Missing runtime data becomes a mock question.",
    inputLabel: "Input JSON body",
    start: "Start trace",
    stop: "Show full graph",
    reset: "Restart trace",
    backStep: "Go back one step",
    invalidJson: "The body is not valid JSON.",
    awaiting: "Your decision is needed here",
    enterValue: (variable) => `Enter a mock value for ${variable}`,
    useValue: "Use this value",
    knownValues: "Values currently known",
    continueInto: (callee) => `Continue into ${callee} →`,
    returned: "Finished by return / function exit",
    thrown: "Finished by throw (error)",
    broken: "Stopped at break",
    loop: "This path repeats the loop with the same mock data",
    trail: "Function chain visited",
    mocked: "MOCK — not a real DB value",
  },
  detail: {
    selectNode: "Select a node to view its full code.",
    missingNode: "The selected node is no longer present in the displayed graph.",
    close: "Close node details",
    line: "line",
    unparsed: "(could not infer)",
    noSource: "(no source)",
    openSource: (callee) => `Open source for ${callee}`,
    jumpToLine: (line) => `Jump to line ${line}`,
    borderSolid: "The analyzer fully understands this node.",
    borderInferred:
      "ONE-WAY inference: one term of this compound condition is readable. " +
      "The filter may only remove the true branch when that term is certainly false (SEMANTICS §12).",
    borderDashed: "The analyzer cannot understand this condition. Both branches must remain.",
    gitLineSummary: (added, modified, deleted) =>
      `Not committed: +${added} added, ~${modified} modified, −${deleted} deleted lines`,
    fanout: (copies) =>
      `This node is drawn as ${copies} copies (one per incoming path). ` +
      "Each copy keeps ALL outgoing edges, so an early return may still appear to continue after " +
      "the try block. This is an intentional analyzer over-approximation (SEMANTICS §7), not a bug: " +
      "false positives are safer than missing a live path. It remains ONE node in FlowGraph.",
  },
};

export function messagesFor(locale: Locale): UiMessages {
  return locale === "en" ? EN : VI;
}
