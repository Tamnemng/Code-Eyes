import { describe, expect, it } from "vitest";

import { buildWebviewHtml } from "../webview-html";

const html = buildWebviewHtml({
  nonce: "nonce-ABC123",
  cspSource: "vscode-webview://unit-test",
  styleUri: "vscode-webview://unit-test/dist/webview.css",
  scriptUri: "vscode-webview://unit-test/dist/webview.js",
});

describe("buildWebviewHtml", () => {
  it("khóa CSP nghiêm, nonce cho script và runtime stylesheet", () => {
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-nonce-ABC123'");
    expect(html).toContain("style-src vscode-webview://unit-test 'nonce-nonce-ABC123'");
    expect(html).not.toContain("unsafe-inline");
    expect(html).not.toContain("unsafe-eval");
    expect(html).toContain('<script nonce="nonce-ABC123"');
    expect(html).toContain('<style id="cf-runtime-settings" nonce="nonce-ABC123"></style>');
  });

  it("dùng đúng URI đã qua asWebviewUri", () => {
    expect(html).toContain(
      'href="vscode-webview://unit-test/dist/webview.css"',
    );
    expect(html).toContain(
      'src="vscode-webview://unit-test/dist/webview.js"',
    );
  });
});
