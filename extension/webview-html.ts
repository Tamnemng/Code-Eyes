export interface WebviewHtmlOptions {
  nonce: string;
  cspSource: string;
  styleUri: string;
  scriptUri: string;
}

function attribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Thuần: URI đã qua `asWebviewUri` được truyền vào, hàm này chỉ dựng HTML + CSP. */
export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  const nonce = attribute(options.nonce);
  const cspSource = attribute(options.cspSource);
  const styleUri = attribute(options.styleUri);
  const scriptUri = attribute(options.scriptUri);
  const csp =
    `default-src 'none'; ` +
    `style-src ${cspSource} 'nonce-${nonce}'; ` +
    `script-src 'nonce-${nonce}';`;

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="${styleUri}">
    <style id="cf-runtime-settings" nonce="${nonce}"></style>
    <title>CodeFlow</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}
