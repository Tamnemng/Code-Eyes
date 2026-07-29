import type { GitChangeKind, GitNodeChange } from "../shared/protocol";
import type { FlowNode } from "../shared/types";

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  kind: GitChangeKind;
}

const HUNK_HEADER =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/gm;

/** Đọc hunk `--unified=0`; không phụ thuộc tên file hay nội dung code trong patch. */
export function parseUnifiedDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  for (const match of patch.matchAll(HUNK_HEADER)) {
    const oldStart = Number(match[1]);
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newCount = match[4] === undefined ? 1 : Number(match[4]);
    if (oldCount === 0) {
      hunks.push({ oldStart, oldCount, newStart, newCount, kind: "added" });
      continue;
    }
    if (newCount === 0) {
      hunks.push({ oldStart, oldCount, newStart, newCount, kind: "deleted" });
      continue;
    }

    // Git biểu diễn replacement bằng một hunk -A,+B. Phần cặp được là modified;
    // phần dư phía mới là added, phần dư phía cũ là deleted. Nếu gom cả hunk thành
    // modified thì file +82/-72 không bao giờ có node xanh/đỏ.
    const paired = Math.min(oldCount, newCount);
    hunks.push({
      oldStart,
      oldCount: paired,
      newStart,
      newCount: paired,
      kind: "modified",
    });
    if (newCount > paired) {
      hunks.push({
        oldStart: oldStart + paired,
        oldCount: 0,
        newStart: newStart + paired,
        newCount: newCount - paired,
        kind: "added",
      });
    }
    if (oldCount > paired) {
      hunks.push({
        oldStart: oldStart + paired,
        oldCount: oldCount - paired,
        newStart: newStart + paired,
        newCount: 0,
        kind: "deleted",
      });
    }
  }
  return hunks;
}

function rangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function overlapLineCount(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): number {
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart) + 1);
}

function distanceToLine(node: FlowNode, line: number): number {
  if (line < node.range.startLine) return node.range.startLine - line;
  if (line > node.range.endLine) return line - node.range.endLine;
  return 0;
}

function mergeChange(
  changes: Map<string, GitNodeChange>,
  nodeId: string,
  addedLines: number,
  modifiedLines: number,
  deletedLines: number,
): void {
  const current = changes.get(nodeId);
  const added = (current?.addedLines ?? 0) + addedLines;
  const modified = (current?.modifiedLines ?? 0) + modifiedLines;
  const deleted = (current?.deletedLines ?? 0) + deletedLines;
  const kind: GitChangeKind =
    added > modified && added > deleted
      ? "added"
      : modified > 0 || (added > 0 && deleted > 0)
        ? "modified"
        : deleted > 0
          ? "deleted"
          : "added";
  changes.set(nodeId, {
    nodeId,
    kind,
    addedLines: added,
    modifiedLines: modified,
    deletedLines: deleted,
  });
}

/**
 * Gắn hunk vào node theo range 1-based của source hiện tại.
 * Pure deletion không còn range ở phía mới, nên neo vào node nghiệp vụ gần `newStart` nhất.
 */
export function mapHunksToNodes(
  nodes: readonly FlowNode[],
  hunks: readonly DiffHunk[],
): GitNodeChange[] {
  if (nodes.length === 0 || hunks.length === 0) return [];
  const changes = new Map<string, GitNodeChange>();
  const businessNodes = nodes.filter(
    (node) =>
      node.kind !== "entry" &&
      node.kind !== "exit" &&
      node.kind !== "try" &&
      node.kind !== "catch" &&
      node.kind !== "finally",
  );
  const anchors = businessNodes.length > 0 ? businessNodes : [...nodes];
  const functionStart = Math.min(...nodes.map((node) => node.range.startLine));
  const functionEnd = Math.max(...nodes.map((node) => node.range.endLine));

  for (const hunk of hunks) {
    if (hunk.kind !== "deleted") {
      const endLine = hunk.newStart + hunk.newCount - 1;
      for (const node of nodes) {
        if (
          rangesOverlap(
            node.range.startLine,
            node.range.endLine,
            hunk.newStart,
            endLine,
          )
        ) {
          const lines = overlapLineCount(
            node.range.startLine,
            node.range.endLine,
            hunk.newStart,
            endLine,
          );
          mergeChange(
            changes,
            node.id,
            hunk.kind === "added" ? lines : 0,
            hunk.kind === "modified" ? lines : 0,
            0,
          );
        }
      }
      continue;
    }

    // `+N,0` nghĩa là đoạn xoá nằm ngay trước dòng N+1 / sau dòng N tuỳ vị trí hunk.
    // Cho phép lệch một dòng ở hai biên để bắt xoá ngay đầu/cuối hàm.
    if (hunk.newStart < functionStart - 1 || hunk.newStart > functionEnd + 1) continue;
    const nearest = [...anchors].sort(
      (left, right) =>
        distanceToLine(left, hunk.newStart) - distanceToLine(right, hunk.newStart) ||
        left.range.startLine - right.range.startLine,
    )[0];
    if (nearest !== undefined) {
      mergeChange(changes, nearest.id, 0, 0, hunk.oldCount);
    }
    // Region đang collapse vẫn phải báo có deletion bên trong, nếu không marker đỏ biến mất
    // đúng lúc người dùng cần nó nhất.
    for (const container of nodes) {
      if (
        (container.kind === "try" ||
          container.kind === "catch" ||
          container.kind === "finally") &&
        container.range.startLine <= hunk.newStart &&
        container.range.endLine >= hunk.newStart
      ) {
        mergeChange(changes, container.id, 0, 0, hunk.oldCount);
      }
    }
  }

  return [...changes.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}
