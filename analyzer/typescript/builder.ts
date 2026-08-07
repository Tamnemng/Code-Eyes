import ts from "typescript";

import type {
  Confidence,
  EdgeLabel,
  FlowEdge,
  FlowGraph,
  FlowNode,
  NodeKind,
  SourceRange,
} from "../../shared/types";
import {
  analyzeCaseClause,
  analyzeCondition,
  analyzeDiscriminant,
  defaultClauseCondition,
} from "./condition";
import { findImplicitBranches, implicitBranchWarning } from "./implicit-branches";
import {
  collectNestedFunctions,
  findFirstTernary,
  functionNameOf,
  isAlwaysTrueLoop,
  isLoopStatement,
  isMergeableStatement,
  isPureFunctionDefinition,
  lineOf,
  rangeBetween,
  rangeOf,
  shortLabel,
  signatureLine,
  signatureRange,
  trimmedSlice,
  type FunctionLike,
} from "./util";

/** Một đầu hở đang chờ nối vào node kế tiếp. */
interface OpenEnd {
  readonly from: string;
  readonly label?: EdgeLabel;
}

interface BreakTarget {
  /** Các đầu hở của break, sẽ thành edge tới node sau vòng lặp/switch. */
  readonly collect: OpenEnd[];
  /** Số finally đang bao quanh lúc đăng ký target - dùng để biết có phải chạy finally trước khi nhảy. */
  readonly finallyDepth: number;
}

interface ContinueTarget {
  readonly nodeId: string;
  readonly finallyDepth: number;
}

interface LabelTarget {
  readonly breakTarget: BreakTarget;
  readonly continueTarget?: ContinueTarget;
}

/**
 * Một đường thoát bị khối finally chặn lại. Sau khi finally chạy xong, luồng phải
 * đi tiếp tới ĐÍCH THẬT của nó chứ không nhập vào luồng hoàn thành bình thường
 * (SEMANTICS §7). Không có cái này thì `break outer` bên trong try/finally sẽ mất
 * đích, và code sau một khối try luôn ném sẽ bị coi là đến được.
 */
type PendingExit =
  | { readonly kind: "exit" }
  | { readonly kind: "exception"; readonly to: string }
  | { readonly kind: "break"; readonly target: BreakTarget }
  | { readonly kind: "continue"; readonly target: ContinueTarget };

interface FinallyFrame {
  readonly nodeId: string;
  /** Các đường thoát đang chờ nối tiếp sau khi khối finally này chạy xong. */
  readonly pending: PendingExit[];
}

/** Ngữ cảnh "nếu ném từ đây thì rơi vào một finally, và sau finally đó đi đâu". */
interface ExceptionPending {
  readonly frame: FinallyFrame;
  /** Handler bao ngoài - nơi exception tiếp tục sau khi finally chạy xong. */
  readonly to: string;
}

interface Scope {
  readonly breakTarget?: BreakTarget;
  readonly continueTarget?: ContinueTarget;
  readonly labels: ReadonlyMap<string, LabelTarget>;
  /** Các khối finally đang bao quanh, trong cùng ở cuối. */
  readonly finallyStack: readonly FinallyFrame[];
  /** Node nhận edge "exception" khi có throw. */
  readonly exceptionTarget: string;
  /** Chỉ có giá trị khi `exceptionTarget` là một node finally. */
  readonly exceptionPending?: ExceptionPending;
  /** parentId cho node con - vùng trình bày gần nhất (if/loop/try/catch/finally). */
  readonly regionId?: string;
  readonly insideFinally: boolean;
  /**
   * Đang dựng code không đến được (§5). Node vẫn được giữ, nhưng KHÔNG được phát
   * edge đi ra - nếu không, `return` trong code chết sẽ tạo đường tới exit.
   */
  readonly unreachable: boolean;
}

/** Kết quả dựng một đoạn: node đầu tiên (null nếu đoạn không tạo node) và các đầu hở. */
interface Segment {
  readonly entry: string | null;
  readonly open: OpenEnd[];
}

type Group =
  | { readonly kind: "merged"; readonly statements: readonly ts.Statement[] }
  | { readonly kind: "single"; readonly statement: ts.Statement };

interface NodeInit {
  kind: NodeKind;
  label: string;
  code: string;
  range: SourceRange;
  condition?: FlowNode["condition"];
  confidence?: Confidence;
  parentId?: string;
}

function withLabels(
  base: ReadonlyMap<string, LabelTarget>,
  names: readonly string[],
  breakTarget: BreakTarget,
  continueTarget: ContinueTarget | undefined,
): ReadonlyMap<string, LabelTarget> {
  if (names.length === 0) return base;
  const map = new Map(base);
  for (const name of names) {
    map.set(name, continueTarget === undefined ? { breakTarget } : { breakTarget, continueTarget });
  }
  return map;
}

