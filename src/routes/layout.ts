import { html, raw } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'

type Body = HtmlEscapedString | Promise<HtmlEscapedString>

const CSS = `
:root{--bg:#f6f6f4;--fg:#111;--muted:#666;--card:#fff;--line:#e3e3df;--accent:#111}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#f2f2f2;--muted:#9a9a9a;--card:#1b1b1b;--line:#2c2c2c;--accent:#f2f2f2}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 -apple-system,system-ui,"Segoe UI",Tahoma,sans-serif}
main{max-width:440px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:24px;margin:8px 0 4px}p{margin:8px 0}.muted{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin:16px 0}
label{display:block;font-size:14px;margin:14px 0 6px}
input{width:100%;font:inherit;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg)}
.check{display:flex;gap:10px;align-items:flex-start;margin-top:16px}.check input{width:auto;margin-top:4px}
button,.btn{display:block;width:100%;text-align:center;font:600 16px/1 inherit;padding:15px;border:0;border-radius:12px;background:var(--accent);color:var(--bg);text-decoration:none;margin-top:16px;cursor:pointer}
.btn.secondary{background:transparent;color:var(--fg);border:1px solid var(--line)}
.big{font-size:40px;font-weight:700;margin:4px 0}.qr svg{width:100%;height:auto;background:#fff;border-radius:12px;padding:12px}
.err{color:#b3261e}.ok{color:#1b7f3b}[dir=rtl]{text-align:right}
`

export function page(title: string, body: Body, opts: { lang?: string; head?: string } = {}) {
  return html`<!doctype html>
<html lang="${opts.lang ?? 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${raw(CSS)}</style>
${raw(opts.head ?? '')}
</head>
<body><main>${body}</main></body>
</html>`
}
