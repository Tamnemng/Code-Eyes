import { randomBytes } from "node:crypto";
import path from "node:path";

import * as vscode from "vscode";

import { analyzeFunctionAtCursor } from "../analyzer/typescript";
import type { HostToWebview } from "../shared/protocol";
import type { FlowGraph } from "../shared/types";
import { collectCallSites, type CallSite } from "./call-sites";
import {
  classifyAnalyzeError,
  findNodeRange,
  parseWebviewMessage,
  toAnalyzerPosition,
  toEditorRange,
} from "./pure";
import { buildWebviewHtml } from "./webview-html";

export const CODEFLOW_VIEW_ID = "codeflow.graphView";
const CODEFLOW_CONTAINER_COMMAND = "workbench.view.extension.codeflow";
const READY_TIMEOUT_MS = 3_000;
const HIGHLIGHT_MS = 1_500;

interface GraphFrame {
  graph: FlowGraph;
  uri: vscode.Uri;
  version: number;
  callSites: CallSite[];
}

function isLocationLink(
  definition: vscode.Location | vscode.LocationLink,
): definition is vscode.LocationLink {
  return "targetUri" in definition;
}

/**
 * Một provider duy nhất cho sidebar CodeFlow. Command chỉ cập nhật model rồi focus view;
 * `resolveWebviewView` sở hữu toàn bộ lifecycle iframe/webview.
 */
