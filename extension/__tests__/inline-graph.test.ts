import { describe, expect, it } from "vitest";

import type { FlowGraph } from "../../shared/types";
import type { CallSite } from "../call-sites";
import { inlineCalleeGraph, selectAutoInlineCallSite } from "../inline-graph";

const caller: FlowGraph = {
  functionName: "ReceiveController.receive",
  filePath: "receive.controller.ts",
  language: "typescript",
  warnings: [],
  nodes: [
    {
      id: "n_entry",
      kind: "entry",
      label: "entry",
      code: "",
      range: { startLine: 1, startCol: 0, endLine: 1, endCol: 1 },
      confidence: "certain",
    },
    {
      id: "n_return",
      kind: "return",
      label: "return withDeadlockRetry(() => service.received(body))",
      code: "return withDeadlockRetry(() => service.received(body));",
      range: { startLine: 3, startCol: 2, endLine: 3, endCol: 58 },
      confidence: "certain",
    },
    {
      id: "n_exit",
      kind: "exit",
      label: "exit",
      code: "",
      range: { startLine: 4, startCol: 0, endLine: 4, endCol: 1 },
      confidence: "certain",
    },
  ],
  edges: [
    { from: "n_entry", to: "n_return", label: null },
    { from: "n_return", to: "n_exit", label: null },
  ],
};

const callee: FlowGraph = {
  functionName: "ReceiveService.received",
  filePath: "receive.service.ts",
  language: "typescript",
  warnings: [],
  nodes: [
    {
      id: "n_1",
      kind: "entry",
      label: "entry: ReceiveService.received",
      code: "received(body) {",
      range: { startLine: 10, startCol: 2, endLine: 10, endCol: 18 },
      confidence: "certain",
    },
    {
      id: "n_2",
      kind: "condition",
      label: "switch (taskType)",
      code: "switch (taskType)",
      range: { startLine: 12, startCol: 4, endLine: 12, endCol: 21 },
      confidence: "certain",
    },
    {
      id: "n_3",
      kind: "exit",
      label: "exit",
      code: "",
      range: { startLine: 20, startCol: 2, endLine: 20, endCol: 3 },
      confidence: "certain",
    },
  ],
  edges: [
    { from: "n_1", to: "n_2", label: null },
    { from: "n_2", to: "n_3", label: "default" },
  ],
};

describe("selectAutoInlineCallSite", () => {
  it("ưu tiên business call nằm sâu trong wrapper return, bỏ call ở catch", () => {
    const sites: CallSite[] = [
      {
        targetId: "n_return:call:0",
        nodeId: "n_return",
        label: "withDeadlockRetry",
        line: 3,
        column: 9,
        arguments: [],
      },
      {
        targetId: "n_return:call:1",
        nodeId: "n_return",
        label: "received",
        line: 3,
        column: 45,
        arguments: [],
      },
      {
        targetId: "n_catch:call:2",
        nodeId: "n_catch",
        label: "sendSlackDefault",
        line: 5,
        column: 4,
        arguments: [],
      },
    ];

    expect(selectAutoInlineCallSite(caller, sites).map((site) => site.label)).toEqual([
      "received",
      "withDeadlockRetry",
    ]);
  });
});

describe("inlineCalleeGraph", () => {
  it("remap id, nối callee vào continuation và vẫn chỉ có một entry/exit", () => {
    const result = inlineCalleeGraph(caller, "n_return", callee, "n_return_call_1");
    expect(result).toBeDefined();
    const graph = result?.graph as FlowGraph;

    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
    expect(graph.nodes.filter((node) => node.kind === "entry")).toHaveLength(1);
    expect(graph.nodes.filter((node) => node.kind === "exit")).toHaveLength(1);

    const inlineEntry = graph.nodes.find((node) => node.label === "↳ ReceiveService.received");
    const inlineExit = graph.nodes.find(
      (node) => node.label === "↳ return ReceiveService.received",
    );
    expect(inlineEntry).toMatchObject({ kind: "call", parentId: "n_return" });
    expect(inlineExit).toMatchObject({ kind: "call", parentId: "n_return" });
    expect(graph.edges).toContainEqual({
      from: "n_return",
      to: inlineEntry?.id,
      label: null,
    });
    expect(graph.edges).toContainEqual({
      from: inlineExit?.id,
      to: "n_exit",
      label: null,
    });
    expect(graph.edges).not.toContainEqual({
      from: "n_return",
      to: "n_exit",
      label: null,
    });
  });
});
