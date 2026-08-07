import { describe, expect, it } from "vitest";

import { loadGolden } from "../../webview/__tests__/helpers/golden";
import { filterGraph } from "../filterGraph";
import { collectQueryMockCandidates, queryMockKey } from "../queryMocks";

const graph = () => loadGolden("g-filter-routeClient");

function enabledConditionId(): string {
  const found = graph().nodes.find((node) => node.kind === "condition" && node.label === "enabled");
  if (found === undefined) throw new Error("golden thiếu condition enabled");
  return found.id;
}

describe("query condition mocks", () => {
  it("lists binary runtime conditions without pretending to understand their expression", () => {
    const candidate = collectQueryMockCandidates(graph()).find((item) => item.label === "enabled");
    expect(candidate).toEqual({
      key: queryMockKey(enabledConditionId()),
      nodeId: enabledConditionId(),
      label: "enabled",
      line: 36,
    });
  });

  it("explicit true/false mock selects the matching branch", () => {
    const key = queryMockKey(enabledConditionId());
    const falseGraph = filterGraph(graph(), { [key]: "false" });
    expect(falseGraph.nodes.some((node) => node.label.includes("unknown:true"))).toBe(false);
    expect(falseGraph.nodes.some((node) => node.label.includes("unknown:false"))).toBe(true);

    const trueGraph = filterGraph(graph(), { [key]: "true" });
    expect(trueGraph.nodes.some((node) => node.label.includes("unknown:true"))).toBe(true);
    expect(trueGraph.nodes.some((node) => node.label.includes("unknown:false"))).toBe(false);
  });

  it("ignores invalid mock values", () => {
    const input = graph();
    expect(filterGraph(input, { [queryMockKey(enabledConditionId())]: "maybe" })).toEqual(input);
  });
});
