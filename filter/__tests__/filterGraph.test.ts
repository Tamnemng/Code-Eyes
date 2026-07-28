import { readdirSync } from "node:fs";
import path from "node:path";

import type { FlowEdge, FlowGraph, FlowNode, ParsedCondition } from "../../shared/types";
import { loadGolden } from "../../webview/__tests__/helpers/golden";
import {
  filterGraph,
  filterStats,
  type Constraints,
} from "../filterGraph";

const golden = (name: string): FlowGraph => loadGolden(`g-filter-${name}`);

function node(graph: FlowGraph, label: string): FlowNode {
  const found = graph.nodes.find((candidate) => candidate.label === label);
  if (found === undefined) throw new Error(`không tìm thấy node ${JSON.stringify(label)}`);
  return found;
}

function labels(graph: FlowGraph): Set<string> {
  return new Set(graph.nodes.map((candidate) => candidate.label));
}

function reachableIds(graph: FlowGraph): Set<string> {
  const entry = graph.nodes.find((candidate) => candidate.kind === "entry");
  if (entry === undefined) throw new Error("fixture thiếu entry");
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const targets = outgoing.get(edge.from);
    if (targets === undefined) outgoing.set(edge.from, [edge.to]);
    else targets.push(edge.to);
  }
  const reached = new Set([entry.id]);
  const queue = [entry.id];
  for (let index = 0; index < queue.length; index += 1) {
    for (const target of outgoing.get(queue[index] as string) ?? []) {
      if (reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }
  return reached;
}

function evaluate(parsed: ParsedCondition, actual: string): boolean {
  if (parsed.operator === "==") return actual === parsed.value;
  if (parsed.operator === "!=") return actual !== parsed.value;
  if (parsed.operator === "startsWith") {
    return typeof parsed.value === "string" && actual.startsWith(parsed.value);
  }
  return Array.isArray(parsed.value) && parsed.value.includes(actual);
}

/**
 * Oracle độc lập cho test an toàn: liệt kê mọi đường khả thi trên graph nhỏ. Nó chọn cạnh
 * ngay khi bước qua node, thay vì dựng tập dead-edge rồi chạy reachability như implementation.
 */
function bruteForcePathUnion(graph: FlowGraph, constraints: Constraints): Set<string> {
  const byId = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of graph.edges) {
    const edges = outgoing.get(edge.from);
    if (edges === undefined) outgoing.set(edge.from, [edge]);
    else edges.push(edge);
  }
  const entry = graph.nodes.find((candidate) => candidate.kind === "entry");
  if (entry === undefined) throw new Error("fixture thiếu entry");

  const possibleEdges = (current: FlowNode): readonly FlowEdge[] => {
    const edges = outgoing.get(current.id) ?? [];
    const truthEdges = edges.filter((edge) => edge.label === "true" || edge.label === "false");
    const parsed = current.condition?.parsed;
    if (truthEdges.length > 0 && parsed !== undefined) {
      const actual = constraints[parsed.variable];
      if (actual !== undefined) {
        const result = evaluate(parsed, actual);
        if (current.confidence === "certain" || !result) {
          return edges.filter((edge) => edge.label === (result ? "true" : "false"));
        }
      }
    }

    const dispatch = edges.filter((edge) => edge.label === "case" || edge.label === "default");
    if (dispatch.length > 0 && current.confidence === "certain") {
      const cases = dispatch
        .filter((edge) => edge.label === "case")
        .map((edge) => ({ edge, target: byId.get(edge.to) }))
        .filter(
          (item): item is { edge: FlowEdge; target: FlowNode } =>
            item.target !== undefined &&
            item.target.confidence === "certain" &&
            item.target.condition?.parsed !== undefined,
        );
      const variable = cases[0]?.target.condition?.parsed?.variable;
      const actual = variable === undefined ? undefined : constraints[variable];
      if (actual !== undefined) {
        const match = cases.find((item) =>
          evaluate(item.target.condition?.parsed as ParsedCondition, actual),
        );
        return dispatch.filter((edge) =>
          match === undefined ? edge.label === "default" : edge === match.edge,
        );
      }
    }
    return edges;
  };

  const union = new Set<string>();
  const visit = (id: string, path: ReadonlySet<string>): void => {
    union.add(id);
    if (path.has(id)) return;
    const current = byId.get(id);
    if (current === undefined) throw new Error(`edge trỏ tới node thiếu ${id}`);
    const nextPath = new Set(path).add(id);
    for (const edge of possibleEdges(current)) visit(edge.to, nextPath);
  };
  visit(entry.id, new Set());
  return union;
}

function expectTrueSubgraph(input: FlowGraph, output: FlowGraph): void {
  const inputNodes = new Map(input.nodes.map((candidate) => [candidate.id, candidate]));
  const inputEdges = new Set(input.edges.map((edge) => JSON.stringify(edge)));
  for (const candidate of output.nodes) expect(inputNodes.get(candidate.id)).toEqual(candidate);
  for (const edge of output.edges) expect(inputEdges.has(JSON.stringify(edge))).toBe(true);
}