/**
 * Số finally mà đường thoát này được phép "đứng trên" mà không phải chạy.
 * `return` và exception thoát khỏi cả hàm nên phải chạy MỌI finally đang bao quanh.
 * `break`/`continue` chỉ phải chạy các finally nằm giữa nó và vòng lặp/switch đích.
 */
function barrierDepth(pending: PendingExit): number {
  switch (pending.kind) {
    case "exit":
      return 0;
    case "break":
    case "continue":
      return pending.target.finallyDepth;
    case "exception":
      // `to` đã là handler bao ngoài (tính lúc dựng try), không bị chặn thêm lần nữa.
      return Number.POSITIVE_INFINITY;
  }
}

function samePending(a: PendingExit, b: PendingExit): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "exception" && b.kind === "exception") return a.to === b.to;
  if (a.kind === "break" && b.kind === "break") return a.target === b.target;
  if (a.kind === "continue" && b.kind === "continue") return a.target === b.target;
  return true;
}

/**
 * Scope con của một vùng try/catch/finally. Phải gán tường minh `exceptionPending`
 * (kể cả khi là undefined) để không vô tình kế thừa ngữ cảnh ném của vùng bao ngoài.
 */
function nestedScope(
  base: Scope,
  fields: {
    exceptionTarget: string;
    exceptionPending: ExceptionPending | undefined;
    regionId: string;
    finallyStack: readonly FinallyFrame[];
    insideFinally?: boolean;
  },
): Scope {
  const scope: Scope = {
    ...base,
    exceptionTarget: fields.exceptionTarget,
    regionId: fields.regionId,
    finallyStack: fields.finallyStack,
    insideFinally: fields.insideFinally ?? base.insideFinally,
  };
  if (fields.exceptionPending === undefined) {
    delete (scope as { exceptionPending?: ExceptionPending }).exceptionPending;
    return scope;
  }
  return { ...scope, exceptionPending: fields.exceptionPending };
}

function addPending(list: PendingExit[], pending: PendingExit): void {
  if (list.some((existing) => samePending(existing, pending))) return;
  list.push(pending);
}

/**
 * Đường thoát thường (return/break/continue) nối trước, exception nối sau: khi hai
 * đường trùng đích thì edge giữ lại là edge không nhãn, đúng như luồng thật.
 */
function orderedPendings(list: readonly PendingExit[]): PendingExit[] {
  return [...list.filter((p) => p.kind !== "exception"), ...list.filter((p) => p.kind === "exception")];
}

export function buildFlowGraph(
  fn: FunctionLike,
  sf: ts.SourceFile,
  filePath: string,
): FlowGraph {
  return new GraphBuilder(sf, filePath).build(fn);
}

class GraphBuilder {
  private readonly nodes: FlowNode[] = [];
  private readonly edges: FlowEdge[] = [];
  private readonly warnings: string[] = [];
  private counter = 0;
  private exitId = "";

  constructor(
    private readonly sf: ts.SourceFile,
    private readonly filePath: string,
  ) {}

  build(fn: FunctionLike): FlowGraph {
    const functionName = functionNameOf(fn, this.sf);

    const entryId = this.addNode({
      kind: "entry",
      label: `entry: ${functionName}`,
      code: signatureLine(fn, this.sf),
      range: signatureRange(fn, this.sf),
    });
    this.exitId = this.addNode({
      kind: "exit",
      label: "exit",
      code: "",
      range: rangeBetween(fn.getEnd(), fn.getEnd(), this.sf),
    });

    const scope: Scope = {
      labels: new Map(),
      finallyStack: [],
      exceptionTarget: this.exitId,
      insideFinally: false,
      unreachable: false,
    };

    const body = fn.body;
    if (body === undefined) {
      this.edge(entryId, this.exitId);
    } else if (ts.isBlock(body)) {
      const segment = this.buildStatements(body.statements, [{ from: entryId }], scope);
      this.connect(segment.open, this.exitId);
    } else {
      // Arrow function thân biểu thức: một node statement rồi ra exit.
      const code = body.getText(this.sf);
      const id = this.addNode({
        kind: "statement",
        label: shortLabel(code),
        code,
        range: rangeOf(body, this.sf),
      });
      this.edge(entryId, id);
      this.edge(id, this.exitId);
    }

    return {
      functionName,
      filePath: this.filePath,
      language: "typescript",
      nodes: this.nodes,
      edges: this.edges,
      warnings: this.warnings,
    };
  }