export class PanelController implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  private ready = false;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private latestMessage: HostToWebview | undefined;
  private frames: GraphFrame[] = [];

  private readonly highlightDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
    borderColor: new vscode.ThemeColor("editor.rangeHighlightBorder"),
    borderStyle: "solid",
    borderWidth: "1px",
  });
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;
  private highlightSelectionDisposable: vscode.Disposable | undefined;
  private highlightedEditor: vscode.TextEditor | undefined;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.releaseView();
    this.view = webviewView;
    this.ready = false;

    const distUri = vscode.Uri.joinPath(this.extensionUri, "dist");
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [distUri],
    };
    const nonce = randomBytes(18).toString("base64");
    webviewView.webview.html = buildWebviewHtml({
      nonce,
      cspSource: webviewView.webview.cspSource,
      styleUri: webviewView.webview
        .asWebviewUri(vscode.Uri.joinPath(distUri, "webview.css"))
        .toString(),
      scriptUri: webviewView.webview
        .asWebviewUri(vscode.Uri.joinPath(distUri, "webview.js"))
        .toString(),
    });

    webviewView.webview.onDidReceiveMessage(
      (raw: unknown) => {
        const message = parseWebviewMessage(raw);
        if (message === undefined) return;
        switch (message.type) {
          case "ready":
            this.ready = true;
            this.clearReadyTimer();
            this.postLatestIfReady();
            break;
          case "revealNode":
            void this.revealNode(message.nodeId);
            break;
          case "openCallee":
            void this.openCallee(message.targetId);
            break;
          case "navigateBack":
            this.navigateBack();
            break;
        }
      },
      undefined,
      this.viewDisposables,
    );
    webviewView.onDidDispose(() => this.releaseView(), undefined, this.viewDisposables);

    this.readyTimer = setTimeout(() => {
      if (this.view !== webviewView || this.ready) return;
      void vscode.window.showErrorMessage(
        "CodeFlow: webview không khởi động được. Mở Developer Tools để xem lỗi.",
      );
    }, READY_TIMEOUT_MS);
  }

  public async visualizeActiveEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      await vscode.window.showWarningMessage("CodeFlow: không có editor đang mở.");
      return;
    }

    const extension = path.extname(editor.document.uri.path).toLowerCase();
    if (extension !== ".ts" && extension !== ".tsx") {
      await vscode.window.showWarningMessage("CodeFlow chỉ hỗ trợ file .ts và .tsx.");
      return;
    }

    const document = editor.document;
    const position = toAnalyzerPosition(editor.selection.active);
    try {
      const sourceText = document.getText();
      const graph = analyzeFunctionAtCursor({
        filePath: document.uri.fsPath,
        line: position.line,
        column: position.column,
        sourceText,
      });
      this.frames = [this.makeFrame(document, sourceText, graph)];
      this.updateGraphMessage();
    } catch (error: unknown) {
      const classified = classifyAnalyzeError(error);
      this.frames = [];
      this.latestMessage = {
        type: "analyzeError",
        code: classified.code,
        message: classified.message,
      };
    }

    // Focus container kiểu Claude/GPT. Nếu view chưa resolve, latestMessage ở trên sẽ được
    // gửi khi script phát `ready`; nếu view đang sống, gửi ngay sau khi focus.
    await vscode.commands.executeCommand(CODEFLOW_CONTAINER_COMMAND);
    this.view?.show(true);
    this.postLatestIfReady();
  }

  private postLatestIfReady(): void {
    if (!this.ready || this.view === undefined || this.latestMessage === undefined) return;
    void this.view.webview.postMessage(this.latestMessage);
  }

  private makeFrame(document: vscode.TextDocument, sourceText: string, graph: FlowGraph): GraphFrame {
    return {
      graph,
      uri: document.uri,
      version: document.version,
      callSites: collectCallSites(document.uri.fsPath, sourceText, graph),
    };
  }

  private currentFrame(): GraphFrame | undefined {
    return this.frames[this.frames.length - 1];
  }

  private updateGraphMessage(): void {
    const frame = this.currentFrame();
    if (frame === undefined) return;
    this.latestMessage = {
      type: "graph",
      graph: frame.graph,
      callees: frame.callSites.map(({ targetId, nodeId, label }) => ({
        targetId,
        nodeId,
        label,
      })),
      navigation: {
        breadcrumbs: this.frames.map(({ graph }) => graph.functionName),
        canGoBack: this.frames.length > 1,
      },
    };
  }

  private navigateBack(): void {
    if (this.frames.length <= 1) return;
    this.frames.pop();
    this.updateGraphMessage();
    this.postLatestIfReady();
  }

  private async openCallee(targetId: string): Promise<void> {
    const frame = this.currentFrame();
    const callSite = frame?.callSites.find((site) => site.targetId === targetId);
    if (frame === undefined || callSite === undefined) {
      await vscode.window.showInformationMessage(
        "CodeFlow: lời gọi này không còn tồn tại trong graph hiện tại.",
      );
      return;
    }

    try {
      const sourceDocument = await vscode.workspace.openTextDocument(frame.uri);
      if (sourceDocument.version !== frame.version) {
        await vscode.window.showInformationMessage(
          "CodeFlow: file gọi hàm đã thay đổi; hãy chạy Visualize Control Flow lại.",
        );
        return;
      }

      const definitions = await vscode.commands.executeCommand<
        readonly (vscode.Location | vscode.LocationLink)[] | undefined
      >(
        "vscode.executeDefinitionProvider",
        frame.uri,
        new vscode.Position(callSite.line - 1, callSite.column),
      );
      const definition = definitions?.find((item) => {
        const uri = isLocationLink(item) ? item.targetUri : item.uri;
        const extension = path.extname(uri.path).toLowerCase();
        return (extension === ".ts" || extension === ".tsx") && !uri.path.endsWith(".d.ts");
      });
      if (definition === undefined) {
        await vscode.window.showInformationMessage(
          `CodeFlow: không tìm thấy implementation TypeScript cho ${callSite.label}.`,
        );
        return;
      }

      const targetUri = isLocationLink(definition) ? definition.targetUri : definition.uri;
      const targetPosition = isLocationLink(definition)
        ? (definition.targetSelectionRange ?? definition.targetRange).start
        : definition.range.start;
      const targetDocument = await vscode.workspace.openTextDocument(targetUri);
      const sourceText = targetDocument.getText();
      const analyzerPosition = toAnalyzerPosition(targetPosition);
      const graph = analyzeFunctionAtCursor({
        filePath: targetDocument.uri.fsPath,
        line: analyzerPosition.line,
        column: analyzerPosition.column,
        sourceText,
      });
      this.frames.push(this.makeFrame(targetDocument, sourceText, graph));
      this.updateGraphMessage();
      this.postLatestIfReady();
    } catch (error: unknown) {
      const classified = classifyAnalyzeError(error);
      await vscode.window.showInformationMessage(
        `CodeFlow: không mở được ${callSite.label}: ${classified.message}`,
      );
    }
  }

  private async revealNode(nodeId: string): Promise<void> {
    const analyzed = this.currentFrame();
    if (analyzed === undefined) {
      await vscode.window.showInformationMessage(
        "CodeFlow: graph không còn khả dụng; hãy chạy Visualize Control Flow lại.",
      );
      return;
    }

    const sourceRange = findNodeRange(analyzed.graph, nodeId);
    if (sourceRange === undefined) {
      await vscode.window.showInformationMessage(
        "CodeFlow: node không còn tồn tại trong graph hiện tại.",
      );
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(analyzed.uri);
      if (document.version !== analyzed.version) {
        await vscode.window.showInformationMessage(
          "CodeFlow: file đã thay đổi; hãy chạy Visualize Control Flow lại trước khi jump.",
        );
        return;
      }

      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
      });
      const plainRange = toEditorRange(sourceRange);
      const range = new vscode.Range(
        plainRange.start.line,
        plainRange.start.character,
        plainRange.end.line,
        plainRange.end.character,
      );
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      this.highlight(editor, range);
    } catch {
      await vscode.window.showInformationMessage(
        "CodeFlow: không mở được editor nguồn; file có thể đã bị đóng, đổi tên hoặc xoá.",
      );
    }
  }

  private highlight(editor: vscode.TextEditor, range: vscode.Range): void {
    this.clearHighlight();
    this.highlightedEditor = editor;
    editor.setDecorations(this.highlightDecoration, [range]);
    this.highlightSelectionDisposable = vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor === editor) this.clearHighlight();
    });
    this.highlightTimer = setTimeout(() => this.clearHighlight(), HIGHLIGHT_MS);
  }

  private clearHighlight(): void {
    if (this.highlightTimer !== undefined) {
      clearTimeout(this.highlightTimer);
      this.highlightTimer = undefined;
    }
    this.highlightSelectionDisposable?.dispose();
    this.highlightSelectionDisposable = undefined;
    this.highlightedEditor?.setDecorations(this.highlightDecoration, []);
    this.highlightedEditor = undefined;
  }

  private clearReadyTimer(): void {
    if (this.readyTimer === undefined) return;
    clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
  }

  private releaseView(): void {
    this.clearReadyTimer();
    for (const disposable of this.viewDisposables.splice(0)) disposable.dispose();
    this.view = undefined;
    this.ready = false;
  }

  public dispose(): void {
    this.releaseView();
    this.clearHighlight();
    this.latestMessage = undefined;
    this.frames = [];
    this.highlightDecoration.dispose();
  }
}
