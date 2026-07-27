import { describe, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph } from "./helpers/graph";

const FILE = "09-throw.ts";

describe("throw", () => {
  it("throw không được bắt -> edge exception tới exit", () => {
    const g = analyzeFixture(FILE, "requireName");

    expectGraph(g, {
      nodeCount: 5,
      edgeCount: 5,
      kinds: { entry: 1, condition: 1, throw: 1, return: 1, exit: 1, try: 0, catch: 0 },
      edges: [
        ["entry", "none", 'condition:name === ""'],
        ['condition:name === ""', "true", "throw"],
        ["throw", "exception", "exit"],
        ['condition:name === ""', "false", "return:return name"],
        ["return:return name", "none", "exit"],
      ],
      warningCount: 0,
    });
  });

  it("throw sau vòng lặp; điều kiện rơi thẳng về đầu vòng lặp vẫn giữ nhãn false", () => {
    const g = analyzeFixture(FILE, "firstOrThrow");

    expectGraph(g, {
      nodeCount: 6,
      edgeCount: 7,
      kinds: { entry: 1, loop: 1, condition: 1, return: 1, throw: 1, exit: 1, statement: 0 },
      edges: [
        ["entry", "none", "loop:for (const item of items)"],
        ["loop:for (const item of items)", "true", 'condition:item !== ""'],
        ['condition:item !== ""', "true", "return:return item"],
        ["return:return item", "none", "exit"],
        // nguồn là node condition -> nhãn phải là "false" (Giai đoạn 3 cần true/false
        // để lan truyền ràng buộc). Cạnh ngược ở đây suy ra bằng DFS, không bằng nhãn.
        ['condition:item !== ""', "false", "loop:for (const item of items)"],
        ["loop:for (const item of items)", "false", "throw"],
        ["throw", "exception", "exit"],
      ],
      backEdges: 1,
      warningCount: 0,
    });
  });
});
