// extension/extension.ts
// Entry mỏng của extension host. Mọi lifecycle panel nằm trong `panel-controller.ts`;
// logic thuần có test nằm trong `pure.ts` và `webview-html.ts`.

import * as vscode from "vscode";

import { CODEFLOW_VIEW_ID, PanelController } from "./panel-controller";

export function activate(context: vscode.ExtensionContext): void {
  const controller = new PanelController(context.extensionUri);
  context.subscriptions.push(
    controller,
    vscode.window.registerWebviewViewProvider(CODEFLOW_VIEW_ID, controller, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
    vscode.commands.registerCommand("codeflow.visualizeFlow", () =>
      controller.visualizeActiveEditor(),
    ),
  );
}

export function deactivate(): void {
  // VS Code dispose mọi resource đã đăng ký trong context.subscriptions.
}
