import { describe, expect, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph, node } from "./helpers/graph";
import type { FlowGraph, FlowNode } from "../../../shared/types";

const FILE = "13-condition-parsing.ts";

function graph(): FlowGraph {
  return analyzeFixture(FILE, "routeClient");
}

describe("condition.parsed", () => {
  it("hình dạng graph của chuỗi guard + switch", () => {
    expectGraph(graph(), {
      nodeCount: 23,
      edgeCount: 31,
      kinds: { entry: 1, condition: 9, "switch-case": 2, return: 10, exit: 1, statement: 0 },
      warningCount: 0,
    });
  });

  const parsedCases: Array<[string, FlowNode["condition"]]> = [
    [
      'condition:clientCode === "A"',
      { raw: 'clientCode === "A"', parsed: { variable: "clientCode", operator: "==", value: "A" } },
    ],
    [
      'condition:clientCode == "B"',
      { raw: 'clientCode == "B"', parsed: { variable: "clientCode", operator: "==", value: "B" } },
    ],
    [
      // literal ở vế trái vẫn phải chuẩn hoá về { variable, operator, value }
      'condition:"Z" === clientCode',
      { raw: '"Z" === clientCode', parsed: { variable: "clientCode", operator: "==", value: "Z" } },
    ],
    [
      'condition:region !== "EU"',
      { raw: 'region !== "EU"', parsed: { variable: "region", operator: "!=", value: "EU" } },
    ],
    [
      'condition:clientCode.startsWith("X")',
      {
        raw: 'clientCode.startsWith("X")',
        parsed: { variable: "clientCode", operator: "startsWith", value: "X" },
      },
    ],
    [
      'condition:["C", "D"].includes(clientCode)',
      {
        raw: '["C", "D"].includes(clientCode)',
        parsed: { variable: "clientCode", operator: "in", value: ["C", "D"] },
      },
    ],
  ];

  it.each(parsedCases)("parse được: %s", (matcher, expected) => {
    const n = node(graph(), matcher);
    expect(n.condition).toEqual(expected);
    expect(n.confidence).toBe("certain");
  });

  const unparsedCases: Array<[string, string]> = [
    ["condition:count > 10", "count > 10"],
    ["condition:tags.length === count", "tags.length === count"],
  ];

  it.each(unparsedCases)("KHÔNG parse (%s) -> parsed undefined + unknown", (matcher, raw) => {
    const n = node(graph(), matcher);
    expect(n.condition?.raw).toBe(raw);
    expect(n.condition?.parsed).toBeUndefined();
    expect(n.confidence).toBe("unknown");
  });

  it("case string literal parse theo discriminant của switch", () => {
    const g = graph();

    const discriminant = node(g, "condition:switch (region)");
    expect(discriminant.condition?.raw).toBe("region");
    expect(discriminant.condition?.parsed).toBeUndefined();

    const caseUs = node(g, 'switch-case:case "US"');
    expect(caseUs.condition).toEqual({
      raw: 'case "US"',
      parsed: { variable: "region", operator: "==", value: "US" },
    });
    expect(caseUs.confidence).toBe("certain");

    const dflt = node(g, "switch-case:default");
    expect(dflt.condition?.raw).toBe("default");
    expect(dflt.condition?.parsed).toBeUndefined();
  });
});