describe("filterGraph — hợp đồng bất đối xứng §12", () => {
  it("certain + parsed quyết định cả hai chiều nhưng giữ node condition để truy vết", () => {
    const input = golden("operators");

    const falseResult = filterGraph(input, { clientCode: "A" });
    const condition = node(falseResult, 'clientCode !== "A"');
    expect(falseResult.edges.filter((edge) => edge.from === condition.id).map((edge) => edge.label))
      .toEqual(["false"]);
    expect(labels(falseResult).has('return "not-a";')).toBe(false);

    const trueResult = filterGraph(input, { clientCode: "B" });
    const trueCondition = node(trueResult, 'clientCode !== "A"');
    expect(trueResult.edges.filter((edge) => edge.from === trueCondition.id).map((edge) => edge.label))
      .toEqual(["true"]);
    expect(labels(trueResult).has('return "not-a";')).toBe(true);
  });

  it("unknown + parsed=false prune true; parsed=true không prune gì", () => {
    const input = golden("asymmetric");
    const falseResult = filterGraph(input, { clientCode: "B" });
    const condition = node(falseResult, 'clientCode === "A" && guard()');
    expect(falseResult.edges.filter((edge) => edge.from === condition.id).map((edge) => edge.label))
      .toEqual(["false"]);
    expect(labels(falseResult).has('return "A-and-guard";')).toBe(false);

    const trueResult = filterGraph(input, { clientCode: "A" });
    expect(trueResult.nodes).toEqual(input.nodes);
    expect(trueResult.edges).toEqual(input.edges);
  });

  it("unknown không parsed luôn giữ cả hai nhánh", () => {
    const result = filterGraph(golden("routeClient"), { clientCode: "A" });
    const unknown = node(result, "enabled");
    expect(result.edges.filter((edge) => edge.from === unknown.id).map((edge) => edge.label).sort())
      .toEqual(["false", "true"]);
    const kept = labels(result);
    expect(kept.has('steps.push("unknown:true");')).toBe(true);
    expect(kept.has('steps.push("unknown:false");')).toBe(true);
  });

  it("đánh giá đủ ==, !=, startsWith và in", () => {
    const input = golden("operators");
    expect(labels(filterGraph(input, { region: "EU-west" })).has('return "eu";')).toBe(true);
    expect(labels(filterGraph(input, { region: "APAC" })).has('return "eu";')).toBe(false);
    expect(labels(filterGraph(input, { tier: "silver" })).has('return "member";')).toBe(true);
    expect(labels(filterGraph(input, { tier: "bronze" })).has('return "member";')).toBe(false);
    expect(labels(filterGraph(input, { group: "last" })).has('return "last";')).toBe(true);
    expect(labels(filterGraph(input, { group: "other" })).has('return "last";')).toBe(false);
  });
});

describe("filterGraph — switch dispatch và fallthrough §6", () => {
  it('clientCode="A" giữ A, thân B do fallthrough, phần chung và hai nhánh unknown', () => {
    const input = golden("routeClient");
    const result = filterGraph(input, { clientCode: "A" });
    const kept = labels(result);

    for (const alive of [
      'case "A":',
      'steps.push("branch:A");',
      'case "B":',
      'steps.push("fallthrough:A-or-B");',
      "enabled",
      'steps.push("unknown:true");',
      'steps.push("unknown:false");',
      'steps.push("common:end");',
    ]) {
      expect(kept.has(alive), alive).toBe(true);
    }
    for (const dead of [
      'steps.push("branch:C");',
      'steps.push("branch:D");',
      'steps.push("branch:E");',
      'steps.push("branch:default");',
    ]) {
      expect(kept.has(dead), dead).toBe(false);
    }

    const discriminant = node(result, "switch (clientCode)");
    const byId = new Map(result.nodes.map((candidate) => [candidate.id, candidate]));
    const directTargets = result.edges
      .filter((edge) => edge.from === discriminant.id)
      .map((edge) => byId.get(edge.to)?.label);
    expect(directTargets).toEqual(['case "A":']);
    expect(
      result.edges.some(
        (edge) =>
          edge.from === node(result, 'steps.push("branch:A");').id &&
          edge.to === node(result, 'case "B":').id,
      ),
    ).toBe(true);
  });

  it("không có default clause: match case tắt đường default; không match giữ đường sau switch", () => {
    const input = golden("noDefault");
    expect(labels(filterGraph(input, { clientCode: "A" })).has('return "none";')).toBe(false);

    const noMatch = filterGraph(input, { clientCode: "Z" });
    expect(labels(noMatch).has('return "none";')).toBe(true);
    expect(labels(noMatch).has('return "A";')).toBe(false);
    expect(labels(noMatch).has('return "B";')).toBe(false);
  });

  it("discriminant unknown không được prune dispatch", () => {
    const input = golden("complexSwitch");
    expect(filterGraph(input, { clientCode: "A" })).toEqual(input);
  });

  it("mọi switch-case có parsed trong toàn bộ golden đều certain và có discriminant certain", () => {
    const goldenDir = path.join(import.meta.dirname, "..", "..", "webview", "__tests__", "golden");
    for (const file of readdirSync(goldenDir).filter((name) => name.endsWith(".json"))) {
      const graph = loadGolden(file.slice(0, -".json".length));
      const byId = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
      for (const candidate of graph.nodes) {
        if (candidate.kind !== "switch-case" || candidate.condition?.parsed === undefined) continue;
        expect(candidate.confidence, `${file}:${candidate.label}`).toBe("certain");
        const dispatch = graph.edges.find(
          (edge) => edge.to === candidate.id && edge.label === "case",
        );
        expect(dispatch, `${file}:${candidate.label} thiếu dispatch`).toBeDefined();
        expect(byId.get(dispatch?.from ?? "")?.confidence, `${file}:${candidate.label}`).toBe(
          "certain",
        );
      }
    }
  });
});