  // -------------------------------------------------------------------------
  // Hạ tầng
  // -------------------------------------------------------------------------

  private addNode(init: NodeInit): string {
    this.counter += 1;
    const id = `n_${this.counter}`;
    const node: FlowNode = {
      id,
      kind: init.kind,
      label: init.label,
      code: init.code,
      range: init.range,
      confidence: init.confidence ?? "certain",
    };
    if (init.condition !== undefined) node.condition = init.condition;
    if (init.parentId !== undefined) node.parentId = init.parentId;
    this.nodes.push(node);
    return id;
  }

  private edge(from: string, to: string, label?: EdgeLabel): void {
    // Edge y hệt (cùng from/to/label) là trùng lặp theo bất biến của schema. Nó xảy ra khi
    // một đường thoát treo ở finally và đường hoàn thành bình thường về cùng một đích.
    if (this.edges.some((e) => e.from === from && e.to === to && (e.label ?? null) === (label ?? null))) {
      return;
    }
    this.edges.push(label === undefined ? { from, to } : { from, to, label });
  }

  /**
   * Edge chỉ tạo khi chưa có edge nào cùng cặp (from, to) - kể cả khác nhãn.
   * Dùng khi nối lại các đường thoát treo ở finally: đích của chúng thường trùng
   * với đường hoàn thành bình thường, và graph không được có edge song song.
   */
  private edgeOnce(from: string, to: string, label?: EdgeLabel): void {
    if (this.edges.some((e) => e.from === from && e.to === to)) return;
    this.edge(from, to, label);
  }

  private connect(open: readonly OpenEnd[], to: string): void {
    for (const end of open) this.edge(end.from, to, end.label);
  }

  private warn(message: string): void {
    this.warnings.push(message);
  }

  // -------------------------------------------------------------------------
  // Danh sách statement + gộp cụm tuyến tính (SEMANTICS §1)
  // -------------------------------------------------------------------------

  private groupStatements(statements: readonly ts.Statement[]): Group[] {
    const groups: Group[] = [];
    let run: ts.Statement[] = [];
    const flush = (): void => {
      if (run.length > 0) {
        groups.push({ kind: "merged", statements: run });
        run = [];
      }
    };
    for (const statement of statements) {
      if (isMergeableStatement(statement)) {
        run.push(statement);
        continue;
      }
      flush();
      groups.push({ kind: "single", statement });
    }
    flush();
    return groups;
  }

  private buildStatements(
    statements: readonly ts.Statement[],
    incoming: OpenEnd[],
    scope: Scope,
  ): Segment {
    let entry: string | null = null;
    let open = incoming;
    let warnedUnreachable = false;

    for (const group of this.groupStatements(statements)) {
      if (entry !== null && open.length === 0) {
        // SEMANTICS §5: giữ node, không có edge vào, cảnh báo một lần cho cả vùng.
        if (!warnedUnreachable) {
          this.warn(`unreachable code at line ${this.groupLine(group)}`);
          warnedUnreachable = true;
        }
        this.buildGroup(group, [], { ...scope, unreachable: true });
        continue;
      }
      const segment = this.buildGroup(group, open, scope);
      if (entry === null) entry = segment.entry;
      open = segment.open;
    }

    return { entry, open };
  }

  private groupLine(group: Group): number {
    const node = group.kind === "merged" ? group.statements[0] : group.statement;
    return node === undefined ? 1 : lineOf(node, this.sf);
  }

  private buildGroup(group: Group, incoming: OpenEnd[], scope: Scope): Segment {
    if (group.kind === "merged") return this.buildMerged(group.statements, incoming, scope);
    return this.buildSingle(group.statement, incoming, scope);
  }

  private buildMerged(
    statements: readonly ts.Statement[],
    incoming: OpenEnd[],
    scope: Scope,
  ): Segment {
    const first = statements[0];
    const last = statements[statements.length - 1];
    if (first === undefined || last === undefined) return { entry: null, open: incoming };

    const start = first.getStart(this.sf);
    const end = last.getEnd();
    const code = this.sf.text.slice(start, end);
    const id = this.statementLikeNode(
      "statement",
      code,
      rangeBetween(start, end, this.sf),
      statements,
      scope,
    );
    this.connect(incoming, id);
    return { entry: id, open: [{ from: id }] };
  }

