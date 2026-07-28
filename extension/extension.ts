// extension/extension.ts
// Entry của extension host. SCAFFOLDING bước 1 - command đã đăng ký nhưng chưa chạy
// analyzer. Phần thật (tìm hàm chứa con trỏ, panel, revealNode) vào đây ở bước 5.

import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("codeflow.visualizeFlow", () => {
      void vscode.window.showInformationMessage(
        "CodeFlow: chưa cài đặt (scaffolding bước 1).",
      );
    }),
  );
}

export function deactivate(): void {
  // Không có tài nguyên nào ngoài context.subscriptions.
}