describe("filterGraph — reachability, finally, chu trình và đếm", () => {
  it("finally còn nếu vẫn có đường sống đi qua", () => {
    const result = filterGraph(golden("throughFinally"), { clientCode: "A" });
    expect(result.nodes.some((candidate) => candidate.kind === "finally")).toBe(true);
    expect(labels(result).has('return "A";')).toBe(true);
    expect(labels(result).has('return "other";')).toBe(false);
  });

  it("duyệt graph có back edge không lặp vô hạn", () => {
    const result = filterGraph(golden("cyclic"), { clientCode: "A" });
    expect(labels(result).has('work("A");')).toBe(true);
    expect(labels(result).has('work("other");')).toBe(false);
    expect(labels(result).has('return "done";')).toBe(true);
  });

  it("code chết sẵn bị loại nhưng không tính vào N; M chỉ là reachable ban đầu", () => {
    const input = golden("withDeadCode");
    const result = filterGraph(input, { clientCode: "A" });
    expect(labels(result).has('work("unreachable");')).toBe(false);
    expect(filterStats(input, result)).toEqual({ hidden: 1, total: 5 });
    expect(result.warnings.at(-1)).toBe("Filter: đang ẩn 1/5 node theo ràng buộc.");
  });

  it("exit luôn còn, kể cả constraint làm nó không còn reachable", () => {
    const result = filterGraph(golden("terminalLoop"), { clientCode: "A" });
    expect(result.nodes.filter((candidate) => candidate.kind === "exit")).toHaveLength(1);
    expect(reachableIds(result).has(node(result, "exit").id)).toBe(false);
  });

  it("constraint trỏ tới biến không tồn tại trả graph nguyên vẹn", () => {
    const input = golden("routeClient");
    expect(filterGraph(input, { missing: "A" })).toEqual(input);
  });

  it("constraints rỗng deep-equal input", () => {
    const input = golden("withDeadCode");
    expect(filterGraph(input, {})).toEqual(input);
  });
});

describe("filterGraph — bất biến và oracle brute-force", () => {
  const allGoldenNames = [
    "a-finally-fanout-shipOrder",
    "b-nested-regions-pipeline",
    "c-loops-bailOut",
    "c-loops-drain",
    "c-loops-scan",
    "d-confidence-route",
    "e-all-kinds-everything",
    "f-worst-case-processBatch",
    "g-filter-routeClient",
    "g-filter-noDefault",
    "g-filter-complexSwitch",
    "g-filter-asymmetric",
    "g-filter-throughFinally",
    "g-filter-cyclic",
    "g-filter-terminalLoop",
    "g-filter-withDeadCode",
    "g-filter-operators",
  ] as const;

  it.each(allGoldenNames)("%s: output là graph con, giữ entry/exit và node còn lại reachable", (name) => {
    const input = loadGolden(name);
    const parsed = input.nodes.find((candidate) => candidate.condition?.parsed !== undefined)
      ?.condition?.parsed;
    const constraints = parsed === undefined ? { absent: "value" } : { [parsed.variable]: "A" };
    const output = filterGraph(input, constraints);
    expectTrueSubgraph(input, output);
    expect(output.nodes.filter((candidate) => candidate.kind === "entry")).toHaveLength(1);
    expect(output.nodes.filter((candidate) => candidate.kind === "exit")).toHaveLength(1);
    const reached = reachableIds(output);
    for (const candidate of output.nodes) {
      // `exit` là ngoại lệ bắt buộc: graph con không được bịa edge tới exit chỉ để làm nó reachable.
      if (candidate.kind !== "exit") expect(reached.has(candidate.id), `${name}:${candidate.id}`).toBe(true);
    }
  });

  it.each([
    ["routeClient", { clientCode: "A" }],
    ["routeClient", { clientCode: "Z" }],
    ["asymmetric", { clientCode: "A" }],
    ["asymmetric", { clientCode: "B" }],
  ] as const)("không thiếu node thuộc hợp mọi đường khả thi: %s %j", (name, constraints) => {
    const input = golden(name);
    const expectedSafe = bruteForcePathUnion(input, constraints);
    const outputIds = new Set(filterGraph(input, constraints).nodes.map((candidate) => candidate.id));
    for (const id of expectedSafe) expect(outputIds.has(id), `${name} thiếu ${id}`).toBe(true);
  });
});
