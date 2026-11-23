const TOKENS = `
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --font-size: 13px; --small: 12px; --heading-size: 16px; --title-size: 20px;
  --title-weight: 600; --heading-weight: 600; --strong-weight: 600;
  --bg: #f5f7fa; --surface: #ffffff; --surface-2: #eef2f6; --text: #182230;
  --muted: #556377; --faint: #748197; --border: #dbe2ea; --border-strong: #c5d0dc;
  --hover: #edf3f8; --active: #e2ebf3; --accent: #236fa9; --accent-soft: #e5f1fa;
  --primary: #236f9f; --primary-hover: #1c5f89; --primary-active: #174f73; --on-primary: #ffffff;
  --primary-border: #236f9f; --primary-hover-border: #1c5f89;
  --btn-text: #182230; --btn-hover-border: #93a8bb; --btn-hover-text: #174f73;
  --focus: #236fa9; --focus-outline: 2px solid #236fa9; --focus-ring: none;
  --ok: #18794e; --ok-soft: #e4f4eb; --warn: #8a5a00; --warn-soft: #fff2d6;
  --fail: #b42318; --fail-soft: #feebe9; --track: #dbe2ea;
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 10px; --radius-pill: 999px;
  --ctl-h: 34px; --ctl-h-sm: 28px; --content-width: 1180px; --gutter: 24px;
  --duration-fast: 120ms; --duration-base: 160ms; --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --shadow: 0 1px 2px rgba(24, 34, 48, .05);
  --float-shadow: 0 10px 30px rgba(24, 34, 48, .16), 0 2px 6px rgba(24, 34, 48, .08);
  --scrim: rgba(24, 34, 48, .45);
`
const DARK = `
  --bg: #11161c; --surface: #192129; --surface-2: #232e38; --text: #e7edf3;
  --muted: #aab7c5; --faint: #8291a2; --border: #33404c; --border-strong: #465565;
  --hover: #24313c; --active: #2c3b48; --accent: #79b9e8; --accent-soft: #20394b;
  --primary: #327fac; --primary-hover: #4092c2; --primary-active: #4b9dcc; --on-primary: #ffffff;
  --primary-border: #327fac; --primary-hover-border: #4092c2;
  --btn-text: #e7edf3; --btn-hover-border: #607487; --btn-hover-text: #a8d5f3;
  --focus: #79b9e8; --focus-outline: 2px solid #79b9e8;
  --ok: #70d6a4; --ok-soft: #193b30; --warn: #e7b95e; --warn-soft: #40351e;
  --fail: #f0958e; --fail-soft: #462725; --track: #33404c;
  --shadow: 0 1px 2px rgba(0, 0, 0, .2);
  --float-shadow: 0 12px 32px rgba(0, 0, 0, .5), 0 2px 6px rgba(0, 0, 0, .3);
  --scrim: rgba(0, 0, 0, .6);
`

