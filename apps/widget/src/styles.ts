// Scoped widget styles (Shadow DOM). Contrast ≥ 4.5:1, touch targets ≥ 44 px (NFR-09).
export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
button, input, select { font: inherit; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid #f59e0b; outline-offset: 2px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.launcher { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; display: inline-flex; align-items: center; gap: 8px;
  min-height: 52px; padding: 0 18px; border: 0; border-radius: 999px; background: #0b5cad; color: #fff; font-weight: 700; font-size: 15px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, .25); cursor: pointer; }
.panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 380px; max-width: calc(100vw - 32px); height: min(640px, calc(100vh - 32px));
  display: flex; flex-direction: column; background: #fff; color: #0f172a; border-radius: 16px; overflow: hidden; box-shadow: 0 12px 40px rgba(15, 23, 42, .3); }
@media (max-width: 480px) { .panel { right: 0; bottom: 0; width: 100vw; max-width: 100vw; height: 100dvh; border-radius: 0; } }
.head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 12px 16px; background: #0b5cad; color: #fff; }
.head > div { flex: 1; }
.title { font-weight: 800; font-size: 16px; }
.subtitle { font-size: 12px; opacity: .95; }
.icon { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; border: 0; border-radius: 10px; background: transparent; color: inherit; cursor: pointer; }
.icon:hover:not(:disabled) { background: rgba(15, 23, 42, .08); }
.head .icon:hover { background: rgba(255,255,255,.15); }
.icon.on { color: #0b5cad; background: #e0ecfa; }
.icon:disabled { cursor: default; }
.list { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; background: #f1f5f9; }
.hint { margin: 8px 0; font-size: 14px; color: #475569; }
.msg { max-width: 88%; padding: 8px 12px; border-radius: 12px; font-size: 14px; line-height: 1.45; }
.msg p { margin: 0; white-space: pre-wrap; }
.msg.mine { align-self: flex-end; background: #0b5cad; color: #fff; }
.msg.theirs { align-self: flex-start; background: #fff; border: 1px solid #cbd5e1; }
.msg.retracted { border-style: dashed; border-color: #b91c1c; background: #fee2e2; color: #7f1d1d; }
.who { font-size: 12px; font-weight: 700; margin-bottom: 2px; opacity: .9; }
.src { margin-top: 6px !important; font-size: 12px; color: #475569; }
.fb { display: flex; align-items: center; gap: 2px; margin-top: 4px; color: #475569; }
.thanks { font-size: 12px; margin-left: 4px; }
.btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip { min-height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid #0b5cad; background: #fff; color: #0b5cad; font-weight: 600; cursor: pointer; }
.card { align-self: stretch; padding: 10px 12px; border-radius: 12px; font-size: 14px; }
.card p { margin: 4px 0 0; }
.card-title { font-weight: 800; font-size: 13px; }
.handoff { background: #e0ecfa; border: 1px solid #93c5fd; color: #0c3c78; }
.promise { font-weight: 600; }
.reminder { background: #fef3c7; border: 1px solid #f59e0b; color: #78350f; }
.reminder summary { cursor: pointer; margin-top: 6px; min-height: 44px; display: flex; align-items: center; font-weight: 600; text-decoration: underline; }
.typing { font-size: 13px; color: #475569; margin: 0; }
.error { margin: 0; padding: 8px 12px; background: #fee2e2; color: #b91c1c; font-size: 13px; }
.actions { display: flex; align-items: center; gap: 8px; padding: 8px 12px 0; background: #fff; }
.human { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 12px; border-radius: 10px; border: 1px solid #0b5cad; background: #fff; color: #0b5cad; font-weight: 700; cursor: pointer; }
.link { margin-left: auto; min-height: 44px; padding: 0 8px; border: 0; background: transparent; color: #0b5cad; text-decoration: underline; cursor: pointer; font-size: 14px; }
.composer { display: flex; gap: 6px; padding: 8px 12px 12px; background: #fff; }
.composer input { flex: 1; min-width: 0; min-height: 44px; padding: 0 12px; border: 1px solid #94a3b8; border-radius: 10px; font-size: 16px; color: #0f172a; }
.send { min-width: 44px; min-height: 44px; border: 0; border-radius: 10px; background: #0b5cad; color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.send:disabled { opacity: .5; cursor: not-allowed; }
.consent { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; font-size: 14px; }
.consent h2 { margin: 0; font-size: 18px; }
.consent p { margin: 0; line-height: 1.5; }
.check { display: flex; gap: 10px; align-items: flex-start; min-height: 44px; padding: 8px; border: 1px solid #cbd5e1; border-radius: 10px; cursor: pointer; }
.check input { width: 20px; height: 20px; margin: 2px 0 0; flex: none; }
.small { font-size: 12px; color: #475569; }
.primary { min-height: 48px; border: 0; border-radius: 10px; background: #0b5cad; color: #fff; font-weight: 700; font-size: 15px; cursor: pointer; }
.primary:disabled { opacity: .6; }
.upload { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: #fff; border-top: 1px solid #cbd5e1; font-size: 14px; }
.upload select, .upload input[type=file] { min-height: 44px; padding: 8px; border: 1px solid #94a3b8; border-radius: 10px; }
`;
