import { describe, expect, it } from "vitest";

import type { FlowNode } from "../../shared/types";
import { mapHunksToNodes, parseUnifiedDiff } from "../git-diff-model";

const nodes: FlowNode[] = [
  {
    id: "entry",
    kind: "entry",
    label: "entry",
    code: "",
    range: { startLine: 10, startCol: 0, endLine: 10, endCol: 0 },
    confidence: "certain",
  },
  {
    id: "a",
    kind: "statement",
    label: "a",
    code: "a();",
    range: { startLine: 11, startCol: 0, endLine: 12, endCol: 4 },
    confidence: "certain",
  },
  {
    id: "b",
    kind: "condition",
    label: "b",
    code: "if (b) c();",
    range: { startLine: 15, startCol: 0, endLine: 17, endCol: 1 },
    confidence: "certain",
  },
  {
    id: "exit",
    kind: "exit",
    label: "exit",
    code: "",
    range: { startLine: 18, startCol: 0, endLine: 18, endCol: 0 },
    confidence: "certain",
  },
];

describe("parseUnifiedDiff", () => {
  it("phân biệt add, modify và delete từ hunk unified=0", () => {
    const patch = [
      "@@ -3,0 +4,2 @@",
      "+new",
      "+newer",
      "@@ -8,2 +10,3 @@",
      "-old",
      "+changed",
      "@@ -20,4 +22,0 @@",
      "-gone",
    ].join("\n");

    expect(parseUnifiedDiff(patch)).toEqual([
      { oldStart: 3, oldCount: 0, newStart: 4, newCount: 2, kind: "added" },
      { oldStart: 8, oldCount: 2, newStart: 10, newCount: 2, kind: "modified" },
      { oldStart: 10, oldCount: 0, newStart: 12, newCount: 1, kind: "added" },
      { oldStart: 20, oldCount: 4, newStart: 22, newCount: 0, kind: "deleted" },
    ]);
  });

  it("replacement có phía cũ dài hơn sinh modified và deletion marker riêng", () => {
    expect(parseUnifiedDiff("@@ -20,4 +20 @@\n-old\n+new")).toEqual([
      { oldStart: 20, oldCount: 1, newStart: 20, newCount: 1, kind: "modified" },
      { oldStart: 21, oldCount: 3, newStart: 21, newCount: 0, kind: "deleted" },
    ]);
  });
});

describe("mapHunksToNodes", () => {
  it("tô xanh node mới và màu modified cho node sửa theo range hiện tại", () => {
    expect(
      mapHunksToNodes(nodes, [
        { oldStart: 3, oldCount: 0, newStart: 11, newCount: 2, kind: "added" },
        { oldStart: 8, oldCount: 2, newStart: 16, newCount: 1, kind: "modified" },
      ]),
    ).toEqual([
      { nodeId: "a", kind: "added", addedLines: 2, modifiedLines: 0, deletedLines: 0 },
      { nodeId: "b", kind: "modified", addedLines: 0, modifiedLines: 1, deletedLines: 0 },
    ]);
  });

  it("đoạn đã xoá neo đỏ vào node nghiệp vụ gần nhất, không giả tạo FlowNode mới", () => {
    expect(
      mapHunksToNodes(nodes, [
        { oldStart: 13, oldCount: 3, newStart: 13, newCount: 0, kind: "deleted" },
      ]),
    ).toEqual([
      { nodeId: "a", kind: "deleted", addedLines: 0, modifiedLines: 0, deletedLines: 3 },
    ]);
  });

  it("node có phần lớn dòng mới dùng màu xanh nhưng vẫn giữ badge vàng cho dòng sửa", () => {
    expect(
      mapHunksToNodes(
        [
          {
            ...(nodes[1] as FlowNode),
            range: { startLine: 11, startCol: 0, endLine: 15, endCol: 1 },
          },
        ],
        [
        { oldStart: 11, oldCount: 1, newStart: 11, newCount: 1, kind: "modified" },
        { oldStart: 12, oldCount: 0, newStart: 12, newCount: 4, kind: "added" },
        ],
      ),
    ).toEqual([
      { nodeId: "a", kind: "added", addedLines: 4, modifiedLines: 1, deletedLines: 0 },
    ]);
  });

  it("bỏ deletion ngoài function và không throw khi không có hunk", () => {
    expect(
      mapHunksToNodes(nodes, [
        { oldStart: 40, oldCount: 2, newStart: 40, newCount: 0, kind: "deleted" },
      ]),
    ).toEqual([]);
    expect(mapHunksToNodes(nodes, [])).toEqual([]);
  });
});
