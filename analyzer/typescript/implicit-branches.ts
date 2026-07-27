import ts from "typescript";

import { isFunctionLike, lineOf } from "./util";

/** Tên construct dùng trong warning (SEMANTICS §11). */
export type ImplicitBranchKind =
  | "optional chaining (?.)"
  | "nullish coalescing (??)"
  | "logical short-circuit (&&/||)";

export interface ImplicitBranch {
  kind: ImplicitBranchKind;
  line: number;
}

const ORDER: readonly ImplicitBranchKind[] = [
  "optional chaining (?.)",
  "nullish coalescing (??)",
  "logical short-circuit (&&/||)",
];

/**
 * Tìm nhánh ngầm chưa mô hình hoá trong các node AST của MỘT node graph.
 * Trả về tối đa một mục cho mỗi loại construct (lần xuất hiện đầu tiên), theo thứ tự cố định
 * để warning deterministic. Không đi vào thân hàm lồng - thân đó không được inline nên
 * nhánh ngầm bên trong không thuộc node này.
 */
export function findImplicitBranches(
  nodes: readonly ts.Node[],
  sf: ts.SourceFile,
  options: { includeShortCircuit: boolean },
): ImplicitBranch[] {
  const firstLine = new Map<ImplicitBranchKind, number>();

  const record = (kind: ImplicitBranchKind, node: ts.Node): void => {
    if (kind === "logical short-circuit (&&/||)" && !options.includeShortCircuit) return;
    if (!firstLine.has(kind)) firstLine.set(kind, lineOf(node, sf));
  };

  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node)) return;

    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node) ||
        ts.isCallExpression(node)) &&
      node.questionDotToken !== undefined
    ) {
      record("optional chaining (?.)", node);
    }

    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionToken) record("nullish coalescing (??)", node);
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken
      ) {
        record("logical short-circuit (&&/||)", node);
      }
    }

    ts.forEachChild(node, visit);
  };

  for (const node of nodes) visit(node);

  const found: ImplicitBranch[] = [];
  for (const kind of ORDER) {
    const line = firstLine.get(kind);
    if (line !== undefined) found.push({ kind, line });
  }
  return found;
}

export function implicitBranchWarning(branch: ImplicitBranch): string {
  return `implicit branch not modeled: ${branch.kind} at line ${branch.line}`;
}
