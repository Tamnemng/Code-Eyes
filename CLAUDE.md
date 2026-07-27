RÀNG BUỘC CỐ ĐỊNH (không được vi phạm)
Kiến trúc 3 tầng tách rời, giao tiếp CHỈ qua JSON schema bên dưới.
analyzer/ — source code → FlowGraph JSON. Không biết gì về VS Code hay UI.
webview/ — FlowGraph JSON → render. Không biết gì về AST hay compiler.
filter/ — FlowGraph JSON + constraints → FlowGraph JSON con. Hàm thuần, không side effect.
Không tầng nào import trực tiếp từ tầng khác. Chỉ import kiểu (types) từ shared/types.ts.
Graph phải do parser dựng, tuyệt đối không do LLM suy đoán. Mọi node/edge phải truy vết được về một AST node cụ thể.
Layout graph phải là layered/hierarchical. Dùng elkjs với elk.layered, hướng DOWN. KHÔNG dùng force-directed (D3 force), không dùng physics simulation.
Mỗi construct điều khiển phải có test riêng trước khi viết code xử lý nó. Test dạng snapshot: file input nhỏ → assert số node, số edge, và các edge quan trọng.
Khi analyzer không chắc chắn, đánh dấu confidence: "unknown" và GIỮ LẠI node. Không bao giờ im lặng bỏ nhánh. Báo sai nguy hiểm hơn báo thừa.
TypeScript strict mode. Không any trừ khi có comment giải thích.

JSON SCHEMA (khoá cứng, không tự đổi)
ts
// shared/types.ts
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