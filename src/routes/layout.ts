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
input,select{width:100%;font:inherit;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg)}
.row{display:flex;gap:10px}.row>*{flex:1;min-width:0}
.check{display:flex;gap:10px;align-items:flex-start;margin-top:16px}.check input{width:auto;margin-top:4px}
button,.btn{display:block;width:100%;text-align:center;font:600 16px/1 inherit;padding:15px;border:0;border-radius:12px;background:var(--accent);color:var(--bg);text-decoration:none;margin-top:16px;cursor:pointer}
.btn.secondary{background:transparent;color:var(--fg);border:1px solid var(--line)}
.big{font-size:40px;font-weight:700;margin:4px 0}.qr svg{width:100%;height:auto;background:#fff;border-radius:12px;padding:12px}
.err{color:#b3261e}.ok{color:#1b7f3b}[dir=rtl]{text-align:right}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-block;width:auto;margin:0;padding:11px 14px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--fg);font:500 15px/1.1 inherit}
.chip[aria-pressed=true]{background:var(--accent);color:var(--bg);border-color:var(--accent)}
.topbar{display:flex;justify-content:flex-end}
.btn.small{display:inline-block;width:auto;padding:9px 14px;font-size:14px;margin:0}
.stack{display:grid;gap:8px}.stack .btn{margin:0}
.btn.armed{background:#b3261e;color:#fff;border-color:#b3261e}
.langbar{display:flex;justify-content:flex-end;margin-bottom:4px}.langbar a{font-size:14px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:8px 0;border-bottom:1px solid var(--line);vertical-align:top}td.num{text-align:end;white-space:nowrap;padding-inline-start:12px}
.linkbox{font:14px/1.4 ui-monospace,Menlo,Consolas,monospace;background:var(--bg);border:1px dashed var(--line);padding:10px;border-radius:10px;word-break:break-all;direction:ltr;text-align:left}
.list{list-style:none;padding:0;margin:8px 0}.list li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)}
.foot{display:flex;flex-wrap:wrap;gap:16px;justify-content:center;margin-top:24px;font-size:14px}.foot a{color:var(--muted)}
.btn.danger{background:#b3261e;color:#fff}
.banner{background:#fff1c2;color:#5a4300;border-radius:12px;padding:11px 14px;margin:12px 0;font-weight:600}
@media (prefers-color-scheme:dark){.banner{background:#3a2f0b;color:#f3d77a}}
`

export function page(title: string, body: Body, opts: { lang?: string; head?: string } = {}) {
  return html`<!doctype html>
<html lang="${opts.lang ?? 'en'}" dir="${opts.lang === 'ar' ? 'rtl' : 'ltr'}">
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
