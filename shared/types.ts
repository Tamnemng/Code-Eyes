// shared/types.ts
// SCHEMA KHOÁ CỨNG - không tự đổi. Ba tầng (analyzer / webview / filter) chỉ được
// import kiểu từ file này, không import lẫn nhau.

export type NodeKind =
  | "entry" | "exit"
  | "statement"        // đoạn code tuyến tính
  | "condition"        // if / ternary / switch discriminant
  | "loop"             // for / while / do-while / foreach
  | "switch-case"
  | "try" | "catch" | "finally"
  | "return" | "throw"
  | "break" | "continue"
  | "call";            // gọi hàm đáng chú ý

export interface FlowNode {
  id: string;                    // ổn định, deterministic (vd "n_12")
  kind: NodeKind;
  label: string;                 // text ngắn hiển thị trên node
  code: string;                  // source gốc của node
  range: { startLine: number; startCol: number; endLine: number; endCol: number };
  /** Với kind="condition": biểu thức điều kiện đã chuẩn hoá, dùng cho filter */
  condition?: {
    raw: string;
    /** Chỉ điền khi phân tích chắc chắn được. Nếu không, để undefined. */
    parsed?: { variable: string; operator: "==" | "!=" | "in" | "startsWith"; value: string | string[] };
    /**
     * Các phép so sánh parse được trong chuỗi `&&`.
     * Mỗi hạng tử false chứng minh cả biểu thức false; một hạng tử true chưa chứng minh biểu thức true.
     */
    parsedConjuncts?: Array<{
      variable: string;
      operator: "==" | "!=" | "in" | "startsWith";
      value: string | string[];
    }>;
  };
  confidence: "certain" | "unknown";
  parentId?: string;             // để collapse theo scope
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: "true" | "false" | "case" | "default" | "exception" | "loop-back" | null;
}

export interface FlowGraph {
  functionName: string;
  filePath: string;
  language: "typescript" | "csharp";
  nodes: FlowNode[];
  edges: FlowEdge[];
  warnings: string[];            // các construct không xử lý được
}

// ---------------------------------------------------------------------------
// Alias tiện dụng (không thay đổi schema, chỉ đặt tên cho kiểu đã có ở trên).
// ---------------------------------------------------------------------------

// LƯU Ý: giá trị label "loop-back" vẫn nằm trong schema nhưng analyzer TypeScript
// KHÔNG BAO GIỜ emit nó. Cạnh ngược là thuộc tính cấu trúc của graph, renderer suy
// ra bằng DFS. Xem analyzer/typescript/SEMANTICS.md §4 và §14.

export type EdgeLabel = NonNullable<FlowEdge["label"]>;
export type Confidence = FlowNode["confidence"];
export type ParsedCondition = NonNullable<NonNullable<FlowNode["condition"]>["parsed"]>;
export type SourceRange = FlowNode["range"];