const BASE = `
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); font-size: var(--font-size); line-height: 1.5; font-variant-numeric: tabular-nums; }
[hidden] { display: none !important; }
h1, h2, h3, p { margin: 0; }
h1, h2, h3 { letter-spacing: -0.01em; }
h2 { font-size: var(--heading-size); font-weight: var(--heading-weight); }
code { font-family: var(--mono); font-size: var(--small); }
.muted { color: var(--muted); } .small { font-size: var(--small); }
.top-in, .wrap { max-width: var(--content-width); margin: 0 auto; }
.top-in { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px 16px; padding: 28px var(--gutter) 0; }
.top-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.wrap { padding: 20px var(--gutter) 40px; }
.header-bar .top { background: var(--surface); border-bottom: 1px solid var(--border); }
.header-bar .top-in { min-height: 84px; padding-top: 16px; padding-bottom: 16px; }
.brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.brand h1 { font-size: var(--title-size); font-weight: var(--title-weight); line-height: 1.3; }
.tagline { color: var(--muted); font-size: var(--font-size); overflow-wrap: anywhere; }
.logo { display: inline-flex; flex: none; width: 40px; height: 40px; border-radius: var(--radius-xl); background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--border); }
.logo img { display: block; width: 100%; height: 100%; padding: 4px; object-fit: contain; }
.section-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.panel { min-width: 0; padding: 20px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: var(--ctl-h); padding: 0 16px; border-radius: var(--radius-md); border: 1px solid var(--border-strong); background: var(--surface); color: var(--btn-text); font: inherit; font-weight: 500; line-height: 1; cursor: pointer; white-space: nowrap; user-select: none; transition: background-color var(--duration-fast), border-color var(--duration-fast), color var(--duration-fast); }
.btn:hover:not(:disabled) { background: var(--hover); border-color: var(--btn-hover-border); color: var(--btn-hover-text); }
.btn:active:not(:disabled) { background: var(--active); }
.btn-primary { background: var(--primary); border-color: var(--primary-border); color: var(--on-primary); border-radius: var(--radius-pill); }
.btn-primary:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover-border); color: var(--on-primary); }
.btn:disabled { background: var(--surface-2); border-color: var(--border); color: var(--faint); cursor: not-allowed; }
.btn[aria-busy=true]:disabled { cursor: progress; }
.btn-primary[aria-busy=true]:disabled { background: var(--primary); border-color: var(--primary-border); color: var(--on-primary); opacity: .85; }
:where(:focus-visible) { outline: var(--focus-outline); outline-offset: 2px; box-shadow: var(--focus-ring); }
.chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 0 8px; border-radius: var(--radius-pill); background: var(--surface-2); border: 1px solid var(--border); color: var(--muted); font: inherit; font-size: var(--small); line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip-ok { background: var(--ok-soft); border-color: transparent; color: var(--ok); }
.note { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 8px 12px; background: var(--surface-2); border-radius: var(--radius-sm); color: var(--muted); font-size: var(--font-size); }
.note-fail { background: var(--fail-soft); color: var(--fail); }
.note-warn { background: var(--warn-soft); color: var(--warn); }
.note-ok { background: var(--ok-soft); color: var(--ok); }
.dialog { position: fixed; inset: 0; margin: auto; width: min(560px, calc(100vw - 24px)); max-width: none; max-height: calc(100vh - 48px); height: fit-content; padding: 0; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); color: var(--text); box-shadow: var(--float-shadow); }
.dialog[open] { display: flex; flex-direction: column; }
.dialog::backdrop { background: var(--scrim); overflow: hidden; overscroll-behavior: contain; }
.dialog:focus, .dialog:focus-visible { outline: none; }
.dialog-wide { width: min(760px, calc(100vw - 24px)); }
.dlg-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px 4px; }
.dlg-body { display: flex; flex-direction: column; gap: 12px; min-height: 0; padding: 12px 20px 16px; overflow: auto; }
.dlg-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--border); background: var(--surface-2); border-radius: 0 0 var(--radius-xl) var(--radius-xl); }
.sk { display: block; border-radius: var(--radius-md); background: linear-gradient(90deg, var(--surface-2) 25%, var(--track) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: network-shimmer 1.3s ease-in-out infinite; }
.sk-line { height: 12px; margin: 8px 0; } .w50 { width: 50%; } .w70 { width: 70%; }
@keyframes network-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
.foot { margin-top: 28px; text-align: center; overflow-wrap: anywhere; }
@media (prefers-reduced-motion: reduce) { .sk { animation: none; } .btn { transition: none; } }
`

/** Self-contained default look. A host can override every rule through renderNetworkPage's hostStyles. */
export function fallbackNetworkStyles(): string {
  return `:root {${TOKENS}\n color-scheme: light dark;\n}\n@media (prefers-color-scheme: dark) { :root {${DARK}\n}\n}\n${BASE}`
}
