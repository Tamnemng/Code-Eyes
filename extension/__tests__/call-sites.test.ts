import { describe, expect, it } from "vitest";

import type { FlowGraph } from "../../shared/types";
import { collectCallSites, collectFunctionParameters } from "../call-sites";
import { selectAutoInlineCallSite } from "../inline-graph";

const source = `class Controller {
  receiveByExternReceipt(body: ReceiveByExternReceiptDto) {
    try {
      return this.receiveService.receiveByExternReceipt(body);
    } catch (error) {
      sharedService.sendSlackDefault(JSON.stringify(error), "ERROR receive");
      throw error;
    }
  }
}`;

const graph: FlowGraph = {
  functionName: "Controller.receiveByExternReceipt",
  filePath: "controller.ts",
  language: "typescript",
  warnings: [],
  nodes: [
    {
      id: "n_return",
      kind: "return",
      label: "return this.receiveService.receiveByExternReceipt(body)",
      code: "return this.receiveService.receiveByExternReceipt(body);",
      range: { startLine: 4, startCol: 6, endLine: 4, endCol: 62 },
      confidence: "certain",
    },
    {
      id: "n_catch",
      kind: "statement",
      label: "sharedService.sendSlackDefault(...)",
      code: 'sharedService.sendSlackDefault(JSON.stringify(error), "ERROR receive");',
      range: { startLine: 6, startCol: 6, endLine: 6, endCol: 78 },
      confidence: "certain",
    },
  ],
  edges: [],
};

describe("collectCallSites", () => {
  it("lấy parameter của đúng method chứa graph", () => {
    expect(collectFunctionParameters("controller.ts", source, graph)).toEqual(["body"]);
  });
  it("gắn method cross-file vào đúng return node và giữ cột của tên method", () => {
    const sites = collectCallSites("controller.ts", source, graph);
    expect(sites).toContainEqual({
      targetId: "n_return:call:0",
      nodeId: "n_return",
      label: "receiveByExternReceipt",
      line: 4,
      column: 33,
      arguments: ["body"],
    });
  });

  it("mỗi call lồng nhau có targetId riêng và node id của graph gốc", () => {
    const sites = collectCallSites("controller.ts", source, graph);
    expect(sites.map(({ targetId, nodeId, label }) => ({ targetId, nodeId, label }))).toEqual([
      {
        targetId: "n_return:call:0",
        nodeId: "n_return",
        label: "receiveByExternReceipt",
      },
      { targetId: "n_catch:call:1", nodeId: "n_catch", label: "sendSlackDefault" },
      { targetId: "n_catch:call:2", nodeId: "n_catch", label: "stringify" },
    ]);
  });

  it("không tạo nút mở callee cho method collection built-in như filter/map", () => {
    const builtinSource = `function pick(rows: string[]) {
  return rows.filter((row) => row.length > 0).map((row) => row.trim());
}`;
    const builtinGraph: FlowGraph = {
      functionName: "pick",
      filePath: "pick.ts",
      language: "typescript",
      warnings: [],
      nodes: [
        {
          id: "n_return",
          kind: "return",
          label: "return rows.filter(...).map(...)",
          code: "return rows.filter((row) => row.length > 0).map((row) => row.trim());",
          range: { startLine: 2, startCol: 2, endLine: 2, endCol: 72 },
          confidence: "certain",
        },
      ],
      edges: [],
    };

    expect(collectCallSites("pick.ts", builtinSource, builtinGraph)).toEqual([]);
  });

  it("wrapper callback prefers received over withDeadlockRetry", () => {
    const wrapperSource = `class Controller {
  receive(body: ReceivesDto) {
    return withDeadlockRetry(() => this.receiveService.received(body));
  }
}`;
    const wrapperGraph: FlowGraph = {
      functionName: "Controller.receive",
      filePath: "controller.ts",
      language: "typescript",
      warnings: [],
      nodes: [
        {
          id: "n_return",
          kind: "return",
          label: "return withDeadlockRetry(() => this.receiveService.received(body))",
          code: "return withDeadlockRetry(() => this.receiveService.received(body));",
          range: { startLine: 3, startCol: 4, endLine: 3, endCol: 70 },
          confidence: "certain",
        },
      ],
      edges: [],
    };

    const sites = collectCallSites("controller.ts", wrapperSource, wrapperGraph);
    expect(sites.map((site) => site.label)).toEqual(["withDeadlockRetry", "received"]);
    expect(selectAutoInlineCallSite(wrapperGraph, sites)[0]?.label).toBe("received");
  });
});