  /** Node mang code thật (statement/return/throw): quét nhánh ngầm + hạ confidence. */
  private statementLikeNode(
    kind: NodeKind,
    code: string,
    range: SourceRange,
    astNodes: readonly ts.Node[],
    scope: Scope,
  ): string {
    const implicit = findImplicitBranches(astNodes, this.sf, { includeShortCircuit: true });
    const id = this.addNode({
      kind,
      label: shortLabel(code),
      code,
      range,
      confidence: implicit.length > 0 ? "unknown" : "certain",
      parentId: scope.regionId,
    });
    for (const branch of implicit) this.warn(implicitBranchWarning(branch));
    return id;
  }

  // -------------------------------------------------------------------------
  // Điều phối theo loại statement
  // -------------------------------------------------------------------------

  private buildSingle(stmt: ts.Statement, incoming: OpenEnd[], scope: Scope): Segment {
    if (ts.isIfStatement(stmt)) return this.buildIf(stmt, incoming, scope);
    if (ts.isDoStatement(stmt)) return this.buildDoWhile(stmt, incoming, scope, []);
    if (isLoopStatement(stmt)) {
      return this.buildLoop(stmt as ts.IterationStatement, incoming, scope, []);
    }
    if (ts.isSwitchStatement(stmt)) return this.buildSwitch(stmt, incoming, scope);
    if (ts.isTryStatement(stmt)) return this.buildTry(stmt, incoming, scope);
    if (ts.isReturnStatement(stmt)) return this.buildReturn(stmt, incoming, scope);
    if (ts.isThrowStatement(stmt)) return this.buildThrow(stmt, incoming, scope);
    if (ts.isBreakStatement(stmt)) return this.buildBreak(stmt, incoming, scope);
    if (ts.isContinueStatement(stmt)) return this.buildContinue(stmt, incoming, scope);
    if (ts.isLabeledStatement(stmt)) return this.buildLabeled(stmt, incoming, scope);
    if (ts.isBlock(stmt)) return this.buildStatements(stmt.statements, incoming, scope);
    if (ts.isFunctionDeclaration(stmt)) {
      const id = this.callNode(stmt, scope);
      this.connect(incoming, id);
      return { entry: id, open: [{ from: id }] };
    }
    return this.buildExpressionish(stmt, incoming, scope);
  }

  /** Thân của if/loop: Block thì mở ra, statement đơn thì bọc lại cho dùng chung logic gộp cụm. */
  private buildBody(stmt: ts.Statement, incoming: OpenEnd[], scope: Scope): Segment {
    if (ts.isBlock(stmt)) return this.buildStatements(stmt.statements, incoming, scope);
    return this.buildStatements([stmt], incoming, scope);
  }

  // -------------------------------------------------------------------------
  // §2 if / else
  // -------------------------------------------------------------------------

  private buildIf(stmt: ts.IfStatement, incoming: OpenEnd[], scope: Scope): Segment {
    const id = this.conditionNode(stmt.expression, scope);
    this.connect(incoming, id);

    const branchScope: Scope = { ...scope, regionId: id };
    const thenSegment = this.buildBody(
      stmt.thenStatement,
      [{ from: id, label: "true" }],
      branchScope,
    );
    const elseIncoming: OpenEnd[] = [{ from: id, label: "false" }];
    const elseOpen =
      stmt.elseStatement === undefined
        ? elseIncoming
        : this.buildBody(stmt.elseStatement, elseIncoming, branchScope).open;

    return { entry: id, open: [...thenSegment.open, ...elseOpen] };
  }

  private conditionNode(expr: ts.Expression, scope: Scope): string {
    const info = analyzeCondition(expr, this.sf);
    const code = expr.getText(this.sf);
    const id = this.addNode({
      kind: "condition",
      label: shortLabel(code),
      code,
      range: rangeOf(expr, this.sf),
      condition: info.condition,
      confidence: info.confidence,
      parentId: scope.regionId,
    });
    // §11: &&/|| trong biểu thức điều kiện KHÔNG phải nhánh ngầm; ?. và ?? thì vẫn cảnh báo.
    for (const branch of findImplicitBranches([expr], this.sf, { includeShortCircuit: false })) {
      this.warn(implicitBranchWarning(branch));
    }
    return id;
  }

  // -------------------------------------------------------------------------
  // §3 ba ngôi
  // -------------------------------------------------------------------------

  private lowerTernary(
    expr: ts.ConditionalExpression,
    incoming: OpenEnd[],
    scope: Scope,
  ): Segment {
    const id = this.conditionNode(expr.condition, scope);
    this.connect(incoming, id);
    const whenTrue = this.ternaryBranch(expr.whenTrue, [{ from: id, label: "true" }], scope);
    const whenFalse = this.ternaryBranch(expr.whenFalse, [{ from: id, label: "false" }], scope);
    return { entry: id, open: [...whenTrue, ...whenFalse] };
  }

