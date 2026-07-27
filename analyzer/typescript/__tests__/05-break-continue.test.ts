import { describe, it } from "vitest";

import { analyzeFixture } from "./helpers/analyze";
import { expectGraph } from "./helpers/graph";

const FILE = "05-break-continue.ts";

// Mỗi `continue` thêm một cạnh quay về header -> số back edge của một vòng lặp
// = 1 (đường chảy cuối thân) + số continue nhắm tới nó (SEMANTICS §4).
describe("break / continue", () => {
  it("continue quay về đầu vòng lặp, break nhảy tới node sau vòng lặp", () => {
    const g = analyzeFixture(FILE, "firstBlocked");

    expectGraph(g, {
      nodeCount: 11,
      edgeCount: 13,
      kinds: { entry: 1, statement: 3, loop: 1, condition: 2, continue: 1, break: 1, return: 1, exit: 1 },
      edges: [
        ["entry", "none", "statement:let found"],
        ["statement:let found", "none", "loop:for (const code of codes)"],
        ["loop:for (const code of codes)", "true", 'condition:code === "skip"'],
        ['condition:code === "skip"', "true", "continue"],
        ["continue", "none", "loop:for (const code of codes)"],
        ['condition:code === "skip"', "false", 'condition:code === "stop"'],
        ['condition:code === "stop"', "true", "statement:found = code"],
        ["statement:found = code", "none", "break"],
        ["break", "none", "return:return found"],
        ['condition:code === "stop"', "false", 'statement:found = "seen"'],
        ['statement:found = "seen"', "none", "loop:for (const code of codes)"],
        ["loop:for (const code of codes)", "false", "return:return found"],
        ["return:return found", "none", "exit"],
      ],
      backEdges: 2,
      warningCount: 0,
    });
  });

  it("break/continue có label nhắm đúng vòng lặp mang label", () => {
    const g = analyzeFixture(FILE, "findPair");

    expectGraph(g, {
      nodeCount: 13,
      edgeCount: 16,
      kinds: { entry: 1, statement: 4, loop: 2, condition: 2, break: 1, continue: 1, return: 1, exit: 1 },
      edges: [
        ["statement:let hit", "none", "loop:for (const row of rows)"],
        ["loop:for (const row of rows)", "true", "loop:for (const cell of row)"],
        ["loop:for (const cell of row)", "true", "condition:cell === target"],
        ["condition:cell === target", "true", "statement:hit = cell"],
        ["statement:hit = cell", "none", "break"],
        // break outer -> thoát HẲN vòng ngoài, tới node sau vòng ngoài
        ["break", "none", "return:return hit"],
        ["condition:cell === target", "false", 'condition:cell === "skip"'],
        ['condition:cell === "skip"', "true", "continue"],
        // continue outer -> về đầu vòng NGOÀI
        ["continue", "none", "loop:for (const row of rows)"],
        ['condition:cell === "skip"', "false", 'statement:hit = "checked"'],
        ['statement:hit = "checked"', "none", "loop:for (const cell of row)"],
        ["loop:for (const cell of row)", "false", 'statement:hit = "scanned"'],
        ['statement:hit = "scanned"', "none", "loop:for (const row of rows)"],
        ["loop:for (const row of rows)", "false", "return:return hit"],
        ["return:return hit", "none", "exit"],
      ],
      absentEdges: [
        // break outer KHÔNG được rơi về vòng trong
        ["break", "loop:for (const cell of row)"],
        // continue outer KHÔNG được quay về vòng trong
        ["continue", "loop:for (const cell of row)"],
      ],
      // vòng ngoài: continue outer + "scanned"; vòng trong: "checked"
      backEdges: 3,
      warningCount: 0,
    });
  });

  it("continue TRẦN trong vòng lặp lồng chỉ quay về vòng TRONG", () => {
    const g = analyzeFixture(FILE, "sumSkipping");

    expectGraph(g, {
      nodeCount: 10,
      edgeCount: 12,
      kinds: { entry: 1, statement: 3, loop: 2, condition: 1, continue: 1, return: 1, exit: 1 },
      edges: [
        ["statement:let kept = 0", "none", "loop:for (const row of rows)"],
        ["loop:for (const row of rows)", "true", "loop:for (const cell of row)"],
        ["loop:for (const cell of row)", "true", 'condition:cell === "skip"'],
        ['condition:cell === "skip"', "true", "continue"],
        // continue trần -> vòng TRONG
        ["continue", "none", "loop:for (const cell of row)"],
        ['condition:cell === "skip"', "false", "statement:kept += 1;"],
        ["statement:kept += 1;", "none", "loop:for (const cell of row)"],
        ["loop:for (const cell of row)", "false", "statement:kept += 100;"],
        ["statement:kept += 100;", "none", "loop:for (const row of rows)"],
        ["loop:for (const row of rows)", "false", "return:return kept"],
      ],
      absentEdges: [["continue", "loop:for (const row of rows)"]],
      backEdges: 3,
      warningCount: 0,
    });
  });

  it("break không label trong vòng lặp lồng chỉ thoát vòng TRONG", () => {
    const g = analyzeFixture(FILE, "countRows");

    expectGraph(g, {
      nodeCount: 10,
      edgeCount: 12,
      kinds: { entry: 1, statement: 3, loop: 2, condition: 1, break: 1, return: 1, exit: 1 },
      edges: [
        ["loop:for (const row of rows)", "true", "loop:for (const cell of row)"],
        ["loop:for (const cell of row)", "true", 'condition:cell === "x"'],
        ['condition:cell === "x"', "true", "break"],
        // break -> node ngay sau vòng TRONG
        ["break", "none", "statement:hits += 10;"],
        // dấu ; trong matcher để không dính nhầm "hits += 10;"
        ['condition:cell === "x"', "false", "statement:hits += 1;"],
        ["statement:hits += 1;", "none", "loop:for (const cell of row)"],
        ["loop:for (const cell of row)", "false", "statement:hits += 10;"],
        ["statement:hits += 10;", "none", "loop:for (const row of rows)"],
        ["loop:for (const row of rows)", "false", "return:return hits"],
      ],
      absentEdges: [
        // không được nhảy thẳng ra ngoài vòng NGOÀI
        ["break", "return:return hits"],
      ],
      backEdges: 2,
      warningCount: 0,
    });
  });
});