// SEMANTICS §11 (ngoại lệ) + §12: && / || trong biểu thức điều kiện KHÔNG phải nhánh
// ngầm -> không warning. parsed và confidence là HAI TRỤC ĐỘC LẬP.
describe("&& / || trong biểu thức điều kiện", () => {
  it("&&: vừa có parsed vừa confidence unknown (kết luận MỘT CHIỀU), không warning", () => {
    const g = analyzeFixture(FILE, "canEdit");

    expectGraph(g, {
      nodeCount: 5,
      edgeCount: 5,
      kinds: { entry: 1, condition: 1, return: 2, exit: 1, statement: 0 },
      edges: [
        ["entry", "none", 'condition:role === "admin" && active'],
        ['condition:role === "admin" && active', "true", 'return:"yes"'],
        ['condition:role === "admin" && active', "false", 'return:"no"'],
      ],
      // && trong điều kiện KHÔNG sinh warning "implicit branch"
      warningCount: 0,
    });

    const cond = node(g, "condition");
    expect(cond.condition?.raw).toBe('role === "admin" && active');
    expect(cond.condition?.parsed).toEqual({ variable: "role", operator: "==", value: "admin" });
    // parsed cho false => cả biểu thức chắc chắn false => filter prune được nhánh true.
    // parsed cho true => chưa kết luận được => confidence unknown.
    expect(cond.confidence).toBe("unknown");
  });

  it("||: KHÔNG điền parsed (kết luận chạy ngược chiều, schema không ghi được chiều)", () => {
    const g = analyzeFixture(FILE, "isBlocked");

    expectGraph(g, {
      nodeCount: 5,
      edgeCount: 5,
      kinds: { entry: 1, condition: 1, return: 2, exit: 1 },
      warningCount: 0,
    });

    const cond = node(g, "condition");
    expect(cond.condition?.raw).toBe('status === "blocked" || banned');
    expect(cond.condition?.parsed).toBeUndefined();
    expect(cond.confidence).toBe("unknown");
  });

  it("chuỗi &&: parsed tương thích giữ hạng tử đầu tiên từ trái sang", () => {
    const g = analyzeFixture(FILE, "chainOrder");

    expectGraph(g, {
      nodeCount: 7,
      edgeCount: 8,
      kinds: { entry: 1, condition: 2, return: 3, exit: 1 },
      warningCount: 0,
    });

    // hạng tử đầu không parse được -> lấy hạng tử thứ hai
    const first = node(g, "condition:tags.length > 0");
    expect(first.condition?.parsed).toEqual({
      variable: "clientCode",
      operator: "==",
      value: "A",
    });
    expect(first.confidence).toBe("unknown");

    // `parsed` tương thích vẫn giữ cái đầu tiên; `parsedConjuncts` chứa toàn bộ.
    const second = node(g, 'condition:clientCode === "B"');
    expect(second.condition?.parsed).toEqual({
      variable: "clientCode",
      operator: "==",
      value: "B",
    });
    expect(second.condition?.parsedConjuncts).toEqual([
      { variable: "clientCode", operator: "==", value: "B" },
      { variable: "clientCode", operator: "startsWith", value: "B" },
    ]);
    expect(second.confidence).toBe("unknown");
  });

  it("&& keeps every parsable comparison so each variable can filter safely", () => {
    const g = analyzeFixture(FILE, "compoundWarehouse");
    const cond = node(g, "condition");

    expect(cond.condition?.parsedConjuncts).toEqual([
      {
        variable: "currentUser.clientCode",
        operator: "==",
        value: "SAINTGOBAIN",
      },
      { variable: "whseid", operator: "==", value: "510" },
    ]);
    expect(cond.confidence).toBe("unknown");
  });

  it("normalizes optional property access to the same filter variable", () => {
    const g = analyzeFixture(FILE, "optionalClient");
    const cond = node(g, "condition");

    expect(cond.condition?.parsed).toEqual({
      variable: "currentUser.clientCode",
      operator: "==",
      value: "TTC",
    });
    expect(cond.confidence).toBe("certain");
  });

  it("parses numeric DB-result fields so query-derived checks can be constrained", () => {
    const g = analyzeFixture(FILE, "queryResultChecks");
    expect(node(g, "condition:receipt?.orderclose === 1").condition?.parsed).toEqual({
      variable: "receipt.orderclose",
      operator: "==",
      value: "1",
    });
    expect(node(g, "condition:rows.length === 0").condition?.parsed).toEqual({
      variable: "rows.length",
      operator: "==",
      value: "0",
    });
  });

  it("parses enum cases for a switch over a DTO property", () => {
    const g = analyzeFixture(FILE, "routeTask");
    const caseLpn = node(g, "switch-case:case ETaskType.RECEIVE_BY_LPN");

    expect(caseLpn.condition?.parsed).toEqual({
      variable: "data.taskType",
      operator: "==",
      value: "ETaskType.RECEIVE_BY_LPN",
    });
    expect(caseLpn.confidence).toBe("certain");
  });
});