  private ternaryBranch(expr: ts.Expression, incoming: OpenEnd[], scope: Scope): OpenEnd[] {
    if (ts.isConditionalExpression(expr)) {
      return this.lowerTernary(expr, incoming, scope).open;
    }
    const code = expr.getText(this.sf);
    const id = this.addNode({
      kind: "statement",
      label: shortLabel(code),
      code,
      range: rangeOf(expr, this.sf),
      parentId: scope.regionId,
    });
    this.connect(incoming, id);
    return [{ from: id }];
  }

  // -------------------------------------------------------------------------
  // §4 vòng lặp
  // -------------------------------------------------------------------------

  private buildLoop(
    stmt: ts.IterationStatement,
    incoming: OpenEnd[],
    scope: Scope,
    labels: readonly string[],
  ): Segment {
    const header = trimmedSlice(this.sf, stmt.getStart(this.sf), stmt.statement.getStart(this.sf));
    const id = this.addNode({
      kind: "loop",
      label: shortLabel(header.text),
      code: header.text,
      range: header.range,
      parentId: scope.regionId,
    });
    this.connect(incoming, id);

    const collect: OpenEnd[] = [];
    const depth = scope.finallyStack.length;
    const breakTarget: BreakTarget = { collect, finallyDepth: depth };
    const continueTarget: ContinueTarget = { nodeId: id, finallyDepth: depth };
    const inner: Scope = {
      ...scope,
      regionId: id,
      breakTarget,
      continueTarget,
      labels: withLabels(scope.labels, labels, breakTarget, continueTarget),
    };

    const body = this.buildBody(stmt.statement, [{ from: id, label: "true" }], inner);
    this.connect(body.open, id);

    const open: OpenEnd[] = [...collect];
    if (!isAlwaysTrueLoop(stmt)) open.push({ from: id, label: "false" });
    return { entry: id, open };
  }

  private buildDoWhile(
    stmt: ts.DoStatement,
    incoming: OpenEnd[],
    scope: Scope,
    labels: readonly string[],
  ): Segment {
    // Điều kiện nằm SAU thân: lấy lát `while (...)` ở cuối statement.
    const start = stmt.statement.getEnd();
    const raw = this.sf.text.slice(start, stmt.getEnd());
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim().replace(/;$/, "").trim();
    const from = start + lead;
    const id = this.addNode({
      kind: "loop",
      label: shortLabel(text),
      code: text,
      range: rangeBetween(from, from + text.length, this.sf),
      parentId: scope.regionId,
    });

    const collect: OpenEnd[] = [];
    const depth = scope.finallyStack.length;
    const breakTarget: BreakTarget = { collect, finallyDepth: depth };
    const continueTarget: ContinueTarget = { nodeId: id, finallyDepth: depth };
    const inner: Scope = {
      ...scope,
      regionId: id,
      breakTarget,
      continueTarget,
      labels: withLabels(scope.labels, labels, breakTarget, continueTarget),
    };

    const body = this.buildBody(stmt.statement, [], inner);
    const bodyEntry = body.entry ?? id;
    this.connect(incoming, bodyEntry);
    this.connect(body.open, id);
    this.edge(id, bodyEntry, "true");

    const open: OpenEnd[] = [...collect];
    if (!isAlwaysTrueLoop(stmt)) open.push({ from: id, label: "false" });
    return { entry: bodyEntry, open };
  }

  // -------------------------------------------------------------------------
  // §5 break / continue
  // -------------------------------------------------------------------------

  private buildBreak(stmt: ts.BreakStatement, incoming: OpenEnd[], scope: Scope): Segment {
    const code = stmt.getText(this.sf);
    const id = this.addNode({
      kind: "break",
      label: shortLabel(code),
      code,
      range: rangeOf(stmt, this.sf),
      parentId: scope.regionId,
    });
    this.connect(incoming, id);

    const target =
      stmt.label === undefined
        ? scope.breakTarget
        : scope.labels.get(stmt.label.text)?.breakTarget;
    if (target === undefined) {
      this.warn(`break without a target at line ${lineOf(stmt, this.sf)}`);
      if (!scope.unreachable) this.edge(id, this.exitId);
      return { entry: id, open: [] };
    }
    if (!scope.unreachable) {
      this.routePending(id, { kind: "break", target }, scope.finallyStack);
    }
    return { entry: id, open: [] };
  }

