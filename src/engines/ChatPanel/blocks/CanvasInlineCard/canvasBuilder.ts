/**
 * HTML document builders for CanvasInlineCard iframe content.
 *
 * All documents are injected via `srcDoc` into sandboxed iframes
 * (sandbox="allow-scripts") — no allow-same-origin, no network access.
 */
import type { A2UIElement } from "./types";

const BASE_STYLES = `
  *,*::before,*::after{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:#141420;color:#e2e2e8;
    font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    font-size:14px;line-height:1.6;min-height:100%;overflow-x:hidden;}
  a{color:#7c9ef7;text-decoration:none;}
  a:hover{text-decoration:underline;}
  pre,code{font-family:monospace;
    background:rgba(255,255,255,.06);padding:2px 5px;border-radius:4px;font-size:0.875em;}
  pre{padding:12px 16px;overflow-x:auto;border-radius:6px;
    border:1px solid rgba(255,255,255,.08);}
  pre code{background:none;padding:0;}
  img{max-width:100%;height:auto;border-radius:4px;}
  button{cursor:pointer;}
  ::-webkit-scrollbar{width:6px;height:6px;}
  ::-webkit-scrollbar-track{background:transparent;}
  ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:3px;}
`;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wrap arbitrary HTML in the sandbox template. */
export function buildHtmlDocument(html: string): string {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${BASE_STYLES}</style>
<script>
window.addEventListener('message',(e)=>{
  if(e.data?.type==='canvas_eval'&&e.data.javascript){
    try{eval(e.data.javascript);}catch(err){console.error('[canvas]',err);}
  }
});
</script>
</head><body style="padding:16px">${html}</body></html>`;
}

/** Build an A2UI document from an array of JSONL element strings. */
export function buildA2UIDocument(lines: string[]): string {
  const elements = lines.map((line) => {
    try {
      const el = JSON.parse(line) as A2UIElement;
      return renderA2UIElement(el);
    } catch {
      return `<p>${escapeHtml(line)}</p>`;
    }
  });
  return buildHtmlDocument(elements.join("\n"));
}

function renderA2UIElement(el: A2UIElement): string {
  const safeStyle = el.style ? escapeHtml(el.style) : "";
  const safeContent = el.content ?? "";

  switch (el.type) {
    case "heading":
      return `<h2 style="margin:0 0 8px;font-size:1.15em;font-weight:600;color:#f0f0f5;${safeStyle}">${escapeHtml(safeContent)}</h2>`;

    case "text":
      return `<p style="margin:0 0 10px;${safeStyle}">${escapeHtml(safeContent)}</p>`;

    case "code":
      return `<pre style="${safeStyle}"><code>${escapeHtml(safeContent)}</code></pre>`;

    case "html":
      // Trusted: agent deliberately opted into raw HTML via type="html"
      return `<div style="${safeStyle}">${safeContent}</div>`;

    case "image":
      return `<img src="${escapeHtml(safeContent)}" style="${safeStyle}" loading="lazy" />`;

    case "button":
      return `<button style="display:inline-flex;align-items:center;padding:6px 14px;
        border-radius:6px;border:1px solid rgba(255,255,255,.2);
        background:rgba(124,158,247,.15);color:#7c9ef7;font-size:13px;
        font-weight:500;margin:4px 0;${safeStyle}">${escapeHtml(safeContent)}</button>`;

    case "divider":
      return `<hr style="border:0;border-top:1px solid rgba(255,255,255,.1);margin:14px 0;${safeStyle}">`;

    case "list": {
      const items = Array.isArray(el.items)
        ? el.items
            .map(
              (item) =>
                `<li style="margin-bottom:4px">${escapeHtml(String(item))}</li>`
            )
            .join("")
        : "";
      return `<ul style="margin:0 0 10px;padding-left:20px;${safeStyle}">${items}</ul>`;
    }

    default:
      return `<div style="${safeStyle}">${escapeHtml(safeContent)}</div>`;
  }
}
