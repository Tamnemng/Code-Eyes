import { describe, expect, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph, expectPath, findEdges, node } from "./helpers/graph";

const FILE = "06-switch.ts";

describe("switch", () => {
  it("mỗi case là một node switch-case, break thoát ra sau switch", () => {
    const g = analyzeFixture(FILE, "routeCode");

    expectGraph(g, {
      nodeCount: 13,
      edgeCount: 14,
      kinds: {
        entry: 1,
        statement: 4,
        condition: 1,
        "switch-case": 3,
        break: 2,
        return: 1,
        exit: 1,
      },
      edges: [
        ["entry", "none", 'statement:let target = ""'],
        ['statement:let target = ""', "none", "condition:switch (code)"],
        ["condition:switch (code)", "case", 'switch-case:case "A"'],
        ['switch-case:case "A"', "none", 'statement:target = "alpha"'],
        ['statement:target = "alpha"', "none", "break"],
        ["condition:switch (code)", "case", 'switch-case:case "B"'],
        ['switch-case:case "B"', "none", 'statement:target = "bravo"'],
        ['statement:target = "bravo"', "none", "break"],
        ["condition:switch (code)", "default", "switch-case:default"],
        ["switch-case:default", "none", 'statement:target = "other"'],
        // default không có break -> chảy thẳng ra sau switch
        ['statement:target = "other"', "none", "return:return target"],
        ["return:return target", "none", "exit"],
      ],
      warningCount: 0,
    });

    // cả hai break đều dẫn tới node sau switch
    expect(findEdges(g, "break", "return:return target")).toHaveLength(2);

    // discriminant giữ raw, không parse; case string literal thì parse được
    const discriminant = node(g, "condition:switch (code)");
    expect(discriminant.condition?.raw).toBe("code");
    expect(discriminant.condition?.parsed).toBeUndefined();

    const caseA = node(g, 'switch-case:case "A"');
    expect(caseA.condition?.parsed).toEqual({ variable: "code", operator: "==", value: "A" });
    expect(caseA.confidence).toBe("certain");

    const dflt = node(g, "switch-case:default");
    expect(dflt.condition?.parsed).toBeUndefined();
  });

  it("fallthrough: case không có break chảy sang case kế tiếp", () => {
    const g = analyzeFixture(FILE, "priorityOf");

    expectGraph(g, {
      nodeCount: 13,
      edgeCount: 15,
      kinds: {
        entry: 1,
        statement: 4,
        condition: 1,
        "switch-case": 4,
        break: 1,
        return: 1,
        exit: 1,
      },
      edges: [
        ["condition:switch (level)", "case", 'switch-case:case "high"'],
        ["condition:switch (level)", "case", 'switch-case:case "urgent"'],
        ["condition:switch (level)", "case", 'switch-case:case "low"'],
        ["condition:switch (level)", "default", "switch-case:default"],
        // case rỗng rơi thẳng sang case kế
        ['switch-case:case "high"', "none", 'switch-case:case "urgent"'],
        ['switch-case:case "urgent"', "none", "statement:score = 10;"],
        ["statement:score = 10;", "none", "break"],
        ["break", "none", "return:return score"],
        ['switch-case:case "low"', "none", "statement:score = 1;"],
        // fallthrough thật sự: thân case "low" chảy sang default
        ["statement:score = 1;", "none", "switch-case:default"],
        ["switch-case:default", "none", "statement:score += 100;"],
        ["statement:score += 100;", "none", "return:return score"],
      ],
      absentEdges: [
        // "low" không được nhảy thẳng ra sau switch
        ["statement:score = 1;", "return:return score"],
      ],
      warningCount: 0,
    });
  });

  it("break trong switch nằm trong vòng lặp chỉ thoát SWITCH", () => {
    const g = analyzeFixture(FILE, "scanCodes");

    expectGraph(g, {
      nodeCount: 12,
      edgeCount: 13,
      kinds: {
        entry: 1,
        statement: 4,
        loop: 1,
        condition: 1,
        "switch-case": 2,
        break: 1,
        return: 1,
        exit: 1,
      },
      edges: [
        ["loop:for (const code of codes)", "true", "condition:switch (code)"],
        ["condition:switch (code)", "case", 'switch-case:case "add"'],
        ['switch-case:case "add"', "none", "statement:total += 1;"],
        ["statement:total += 1;", "none", "break"],
        // break thoát switch -> statement ngay sau switch, vẫn nằm TRONG vòng lặp
        ["break", "none", "statement:total *= 2;"],
        ["condition:switch (code)", "default", "switch-case:default"],
        ["switch-case:default", "none", "statement:total -= 1;"],
        ["statement:total -= 1;", "none", "statement:total *= 2;"],
        ["statement:total *= 2;", "none", "loop:for (const code of codes)"],
        ["loop:for (const code of codes)", "false", "return:return total"],
      ],
      absentEdges: [
        // break KHÔNG được thoát khỏi vòng lặp
        ["break", "return:return total"],
      ],
      backEdges: 1,
      warningCount: 0,
    });
  });

  it("switch KHÔNG có default: vẫn phải có nhánh 'không case nào khớp'", () => {
    const g = analyzeFixture(FILE, "flagOf");

    expectGraph(g, {
      nodeCount: 8,
      edgeCount: 8,
      kinds: { entry: 1, statement: 2, condition: 1, "switch-case": 1, break: 1, return: 1, exit: 1 },
      edges: [
        ["entry", "none", 'statement:let flag = "off"'],
        ['statement:let flag = "off"', "none", "condition:switch (code)"],
        ["condition:switch (code)", "case", 'switch-case:case "on"'],
        ['switch-case:case "on"', "none", 'statement:flag = "on";'],
        ['statement:flag = "on";', "none", "break"],
        ["break", "none", "return:return flag"],
        // không có clause default -> discriminant vẫn phải có edge "default" ra sau switch
        ["condition:switch (code)", "default", "return:return flag"],
        ["return:return flag", "none", "exit"],
      ],
      warningCount: 0,
    });
  });

  it("fallthrough + filter: chọn case 'A' vẫn phải chạy được thân case 'B'", () => {
    const g = analyzeFixture(FILE, "resolveClient");

    expectGraph(g, {
      nodeCount: 12,
      edgeCount: 13,
      kinds: {
        entry: 1,
        statement: 4,
        condition: 1,
        "switch-case": 3,
        break: 1,
        return: 1,
        exit: 1,
      },
      edges: [
        ["entry", "none", 'statement:let plan = "base"'],
        ['statement:let plan = "base"', "none", "condition:switch (clientCode)"],
        ["condition:switch (clientCode)", "case", 'switch-case:case "A"'],
        ['switch-case:case "A"', "none", 'statement:plan = "alpha";'],
        // fallthrough: thân case "A" chảy sang node case "B"
        ['statement:plan = "alpha";', "none", 'switch-case:case "B"'],
        ["condition:switch (clientCode)", "case", 'switch-case:case "B"'],
        ['switch-case:case "B"', "none", 'statement:plan = plan + "-shared";'],
        ['statement:plan = plan + "-shared";', "none", "break"],
        ["break", "none", "return:return plan"],
        ["condition:switch (clientCode)", "default", "switch-case:default"],
        ["switch-case:default", "none", 'statement:plan = "other";'],
        ['statement:plan = "other";', "none", "return:return plan"],
        ["return:return plan", "none", "exit"],
      ],
      absentEdges: [
        // "A" không được nhảy thẳng ra sau switch
        ['statement:plan = "alpha";', "return:return plan"],
      ],
      warningCount: 0,
    });

    // Hợp đồng cho Giai đoạn 3: với clientCode = "A", đường đi tới thân case "B"
    // vẫn tồn tại -> filter phải prune theo reachability, không theo nhãn case.
    expectPath(g, [
      'switch-case:case "A"',
      'statement:plan = "alpha";',
      'switch-case:case "B"',
      'statement:plan = plan + "-shared";',
    ]);
  });
});
