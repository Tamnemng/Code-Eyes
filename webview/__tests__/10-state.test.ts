import { describe, expect, it } from "vitest";

import {
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  graphKeyOf,
  initialState,
  restoreState,
  serializeState,
  undoTraceAction,
} from "../state";

describe("clampScale", () => {
  it("kẹp trong [MIN_SCALE, MAX_SCALE]", () => {
    expect(clampScale(0.0001)).toBe(MIN_SCALE);
    expect(clampScale(999)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });

  it("giá trị không phải số hữu hạn -> 1, không NaN lan ra transform", () => {
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("serializeState / restoreState - round-trip", () => {
  it("giữ nguyên graphKey, collapsedIds, selection, transform", () => {
    const state = initialState();
    state.graphKey = graphKeyOf("/src/a.ts", "Svc.route");
    state.collapsedIds.add("n_7");
    state.collapsedIds.add("n_3");
    state.selectedSourceId = "n_12";
    state.transform = { x: -40, y: 15, scale: 2 };
    state.constraints = { clientCode: "NUTRICARE", region: "EU" };
    state.mockQueryEnabled = true;
    state.trace.active = true;
    state.trace.input = '{"id":"R1"}';
    state.trace.decisions["/src/a.ts#Svc.route"] = {
      n_20: { kind: "branch", outcome: "false" },
    };
    state.trace.runtimeValues["/src/a.ts#Svc.route"] = { "receipt.orderclose": 0 };
    state.settings.locale = "en";

    const restored = restoreState(JSON.parse(JSON.stringify(serializeState(state))));
    expect(restored.graphKey).toBe("/src/a.ts#Svc.route");
    expect(restored.collapsedIds).toEqual(new Set(["n_3", "n_7"]));
    expect(restored.selectedSourceId).toBe("n_12");
    expect(restored.transform).toEqual({ x: -40, y: 15, scale: 2 });
    expect(restored.constraints).toEqual({ clientCode: "NUTRICARE", region: "EU" });
    expect(restored.mockQueryEnabled).toBe(true);
    expect(restored.trace).toEqual(state.trace);
    expect(restored.settings.locale).toBe("en");
  });

  it("không chọn gì -> phục hồi thành undefined, không phải null", () => {
    const restored = restoreState(JSON.parse(JSON.stringify(serializeState(initialState()))));
    expect(restored.selectedSourceId).toBeUndefined();
  });

  it("serialize deterministic (id đã sắp xếp) -> setState không ghi lại vô ích", () => {
    const a = initialState();
    a.collapsedIds.add("n_9");
    a.collapsedIds.add("n_1");
    const b = initialState();
    b.collapsedIds.add("n_1");
    b.collapsedIds.add("n_9");
    a.constraints = { z: "2", a: "1" };
    b.constraints = { a: "1", z: "2" };
    expect(JSON.stringify(serializeState(a))).toBe(JSON.stringify(serializeState(b)));
  });
});

describe("restoreState - dữ liệu KHÔNG tin được", () => {
  it("undefined / null / kiểu sai -> trạng thái mặc định, không throw", () => {
    for (const raw of [undefined, null, 42, "chuoi", [], true]) {
      expect(() => restoreState(raw)).not.toThrow();
      expect(restoreState(raw)).toEqual(initialState());
    }
  });

  it("collapsedIds không phải mảng -> bỏ qua", () => {
    expect(restoreState({ collapsedIds: "n_1" }).collapsedIds).toEqual(new Set());
    expect(restoreState({ collapsedIds: { a: 1 } }).collapsedIds).toEqual(new Set());
  });

  it("phần tử không phải string bị loại, phần tử hợp lệ được giữ", () => {
    expect(restoreState({ collapsedIds: ["n_1", 7, null, "n_2", {}] }).collapsedIds).toEqual(
      new Set(["n_1", "n_2"]),
    );
  });

  it("transform thiếu field hoặc NaN -> lấy mặc định từng field", () => {
    expect(restoreState({ transform: { x: 10 } }).transform).toEqual({ x: 10, y: 0, scale: 1 });
    expect(restoreState({ transform: { x: Number.NaN, scale: 0 } }).transform).toEqual({
      x: 0,
      y: 0,
      scale: MIN_SCALE,
    });
  });

  it("scale ngoài khoảng bị kẹp khi phục hồi, không chỉ khi zoom", () => {
    expect(restoreState({ transform: { scale: 100 } }).transform.scale).toBe(MAX_SCALE);
  });

  it("graphKey không phải string -> undefined, coi như graph mới", () => {
    expect(restoreState({ graphKey: 42 }).graphKey).toBeUndefined();
    expect(restoreState({}).graphKey).toBeUndefined();
  });

  it("constraints chỉ nhận cặp string/string và bỏ key rỗng", () => {
    expect(
      restoreState({
        constraints: {
          clientCode: "NUTRICARE",
          count: 7,
          emptyObject: {},
          "": "ignored",
        },
      }).constraints,
    ).toEqual({ clientCode: "NUTRICARE" });
  });

  it("mockQueryEnabled chỉ nhận boolean, bản cũ mặc định tắt", () => {
    expect(restoreState({ mockQueryEnabled: true }).mockQueryEnabled).toBe(true);
    expect(restoreState({ mockQueryEnabled: "true" }).mockQueryEnabled).toBe(false);
    expect(restoreState({}).mockQueryEnabled).toBe(false);
  });

  it("schema của bản webview cũ (field lạ) -> không crash, lấy được phần hiểu được", () => {
    const restored = restoreState({
      version: 0,
      collapsedIds: ["n_5"],
      truongLa: "gi day",
      transform: { x: 1, y: 2, scale: 1.25, extra: true },
    });
    expect(restored.collapsedIds).toEqual(new Set(["n_5"]));
    expect(restored.transform).toEqual({ x: 1, y: 2, scale: 1.25 });
  });
});

describe("undoTraceAction", () => {
  it("lùi một iteration của loop mà vẫn giữ quyết định vòng trước", () => {
    const trace = initialState().trace;
    trace.decisions.demo = {
      n_loop: { kind: "branches", outcomes: ["true", "false"] },
    };
    trace.actions = [
      { graphKey: "demo", kind: "decision", nodeId: "n_loop" },
      { graphKey: "demo", kind: "decision", nodeId: "n_loop" },
    ];
    const undone = undoTraceAction(trace, "demo");
    expect(undone?.decisions.demo?.n_loop).toEqual({ kind: "branch", outcome: "true" });
    expect(undone?.actions).toHaveLength(1);
  });

  it("khôi phục giá trị runtime trước đó; không có action của frame thì trả undefined", () => {
    const trace = initialState().trace;
    trace.runtimeValues.demo = { "receipt.status": 5 };
    trace.actions = [
      {
        graphKey: "demo",
        kind: "runtime",
        variable: "receipt.status",
        hadPrevious: true,
        previous: 0,
      },
    ];
    expect(undoTraceAction(trace, "demo")?.runtimeValues.demo).toEqual({
      "receipt.status": 0,
    });
    expect(undoTraceAction(trace, "other")).toBeUndefined();
  });
});