  private buildContinue(stmt: ts.ContinueStatement, incoming: OpenEnd[], scope: Scope): Segment {
    const code = stmt.getText(this.sf);
    const id = this.addNode({
      kind: "continue",
      label: shortLabel(code),
      code,
      range: rangeOf(stmt, this.sf),
      parentId: scope.regionId,
    });
    this.connect(incoming, id);

    const target =
      stmt.label === undefined
        ? scope.continueTarget
        : scope.labels.get(stmt.label.text)?.continueTarget;
    if (target === undefined) {
      this.warn(`continue without a target at line ${lineOf(stmt, this.sf)}`);
      if (!scope.unreachable) this.edge(id, this.exitId);
      return { entry: id, open: [] };
    }
    if (!scope.unreachable) {
      this.routePending(id, { kind: "continue", target }, scope.finallyStack);
    }
    return { entry: id, open: [] };
  }

  /**
   * §7: nhảy ra khỏi một khối try có finally thì phải chạy finally trước.
   *
   * Nếu có finally chen giữa điểm nhảy và đích: nối tới finally TRONG CÙNG và ghi
   * đích thật vào frame của nó. Đích đó sẽ được nối lại từ các đầu hở của khối
   * finally sau khi khối đó dựng xong - và có thể bị một finally ngoài hơn chặn
   * tiếp, nên `break` xuyên nhiều tầng finally vẫn tới đúng nơi.
   */
  private routePending(
    fromId: string,
    pending: PendingExit,
    stack: readonly FinallyFrame[],
    label?: EdgeLabel,
    once = false,
  ): void {
    const emit = once
      ? (to: string, edgeLabel?: EdgeLabel): void => this.edgeOnce(fromId, to, edgeLabel)
      : (to: string, edgeLabel?: EdgeLabel): void => this.edge(fromId, to, edgeLabel);

    const frame = stack.length > barrierDepth(pending) ? stack[stack.length - 1] : undefined;
    if (frame !== undefined) {
      emit(frame.nodeId, pending.kind === "exception" ? "exception" : label);
      addPending(frame.pending, pending);
      return;
    }

    switch (pending.kind) {
      case "exit":
        emit(this.exitId, label);
        return;
      case "exception":
        emit(pending.to, "exception");
        return;
      case "continue":
        emit(pending.target.nodeId, label);
        return;
      case "break":
        if (!once || !pending.target.collect.some((end) => end.from === fromId)) {
          pending.target.collect.push(label === undefined ? { from: fromId } : { from: fromId, label });
        }
        return;
    }
  }

  private buildLabeled(stmt: ts.LabeledStatement, incoming: OpenEnd[], scope: Scope): Segment {
    const labels: string[] = [];
    let inner: ts.Statement = stmt;
    while (ts.isLabeledStatement(inner)) {
      labels.push(inner.label.text);
      inner = inner.statement;
    }

    if (ts.isDoStatement(inner)) return this.buildDoWhile(inner, incoming, scope, labels);
    if (isLoopStatement(inner)) {
      return this.buildLoop(inner as ts.IterationStatement, incoming, scope, labels);
    }

    // Label trên statement không phải vòng lặp: chỉ `break <label>` dùng được.
    const collect: OpenEnd[] = [];
    const breakTarget: BreakTarget = { collect, finallyDepth: scope.finallyStack.length };
    const labelled: Scope = {
      ...scope,
      labels: withLabels(scope.labels, labels, breakTarget, undefined),
    };
    const segment = this.buildBody(inner, incoming, labelled);
    return { entry: segment.entry, open: [...segment.open, ...collect] };
  }

  // -------------------------------------------------------------------------
  // §6 switch
  // -------------------------------------------------------------------------

  private buildSwitch(stmt: ts.SwitchStatement, incoming: OpenEnd[], scope: Scope): Segment {
    const header = trimmedSlice(this.sf, stmt.getStart(this.sf), stmt.caseBlock.getStart(this.sf));
    const info = analyzeDiscriminant(stmt.expression, this.sf);
    const id = this.addNode({
      kind: "condition",
      label: shortLabel(header.text),
      code: header.text,
      range: header.range,
      condition: info.condition,
      confidence: info.confidence,
      parentId: scope.regionId,
    });
    this.connect(incoming, id);

    const collect: OpenEnd[] = [];
    const inner: Scope = {
      ...scope,
      breakTarget: { collect, finallyDepth: scope.finallyStack.length },
    };

    let fallthrough: OpenEnd[] = [];
    let hasDefault = false;

    for (const clause of stmt.caseBlock.clauses) {
      const isDefault = ts.isDefaultClause(clause);
      if (isDefault) hasDefault = true;
      const clauseInfo = isDefault
        ? defaultClauseCondition()
        : analyzeCaseClause(clause, stmt.expression, this.sf);
      const head = this.clauseHeader(clause);
      const caseId = this.addNode({
        kind: "switch-case",
        label: shortLabel(head.text),
        code: head.text,
        range: head.range,
        condition: clauseInfo.condition,
        confidence: clauseInfo.confidence,
        parentId: scope.regionId,
      });
      this.edge(id, caseId, isDefault ? "default" : "case");
      this.connect(fallthrough, caseId);
      fallthrough = this.buildStatements(clause.statements, [{ from: caseId }], inner).open;
    }

    const open: OpenEnd[] = [...fallthrough, ...collect];
    // Không có clause default: vẫn phải có nhánh "không case nào khớp".
    if (!hasDefault) open.push({ from: id, label: "default" });
    return { entry: id, open };
  }

