import { describe, expect, it } from "vitest";

import { analyzeFunctionAtCursor } from "../../analyzer/typescript";
import { runGuidedTrace } from "../guidedTrace";

function analyze(source: string) {
  return analyzeFunctionAtCursor({ filePath: "trace.ts", sourceText: source, line: 2, column: 4 });
}

describe("runGuidedTrace", () => {
  it("đi tự động bằng body, destructuring và assignment đã biết", () => {
    const graph = analyze(`class Api {
  receive(body: { taskType: string; isMobile?: boolean }) {
    body.isMobile = true;
    const { taskType } = body;
    if (taskType === "NEW" && body.isMobile === true) return "ok";
    throw new Error("wrong");
  }
}`);
    const result = runGuidedTrace({ graph, parameters: ["body"], body: { taskType: "NEW" } });
    expect(result.status).toBe("returned");
    expect(result.terminal?.code).toContain('return "ok"');
    expect(result.values["body.isMobile"]).toBe(true);
    expect(result.values["taskType"]).toBe("NEW");
  });

  it("coi property không có trong JSON đã biết là undefined, không hỏi như dữ liệu DB", () => {
    const graph = analyze(`function receive(body: { token?: string }) {
  if (!body.token) body.token = "fallback";
  return body.token;
}`);
    const result = runGuidedTrace({ graph, parameters: ["body"], body: {} });
    expect(result.status).toBe("returned");
    expect(result.values["body.token"]).toBe("fallback");
  });

  it("dừng tại dữ liệu DB chưa biết, nhận giá trị mock rồi đi tiếp", () => {
    const graph = analyze(`async function received(data: { id: string }) {
  const receipt = await repo.findOne(data.id);
  if (receipt.orderclose === 1) throw new Error("closed");
  return data.id;
}`);
    const waiting = runGuidedTrace({ graph, parameters: ["data"], body: { id: "R1" } });
    expect(waiting.status).toBe("awaiting");
    expect(waiting.question?.variable).toBe("receipt.orderclose");

    const completed = runGuidedTrace({
      graph,
      parameters: ["data"],
      body: { id: "R1" },
      runtimeValues: { "receipt.orderclose": 0 },
    });
    expect(completed.status).toBe("returned");
    expect(completed.terminal?.code).toContain("return data.id");
  });

  it("boolean mock chọn được nhánh khi biểu thức không thể diễn giải", () => {
    const graph = analyze(`function check(data: unknown) {
  if (customPredicate(data)) return "yes";
  return "no";
}`);
    const waiting = runGuidedTrace({ graph, parameters: ["data"], body: {} });
    expect(waiting.status).toBe("awaiting");
    const nodeId = waiting.question?.nodeId as string;
    const chosen = runGuidedTrace({
      graph,
      parameters: ["data"],
      body: {},
      decisions: { [nodeId]: { kind: "branch", outcome: "false" } },
    });
    expect(chosen.terminal?.code).toContain('return "no"');
  });

  it("cho nhập trực tiếp biến runtime dù declaration từ await là unknown", () => {
    const graph = analyze(`async function lock(data: unknown) {
  const acquired = await redis.setIfNotExists("key");
  if (!acquired) throw new Error("busy");
  return "ok";
}`);
    const waiting = runGuidedTrace({ graph, parameters: ["data"], body: {} });
    expect(waiting.question?.variable).toBe("acquired");
    const completed = runGuidedTrace({
      graph,
      parameters: ["data"],
      body: {},
      runtimeValues: { acquired: true },
    });
    expect(completed.status).toBe("returned");
    expect(completed.terminal?.code).toContain('return "ok"');
  });

  it("dừng ở return có business callee để UI đi sâu sang function kế", () => {
    const graph = analyze(`function receive(body: unknown) {
  return withRetry(() => service.received(body));
}`);
    const terminal = graph.nodes.find((node) => node.kind === "return");
    const result = runGuidedTrace({
      graph,
      parameters: ["body"],
      body: {},
      terminalCalleeNodeIds: new Set([terminal?.id as string]),
    });
    expect(result.status).toBe("callee");
    expect(result.calleeNodeId).toBe(terminal?.id);
  });

  it("bind parameter alias khi wrapper đã inline callee", () => {
    const graph = analyze(`function receive(body: { taskType: string }) {
  const { taskType } = recevieDetail;
  if (taskType === "NEW") return "ok";
  throw new Error("wrong");
}`);
    const result = runGuidedTrace({
      graph,
      parameters: ["body"],
      aliases: { recevieDetail: "body" },
      body: { taskType: "NEW" },
    });
    expect(result.status).toBe("returned");
    expect(result.terminal?.code).toContain('return "ok"');
  });

  it("hỏi lại từng vòng for-in rồi cho thoát loop để chạy code bên dưới", () => {
    const graph = analyze(`async function receive(body: { groups: object }) {
  const groups = body.groups;
  for (const key in groups) {
    const receiptDetails = groups[key];
    await service.validateQtyQrcodeTrackings({ receiptDetails });
  }
  return "continued below loop";
}`);
    const first = runGuidedTrace({ graph, parameters: ["body"], body: { groups: { a: [] } } });
    expect(first.status).toBe("awaiting");
    const loopId = first.question?.nodeId as string;

    const afterOneIteration = runGuidedTrace({
      graph,
      parameters: ["body"],
      body: { groups: { a: [] } },
      decisions: { [loopId]: { kind: "branch", outcome: "true" } },
    });
    expect(afterOneIteration.status).toBe("awaiting");
    expect(afterOneIteration.question?.nodeId).toBe(loopId);

    const exited = runGuidedTrace({
      graph,
      parameters: ["body"],
      body: { groups: { a: [] } },
      decisions: { [loopId]: { kind: "branches", outcomes: ["true", "false"] } },
    });
    expect(exited.status).toBe("returned");
    expect(exited.terminal?.code).toContain("continued below loop");
  });
});
