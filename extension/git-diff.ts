import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { GitNodeChange } from "../shared/protocol";
import type { FlowNode } from "../shared/types";
import { mapHunksToNodes, parseUnifiedDiff } from "./git-diff-model";

interface ProcessResult {
  code: number;
  stdout: string;
}

function runGit(cwd: string, args: readonly string[]): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    // Dùng StringDecoder nội bộ của stream. `Buffer.toString()` từng chunk làm vỡ ký tự UTF-8
    // nếu một chữ tiếng Việt nằm đúng biên 64 KB, khiến file lớn bị diff giả.
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => resolve({ code: -1, stdout: "" }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout }));
  });
}

function sourceLineCount(source: string): number {
  if (source === "") return 0;
  const normalized = source.replace(/\r\n/g, "\n");
  const count = normalized.split("\n").length;
  return normalized.endsWith("\n") ? count - 1 : count;
}

function normalizedLines(source: string): string {
  return source.replace(/\r\n?/g, "\n");
}

/**
 * So sánh buffer hiện tại với HEAD. Temp files cho phép Git tự dùng diff algorithm của nó,
 * tránh giữ ma trận LCS khổng lồ cho source legacy hàng chục nghìn dòng.
 */
export async function gitChangesForSource(
  filePath: string,
  currentSource: string,
  nodes: readonly FlowNode[],
): Promise<GitNodeChange[]> {
  const directory = path.dirname(filePath);
  const rootResult = await runGit(directory, ["rev-parse", "--show-toplevel"]);
  if (rootResult.code !== 0) return [];
  const repositoryRoot = rootResult.stdout.trim();
  if (repositoryRoot === "") return [];

  const relative = path.relative(repositoryRoot, filePath);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return [];
  const gitPath = relative.split(path.sep).join("/");
  const head = await runGit(repositoryRoot, ["show", `HEAD:${gitPath}`]);
  if (head.code !== 0) {
    const lines = sourceLineCount(currentSource);
    return lines === 0
      ? []
      : mapHunksToNodes(nodes, [
          {
            oldStart: 0,
            oldCount: 0,
            newStart: 1,
            newCount: lines,
            kind: "added",
          },
        ]);
  }

  const tempRoot = await mkdtemp(path.join(tmpdir(), "codeflow-diff-"));
  const beforePath = path.join(tempRoot, "before.txt");
  const afterPath = path.join(tempRoot, "after.txt");
  try {
    await Promise.all([
      writeFile(beforePath, normalizedLines(head.stdout), "utf8"),
      writeFile(afterPath, normalizedLines(currentSource), "utf8"),
    ]);
    const diff = await runGit(repositoryRoot, [
      "diff",
      "--no-index",
      "--unified=0",
      "--no-color",
      "--no-ext-diff",
      "--text",
      "--",
      beforePath,
      afterPath,
    ]);
    if (diff.code === 0) return [];
    if (diff.code !== 1) return [];
    return mapHunksToNodes(nodes, parseUnifiedDiff(diff.stdout));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