  private clauseHeader(clause: ts.CaseOrDefaultClause): { text: string; range: SourceRange } {
    const start = clause.getStart(this.sf);
    const searchFrom = ts.isDefaultClause(clause) ? start : clause.expression.getEnd();
    const colon = this.sf.text.indexOf(":", searchFrom);
    const end = colon === -1 ? searchFrom : colon + 1;
    return {
      text: this.sf.text.slice(start, end),
      range: rangeBetween(start, end, this.sf),
    };
  }

  // -------------------------------------------------------------------------
  // §7 try / catch / finally
  // -------------------------------------------------------------------------

  private buildTry(stmt: ts.TryStatement, incoming: OpenEnd[], scope: Scope): Segment {
    const tryId = this.addNode({
      kind: "try",
      label: "try",
      code: stmt.getText(this.sf),
      range: rangeOf(stmt, this.sf),
      parentId: scope.regionId,
    });
    this.connect(incoming, tryId);

    const catchClause = stmt.catchClause;
    const catchId =
      catchClause === undefined
        ? undefined
        : this.addNode({
            kind: "catch",
            label: this.catchLabel(catchClause),
            code: catchClause.getText(this.sf),
            range: rangeOf(catchClause, this.sf),
            parentId: scope.regionId,
          });

    const finallyBlock = stmt.finallyBlock;
    const finallyId =
      finallyBlock === undefined
        ? undefined
        : this.addNode({
            kind: "finally",
            label: "finally",
            code: this.finallyText(stmt, finallyBlock).text,
            range: this.finallyText(stmt, finallyBlock).range,
            parentId: scope.regionId,
          });

    // Một edge exception duy nhất từ node try: "bất kỳ statement nào cũng có thể ném".
    const handler = catchId ?? finallyId ?? this.exitId;
    this.edge(tryId, handler, "exception");

    const frame: FinallyFrame | undefined =
      finallyId === undefined ? undefined : { nodeId: finallyId, pending: [] };
    const nestedFinally =
      frame === undefined ? scope.finallyStack : [...scope.finallyStack, frame];

    // Không có catch: edge exception ở trên đi thẳng vào finally, nên exception CHẮC CHẮN
    // có thể xuyên qua finally này và tiếp tục ra handler bao ngoài.
    const escaping: ExceptionPending | undefined =
      frame !== undefined && handler === finallyId
        ? { frame, to: scope.exceptionTarget }
        : undefined;
    if (escaping !== undefined) {
      addPending(escaping.frame.pending, { kind: "exception", to: escaping.to });
    }

    const tryScope = nestedScope(scope, {
      exceptionTarget: handler,
      exceptionPending: escaping,
      regionId: tryId,
      finallyStack: nestedFinally,
    });
    const tryOpen = this.buildStatements(stmt.tryBlock.statements, [{ from: tryId }], tryScope).open;

    let catchOpen: OpenEnd[] = [];
    if (catchClause !== undefined && catchId !== undefined) {
      // throw trong catch: finally của chính khối này, nếu không có thì handler bao ngoài.
      const catchScope = nestedScope(scope, {
        exceptionTarget: finallyId ?? scope.exceptionTarget,
        exceptionPending:
          frame === undefined ? scope.exceptionPending : { frame, to: scope.exceptionTarget },
        regionId: catchId,
        finallyStack: nestedFinally,
      });
      catchOpen = this.buildStatements(
        catchClause.block.statements,
        [{ from: catchId }],
        catchScope,
      ).open;
    }

    if (frame !== undefined && finallyId !== undefined && finallyBlock !== undefined) {
      // Có đường hoàn thành BÌNH THƯỜNG vào finally hay không. Nếu không (mọi đường ra
      // khỏi try/catch đều là return/throw/break/continue) thì bản thân câu try KHÔNG
      // hoàn thành bình thường, nên code phía sau nó là code chết.
      const normalEntry = tryOpen.length > 0 || catchOpen.length > 0;
      this.connect(tryOpen, finallyId);
      this.connect(catchOpen, finallyId);

      // finally KHÔNG tự đưa mình vào finallyStack: throw/return trong finally đi ra ngoài,
      // không quay lại chính nó.
      const finallyScope = nestedScope(scope, {
        exceptionTarget: scope.exceptionTarget,
        exceptionPending: scope.exceptionPending,
        regionId: finallyId,
        finallyStack: scope.finallyStack,
        insideFinally: true,
      });
      const finallyOpen = this.buildStatements(
        finallyBlock.statements,
        [{ from: finallyId }],
        finallyScope,
      ).open;

      // Nối lại các đường thoát đã bị finally này chặn, tính từ đầu hở của khối finally.
      for (const pending of orderedPendings(frame.pending)) {
        for (const end of finallyOpen) {
          this.routePending(end.from, pending, scope.finallyStack, end.label, /* once */ true);
        }
      }

      return { entry: tryId, open: normalEntry ? finallyOpen : [] };
    }

    return { entry: tryId, open: [...tryOpen, ...catchOpen] };
  }

