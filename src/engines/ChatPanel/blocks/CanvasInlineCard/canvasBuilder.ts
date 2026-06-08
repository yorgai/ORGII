/**
 * HTML document builders for CanvasInlineCard iframe content.
 *
 * All documents are injected via `srcDoc` into sandboxed iframes
 * (sandbox="allow-scripts") — no allow-same-origin, no network access.
 */

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
