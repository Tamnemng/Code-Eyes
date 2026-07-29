import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { FlowNode } from "../../shared/types";
import { gitChangesForSource } from "../git-diff";

const temporaryRepositories: string[] = [];

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore", windowsHide: true });
}

function repositoryWith(source: string): { root: string; filePath: string } {
  const root = mkdtempSync(path.join(tmpdir(), "codeflow-git-test-"));
  temporaryRepositories.push(root);
  const filePath = path.join(root, "demo.ts");
  writeFileSync(filePath, source, "utf8");
  git(root, "init");
  git(root, "config", "user.name", "CodeFlow Test");
  git(root, "config", "user.email", "codeflow@example.invalid");
  git(root, "add", "demo.ts");
  git(root, "commit", "-m", "base");
  return { root, filePath };
}

afterEach(() => {
  for (const root of temporaryRepositories.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("gitChangesForSource", () => {
  it("so buffer chưa save trực tiếp với HEAD, nhận cả modified và added", async () => {
    const base = ["function demo() {", "  old();", "  keep();", "}"].join("\n");
    // Buffer Windows dùng CRLF trong khi blob Git dùng LF: khác EOL không được tô cả function.
    const current = [
      "function demo() {",
      "  changed();",
      "  keep();",
      "  added();",
      "}",
    ].join("\r\n");
    const { filePath } = repositoryWith(base);
    const nodes: FlowNode[] = [
      {
        id: "modified",
        kind: "statement",
        label: "changed",
        code: "changed();",
        range: { startLine: 2, startCol: 2, endLine: 2, endCol: 12 },
        confidence: "certain",
      },
      {
        id: "added",
        kind: "statement",
        label: "added",
        code: "added();",
        range: { startLine: 4, startCol: 2, endLine: 4, endCol: 10 },
        confidence: "certain",
      },
    ];

    await expect(gitChangesForSource(filePath, current, nodes)).resolves.toEqual([
      { nodeId: "added", kind: "added", addedLines: 1, modifiedLines: 0, deletedLines: 0 },
      {
        nodeId: "modified",
        kind: "modified",
        addedLines: 0,
        modifiedLines: 1,
        deletedLines: 0,
      },
    ]);
  });

  it("file chưa có trong HEAD được coi là mới thêm toàn bộ", async () => {
    const { root } = repositoryWith("const committed = true;\n");
    const filePath = path.join(root, "new-file.ts");
    const source = "const fresh = true;\n";
    const nodes: FlowNode[] = [
      {
        id: "fresh",
        kind: "statement",
        label: "fresh",
        code: source.trim(),
        range: { startLine: 1, startCol: 0, endLine: 1, endCol: 19 },
        confidence: "certain",
      },
    ];

    await expect(gitChangesForSource(filePath, source, nodes)).resolves.toEqual([
      { nodeId: "fresh", kind: "added", addedLines: 1, modifiedLines: 0, deletedLines: 0 },
    ]);
  });

  it("không tạo diff giả khi ký tự UTF-8 nằm ở biên chunk stdout của file lớn", async () => {
    const prefix = `${"a".repeat(65_535)}ộ\n`;
    const base = `${prefix}old();\n`;
    const current = `${prefix}changed();\n`;
    const { filePath } = repositoryWith(base);
    const nodes: FlowNode[] = [
      {
        id: "changed",
        kind: "statement",
        label: "changed",
        code: "changed();",
        range: { startLine: 2, startCol: 0, endLine: 2, endCol: 10 },
        confidence: "certain",
      },
    ];

    await expect(gitChangesForSource(filePath, current, nodes)).resolves.toEqual([
      {
        nodeId: "changed",
        kind: "modified",
        addedLines: 0,
        modifiedLines: 1,
        deletedLines: 0,
      },
    ]);
  });
});