  private catchLabel(clause: ts.CatchClause): string {
    if (clause.variableDeclaration === undefined) return "catch";
    return `catch (${clause.variableDeclaration.name.getText(this.sf)})`;
  }

  private finallyText(
    stmt: ts.TryStatement,
    finallyBlock: ts.Block,
  ): { text: string; range: SourceRange } {
    const start = (stmt.catchClause ?? stmt.tryBlock).getEnd();
    return trimmedSlice(this.sf, start, finallyBlock.getEnd());
  }

  // -------------------------------------------------------------------------
  // §8 return / throw
  // -------------------------------------------------------------------------

  private buildReturn(stmt: ts.ReturnStatement, incoming: OpenEnd[], scope: Scope): Segment {
    const id = this.statementLikeNode(
      "return",
      stmt.getText(this.sf),
      rangeOf(stmt, this.sf),
      [stmt],
      scope,
    );
    this.connect(incoming, id);

    if (scope.insideFinally) {
      this.warn(
        `return inside finally overrides pending completion at line ${lineOf(stmt, this.sf)}`,
      );
    }

    if (!scope.unreachable) {
      this.routePending(id, { kind: "exit" }, scope.finallyStack);
    }
    return { entry: id, open: [] };
  }

  private buildThrow(stmt: ts.ThrowStatement, incoming: OpenEnd[], scope: Scope): Segment {
    const id = this.statementLikeNode(
      "throw",
      stmt.getText(this.sf),
      rangeOf(stmt, this.sf),
      [stmt],
      scope,
    );
    this.connect(incoming, id);
    if (!scope.unreachable) {
      this.edge(id, scope.exceptionTarget, "exception");
      // Ném vào một finally: sau khi finally chạy xong, exception phải đi tiếp ra ngoài.
      if (scope.exceptionPending !== undefined) {
        addPending(scope.exceptionPending.frame.pending, {
          kind: "exception",
          to: scope.exceptionPending.to,
        });
      }
    }
    return { entry: id, open: [] };
  }

  // -------------------------------------------------------------------------
  // §9 hàm lồng + statement biểu thức phức tạp
  // -------------------------------------------------------------------------

  private buildExpressionish(stmt: ts.Statement, incoming: OpenEnd[], scope: Scope): Segment {
    const nested = collectNestedFunctions(stmt);

    if (nested.length > 0) {
      let entry: string | null = null;
      let open = incoming;

      if (!isPureFunctionDefinition(stmt)) {
        const id = this.statementLikeNode(
          "statement",
          stmt.getText(this.sf),
          rangeOf(stmt, this.sf),
          [stmt],
          scope,
        );
        this.connect(incoming, id);
        entry = id;
        open = [{ from: id }];
      }

      for (const fn of nested) {
        const id = this.callNode(fn, scope);
        this.connect(open, id);
        if (entry === null) entry = id;
        open = [{ from: id }];
      }
      return { entry, open };
    }

    const ternary = findFirstTernary(stmt);
    if (ternary !== undefined) return this.lowerTernary(ternary, incoming, scope);

    return this.buildMerged([stmt], incoming, scope);
  }

  private callNode(fn: FunctionLike, scope: Scope): string {
    const label = functionNameOf(fn, this.sf);
    const id = this.addNode({
      kind: "call",
      label,
      code: fn.getText(this.sf),
      range: rangeOf(fn, this.sf),
      parentId: scope.regionId,
    });
    this.warn(`nested function body not inlined: ${label} at line ${lineOf(fn, this.sf)}`);
    return id;
  }
}
