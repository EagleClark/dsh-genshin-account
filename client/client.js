// dsh-genshin-account — browser half (web client module bundle).
//
// Format: window.__ModuleLoader__.load({ id, factory }) — the boot protocol's
// registration handoff. `id` must equal the package name; the factory gets a
// synchronous `require` whose seed table includes react.
//
// The page is two slot registrations with the same string key:
//   - `sidebar.panellist` renders the icon (props: { size, active } only — the
//     sidebar owns the button and the click),
//   - `main` (keyed by the same id) renders the panel.
//
// Two kinds of traffic with the host half:
//   - reads: same-origin JSON routes under /dsh-genshin-account (summary,
//     character, artifacts, weapons, state, sync, upload-good),
//   - writes: this plugin's own Config through `ctx.configForms`, which rides
//     the settings document's revision fence instead of a private namespace.
window.__ModuleLoader__.load({ id: "dsh-genshin-account", factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

  var React = require("react");
  var h = React.createElement;

  var PKG = "dsh-genshin-account";
  var PANEL_ID = "genshin";
  var API = "/dsh-genshin-account";
  /** Memoised loader promise for the geetest v3 widget script. */
  var gtScriptPromise = null;
  // Package name == Loader row id == the Config entry this bundle edits.
  var ENTRY_ID = PKG;
  // The plugin's own client context, captured in apply(): the page component is
  // defined at module scope, so it reaches the Config form through this rather
  // than through slot props (which carry only the framework shares).
  var clientCtx = null;

  var SOURCE_LABEL = { miyoushe: "米游社（扫码登录）" };

  /** The plugin has exactly one data source now: the miHoYo record API. */
  var SOURCE_CARD = {
    id: "miyoushe",
    name: "米游社 · 扫码登录",
    badge: "唯一数据源",
    reads: "账号概览 + 全部角色 + 天赋/命座 + 武器 + 圣遗物（含每条副词条与强化值）",
    limits: "读取前需要通过一次 geetest 滑块（官方要求，retcode 1034）；通过后 x-rpc-challenge 会一直复用到过期",
    servers: "国服（cn_gf01 天空岛 / cn_qd01 世界树）",
  };

  /** The three steps the setup pane walks through. */
  var GUIDES = {
    miyoushe: [
      "填国服 UID（1/2 开头天空岛，5 开头世界树）",
      "点「生成二维码」，用手机米游社 App 扫码并在手机上确认——会话就归插件所有了",
      "点「开始验证」拖一次滑块；通过后插件自动换 x-rpc-challenge 并读取角色、武器、圣遗物",
    ],
  };

  var SOURCES = [SOURCE_CARD];


  // ── stylesheet ───────────────────────────────────────────────────────────
  var CSS = [
    // Plugin-scoped palette. Light values on :root, dark overrides on the shell's
    // dark marker, so every accent below works in both themes.
    ":root{--dga-gold:#a8752a;--dga-gold-soft:#f6ecd8;--dga-blue:#2f6fbf;--dga-green:#2c8a55;--dga-red:#bd4b47;--dga-purple:#6a5cb5;--dga-bar:#8aa4c8;--dga-track:rgba(15,17,21,.08);--dga-el-pyro:#c8551f;--dga-el-hydro:#1a7ab8;--dga-el-anemo:#2f9578;--dga-el-electro:#7d4fa3;--dga-el-cryo:#3f93b8;--dga-el-geo:#b07d10;--dga-el-dendro:#5c8a1e;--dga-el-none:#6b7280}",
    "body[data-ds-dark-theme]{--dga-gold:#d8b566;--dga-gold-soft:#3a3020;--dga-blue:#6aa8f0;--dga-green:#5ec27f;--dga-red:#e08585;--dga-purple:#9a8ede;--dga-bar:#6f8cb8;--dga-track:rgba(255,255,255,.10);--dga-el-pyro:#ef7938;--dga-el-hydro:#4cc2f1;--dga-el-anemo:#74c2a8;--dga-el-electro:#af8ec1;--dga-el-cryo:#9fd6e3;--dga-el-geo:#fab72e;--dga-el-dendro:#a5c83b;--dga-el-none:#8b93a5}",
    ".dga-root{height:100%;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}",
    ".dga-head{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:0 0 auto}",
    ".dga-title{font-size:15px;font-weight:600;margin:0}",
    ".dga-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}",
    ".dga-grow{flex:1;min-width:0}",
    ".dga-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:6px 14px;min-height:32px;font-size:13px;line-height:1.5;transition:transform .12s ease,color .12s ease,border-color .12s ease}",
    ".dga-btn:active:not(:disabled){transform:translateY(1px)}",
    ".dga-btn:focus-visible{outline:2px solid var(--dga-gold);outline-offset:2px}",
    ".dga-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
    ".dga-btn:disabled{opacity:.45;cursor:default}",
    ".dga-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:transparent}",
    ".dga-tabs{display:flex;gap:4px;padding:10px 20px 0;flex:0 0 auto;border-bottom:1px solid var(--dsw-alias-border-l2)}",
    ".dga-tab{appearance:none;font:inherit;cursor:pointer;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--dsw-alias-label-tertiary);padding:8px 12px 9px;min-height:36px;font-size:13px;transition:color .12s ease}",
    ".dga-tab:focus-visible{outline:2px solid var(--dga-gold);outline-offset:-2px}",
    ".dga-tab:hover{color:var(--dsw-alias-label-primary)}",
    ".dga-tab-on{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary)}",
    ".dga-body{flex:1;min-height:0;display:flex;overflow:hidden}",
    // Thin, themed scrollbars: polished surface, still fully scrollable.
    ".dga-scroll{overflow:auto;padding:16px 20px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-label-dimmed) transparent}",
    ".dga-scroll::-webkit-scrollbar{width:8px;height:8px}",
    ".dga-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-label-dimmed);border-radius:999px;opacity:.5}",
    ".dga-scroll::-webkit-scrollbar-track{background:transparent}",
    ".dga-col-list{width:260px;flex:0 0 auto;border-right:1px solid var(--dsw-alias-border-l2);overflow:auto;padding:10px}",
    ".dga-col-detail{flex:1;min-width:0;overflow:auto;padding:16px 20px}",
    ".dga-searcher{width:100%;box-sizing:border-box;font:inherit;font-size:13px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;margin-bottom:8px}",
    ".dga-row{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;border:1px solid transparent}",
    ".dga-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
    ".dga-row-on{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}",
    ".dga-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}",
    ".dga-rowname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".dga-rowlv{color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}",
    ".dga-chipRow{display:flex;gap:6px;flex-wrap:wrap;padding:2px 0 8px}",
    ".dga-chipBtn{appearance:none;font:inherit;font-size:12px;cursor:pointer;padding:3px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-tertiary)}",
    ".dga-chipBtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
    ".dga-chipBtnOn{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
    ".dga-cards{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px}",
    ".dga-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 16px;min-width:120px}",
    ".dga-cardV{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}",
    ".dga-cardL{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-top:2px}",
    ".dga-sec{margin:0 0 8px;font-size:13px;font-weight:600}",
    ".dga-block{margin-bottom:20px}",
    ".dga-chip{display:inline-flex;align-items:center;gap:5px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 9px;font-size:11px;line-height:17px;margin-right:6px}",
    ".dga-table{width:100%;border-collapse:collapse;font-size:12.5px}",
    ".dga-table th{text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary);padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);white-space:nowrap}",
    ".dga-table td{padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}",
    ".dga-table tr:last-child td{border-bottom:none}",
    ".dga-num{font-variant-numeric:tabular-nums;white-space:nowrap}",
    ".dga-empty{color:var(--dsw-alias-label-tertiary);padding:32px 4px;line-height:1.8}",
    "@keyframes dgaPulse{0%,100%{opacity:.55}50%{opacity:1}}",
    ".dga-skel{border-radius:8px;background:var(--dsw-alias-bg-layer-3);animation:dgaPulse 1.4s ease-in-out infinite}",
    ".dga-skelRow{display:flex;align-items:center;gap:10px;padding:7px 8px}",
    ".dga-skelStack{display:flex;flex-direction:column;gap:14px;padding:18px 20px}",
    ".dga-err{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;padding:12px 16px;color:var(--dsw-alias-label-primary);line-height:1.7;white-space:pre-wrap}",
    ".dga-grade{font-weight:600}",
    ".dga-muted{color:var(--dsw-alias-label-tertiary)}",
    ".dga-statline{display:flex;flex-wrap:wrap;gap:6px 20px;margin:6px 0 0}",
    ".dga-statline > * + *{position:relative}",
    ".dga-statline > * + *::before{content:'';position:absolute;left:-11px;top:50%;width:3px;height:3px;border-radius:50%;background:var(--dsw-alias-label-dimmed);transform:translateY(-50%)}",
    ".dga-stat{display:flex;gap:6px;align-items:baseline}",
    ".dga-statK{color:var(--dsw-alias-label-tertiary);font-size:12px}",
    ".dga-statV{font-variant-numeric:tabular-nums}",
    ".dga-effect{color:var(--dsw-alias-label-secondary);line-height:1.7;margin:2px 0 0;padding-left:12px}",

    // setup wizard
    ".dga-wizard{max-width:780px}",
    ".dga-setCard{margin-bottom:14px;padding:16px 18px;border-radius:14px}",
    ".dga-setRow{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}",
    ".dga-status{margin-left:auto;font-size:11.5px;color:var(--dsw-alias-label-tertiary);padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2)}",
    ".dga-statusOn{color:var(--dga-gold);border-color:var(--dga-line-strong);background:color-mix(in srgb, var(--dga-gold) 12%, transparent)}",
    ".dga-qrBox{margin-top:12px;padding:12px;background:#fff;width:280px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.18)}",
    ".dga-srcList{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}",
    ".dga-src{display:flex;gap:12px;align-items:flex-start;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;cursor:pointer;text-align:left;font:inherit;color:inherit;width:100%}",
    ".dga-src:hover{border-color:var(--dsw-alias-label-dimmed)}",
    ".dga-src-on{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}",
    ".dga-radio{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);flex:0 0 auto;margin-top:3px;box-sizing:border-box}",
    ".dga-radio-on{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 3px var(--dsw-alias-brand-primary)}",
    ".dga-srcName{font-weight:600;font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
    ".dga-srcDesc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6;margin-top:3px}",
    ".dga-srcLimit{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;margin-top:2px}",
    ".dga-badge{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500}",
    ".dga-badgeOk{background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-bg-layer-3)}",
    ".dga-field{margin-bottom:14px}",
    ".dga-label{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;letter-spacing:.02em;font-weight:500;margin:10px 0 6px}",
    ".dga-input{width:100%;box-sizing:border-box;font:inherit;font-size:13px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 10px}",
    ".dga-input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
    ".dga-textarea{min-height:64px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5}",
    ".dga-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;margin:5px 0 0}",
    ".dga-steps{margin:8px 0 0;padding-left:20px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.9}",
    ".dga-steps li{margin:0}",
    ".dga-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:18px 0 8px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l2)}",
    ".dga-msg{font-size:12px;line-height:1.6;flex:1;min-width:200px;color:var(--dsw-alias-label-secondary)}",
    ".dga-adv{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;margin-bottom:16px}",
    ".dga-adv summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12.5px}",
    ".dga-fileRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
    ".dga-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--dsw-alias-label-tertiary);word-break:break-all}",
    ".dga-banner{margin:10px 20px 0;padding:8px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7;white-space:pre-wrap}",
    ".dga-banner-err{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary)}",
    ".dga-verifyFrame{width:100%;max-width:560px;height:520px;margin-top:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}",
    ".dga-art{display:inline-flex;align-items:center;justify-content:center;object-fit:cover;border-radius:12px;border:2px solid transparent;background:var(--dsw-alias-bg-layer-2);flex:0 0 auto}",
    ".dga-art-ph{color:var(--dsw-alias-label-tertiary);font-weight:600;font-size:18px}",
    ".dga-hero{display:flex;align-items:center;gap:20px;flex-wrap:wrap;padding:18px 20px;margin:0 0 20px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-base))}",
    ".dga-heroMain{flex:1;min-width:190px}",
    ".dga-heroName{font-size:22px;font-weight:650;margin-bottom:4px}",
    ".dga-heroMeta{color:var(--dsw-alias-label-tertiary);font-size:12px}",
    ".dga-heroStats{display:flex;gap:10px;flex-wrap:wrap}",
    ".dga-tile{min-width:78px;padding:10px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);text-align:center}",
    ".dga-tileValue{font-size:20px;font-weight:650;line-height:1.2}",
    ".dga-tileLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:2px}",
    ".dga-bars{display:flex;flex-direction:column;gap:7px}",
    ".dga-barRow{display:flex;align-items:center;gap:10px;font-size:12px}",
    ".dga-barLabel{width:20px;color:var(--dsw-alias-label-secondary)}",
    ".dga-barTrack{flex:1;height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}",
    ".dga-barFill{display:block;height:100%;border-radius:999px}",
    ".dga-barValue{width:26px;text-align:right;color:var(--dsw-alias-label-tertiary)}",
    ".dga-inline{display:flex;align-items:center;gap:12px}",
    ".dga-detail{padding:4px 2px 24px}",
    ".dga-charHead{display:flex;align-items:flex-start;gap:16px;padding:4px 0 14px;border-bottom:1px solid var(--dsw-alias-border-l2);margin-bottom:14px}",
    ".dga-charHeadText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
    ".dga-charName{font-size:20px;font-weight:650}",
    ".dga-talentRow{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}",
    ".dga-talent{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 16px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-tertiary)}",
    ".dga-talentLv{font-size:17px;font-weight:650;color:var(--dsw-alias-label-primary)}",
    ".dga-pieceRow{display:flex;gap:12px;flex-wrap:wrap}",
    ".dga-pieceCard{width:104px;padding:10px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center}",
    ".dga-pieceName{font-size:11px;line-height:1.35;color:var(--dsw-alias-label-secondary)}",
    ".dga-cardGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;padding:4px 0 24px}",
    ".dga-itemCard{display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2)}",
    ".dga-itemText{min-width:0;display:flex;flex-direction:column;gap:3px}",
    ".dga-itemName{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",

    // artifact cards
    ".dga-artiGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:12px;margin-bottom:6px}",
    ".dga-artiCard{position:relative;padding:12px 13px 11px;border-radius:14px;background:linear-gradient(158deg, var(--dsw-alias-bg-layer-2), var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l2);overflow:hidden}",
    ".dga-artiCard{transition:transform .14s ease,border-color .14s ease}",
    ".dga-artiCard:hover{transform:translateY(-1px);border-color:var(--dsw-alias-label-dimmed)}",
    ".dga-artiAccent{position:absolute;inset:0 auto 0 0;width:3px}",
    ".dga-artiHead{display:flex;align-items:center;gap:10px;margin-bottom:10px}",
    ".dga-artiIcon{background:var(--dga-gold-soft);border-color:transparent;border-radius:12px}",
    ".dga-artiHeadText{min-width:0;display:flex;flex-direction:column;gap:2px}",
    ".dga-artiSet{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".dga-artiSlot{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
    ".dga-artiMain{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-3);margin-bottom:9px}",
    ".dga-artiMainL{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
    ".dga-artiMainV{font-size:15px;font-weight:650;font-variant-numeric:tabular-nums}",
    ".dga-artiSubs{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;min-height:74px}",
    ".dga-artiSub{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
    ".dga-artiSubCrit{color:var(--dga-gold);font-weight:600}",
    ".dga-artiSubK{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".dga-artiSubV{font-variant-numeric:tabular-nums;flex:0 0 auto}",
    ".dga-artiSubRolls{font-variant-numeric:tabular-nums;font-size:10.5px;color:var(--dsw-alias-label-tertiary);margin-left:auto;padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);min-width:34px;text-align:right}",
    ".dga-artiSubCrit .dga-artiSubRolls{color:var(--dga-gold);background:color-mix(in srgb,var(--dga-gold) 14%,transparent)}",
    // Footer reads on one baseline: score, then the initial-substat fact, then the
    // grade. The efficiency bar moved below the row so it no longer splits the
    // numbers into a fake column table.
    ".dga-artiFoot{display:flex;align-items:baseline;gap:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}",
    ".dga-artiStat{display:flex;align-items:baseline;gap:4px}",
    ".dga-artiStatV{font-size:16px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}",
    ".dga-artiStatL{font-size:10px;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary)}",
    ".dga-artiInit{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
    ".dga-artiInit b{font-weight:700;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
    ".dga-artiBar{height:3px;border-radius:999px;margin-top:9px;overflow:hidden;background:color-mix(in srgb, var(--dga-gold) 12%, transparent)}",
    ".dga-artiBarFill{display:block;height:100%;width:100%;border-radius:999px;transform-origin:left center;transition:transform .28s ease}",
    ".dga-cvBox{display:flex;flex-direction:column;line-height:1.15}",
    ".dga-cvV{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}",
    ".dga-cvL{font-size:10px;color:var(--dsw-alias-label-tertiary)}",
    ".dga-meter{flex:1;height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}",
    ".dga-meterFill{display:block;height:100%;width:100%;border-radius:999px;transform-origin:left center;transition:transform .28s ease}",
    ".dga-gradePill{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap;margin-left:auto}",
    ".dga-showcaseTag{font-size:10px;line-height:15px;padding:0 6px;border-radius:999px;border:1px solid color-mix(in srgb, var(--dga-gold) 45%, transparent);background:color-mix(in srgb, var(--dga-gold) 16%, transparent);color:#d8b566;white-space:nowrap}",
    ".dga-rowBadges{display:flex;align-items:center;gap:6px;flex:0 0 auto}",

    // gacha guide + dashboard
    ".dga-guide{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px 16px;margin-bottom:16px}",
    ".dga-guideStep{display:flex;gap:10px;margin:0 0 10px}",
    ".dga-guideStep:last-child{margin-bottom:0}",
    ".dga-guideNum{flex:0 0 auto;width:20px;height:20px;border-radius:50%;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}",
    ".dga-guideText{font-size:12.5px;line-height:1.75;color:var(--dsw-alias-label-secondary)}",
    ".dga-guideText b{color:var(--dsw-alias-label-primary);font-weight:600}",
    ".dga-ratioBar{display:flex;height:16px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-3)}",
    ".dga-ratioSeg{height:100%}",
    ".dga-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}",
    ".dga-legendDot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}",
    ".dga-monthChart{display:flex;align-items:flex-end;gap:8px;height:132px;padding:6px 0 0}",
    ".dga-monthCol{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;height:100%}",
    ".dga-monthVal{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
    ".dga-monthBar{width:100%;max-width:38px;border-radius:5px 5px 2px 2px;background:linear-gradient(180deg, var(--dga-gold), color-mix(in srgb, var(--dga-gold) 55%, transparent));min-height:3px}",
    ".dga-monthLabel{font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
    ".dga-fiveRow{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);margin-bottom:6px}",
    ".dga-fiveName{flex:1;min-width:0;font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".dga-fiveMeta{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
    ".dga-pityBar{width:96px;height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;flex:0 0 auto}",
    ".dga-pityFill{display:block;height:100%;border-radius:999px}",
    ".dga-pityTrack{display:flex;flex-direction:column;gap:6px}",
    ".dga-pityLine{display:flex;align-items:center;gap:8px;font-size:12px}",

    // element glyphs + overview polish
    ".dga-elemRow{display:flex;align-items:center;gap:10px;font-size:12.5px}",
    ".dga-elemIcon{width:22px;height:22px;flex:0 0 auto;display:flex;align-items:center;justify-content:center}",
    ".dga-elemIcon img{width:100%;height:100%;object-fit:contain;display:block}",
    ".dga-elemName{width:32px;flex:0 0 auto;color:var(--dsw-alias-label-secondary)}",
    ".dga-elemCount{width:30px;text-align:right;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
    ".dga-progressGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px}",
    ".dga-progressCard{padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2)}",
    ".dga-progressK{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}",
    ".dga-progressV{font-size:17px;font-weight:650;margin-top:3px;font-variant-numeric:tabular-nums}",
    ".dga-progressS{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px}",
    ".dga-serverTag{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}",

    // weapon hover card
    ".dga-wCardRel{position:relative}",
    ".dga-inlineHover{border-radius:10px;background:color-mix(in srgb,var(--dga-gold) 8%,transparent)}",
    ".dga-wCard{display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);transition:transform .14s ease,border-color .14s ease}",
    ".dga-wCardRel:hover .dga-wCard{transform:translateY(-1px);border-color:var(--dsw-alias-label-dimmed)}",
    ".dga-wPop{position:absolute;left:0;top:calc(100% + 6px);z-index:20;width:320px;max-height:340px;overflow:auto;padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-3));border:1px solid var(--dsw-alias-border-l2);box-shadow:0 12px 32px rgba(0,0,0,.22);font-size:12px;line-height:1.75}",
    ".dga-wPopStats{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin-bottom:8px}",
    ".dga-wPopPassive{font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:2px}",
    ".dga-wPopRefine{color:var(--dsw-alias-label-secondary)}",
    ".dga-wPopLore{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-style:italic}",
    ".dga-wPopRow{display:flex;justify-content:space-between;gap:12px}",
    ".dga-wPopK{color:var(--dsw-alias-label-tertiary)}",
    ".dga-wPopV{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",

    // build score block
    ".dga-build{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);margin-bottom:14px}",
    ".dga-buildGrade{font-size:22px;font-weight:750;line-height:1}",
    ".dga-buildLabel{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-top:3px}",
    ".dga-buildStats{display:flex;gap:18px;flex-wrap:wrap;flex:1}",
    ".dga-secRow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}",
    ".dga-secRow .dga-sec{margin-bottom:0}",
    ".dga-seg{display:inline-flex;padding:2px;border-radius:999px;border:1px solid var(--dga-line);background:var(--dsw-alias-bg-layer-2)}",
    ".dga-segBtn{appearance:none;font:inherit;cursor:pointer;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11.5px;padding:3px 10px;border-radius:999px;transition:color .12s ease,background .12s ease}",
    ".dga-segBtnOn{color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dga-gold) 22%, transparent)}",
    ".dga-buildStat{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}",
    ".dga-buildStat b{display:block;font-size:15px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",

    // gacha tiers
    ".dga-tier{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid}",
    ".dga-pityNow{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);margin-bottom:6px}",

    // ── Genshin-flavoured theme layer ─────────────────────────────────────
    // Appended last so these win over the neutral rules above. The idea comes
    // from the in-game character panel: deep ink-teal surfaces, a thin gold
    // hairline, one warm accent, and a soft glow instead of hard borders.
    ":root{--dga-surface:#fdfaf3;--dga-surface-2:#ffffff;--dga-line:rgba(139,108,48,.22);--dga-line-strong:rgba(139,108,48,.38);--dga-glow:rgba(181,139,60,.16);--dga-ink:#1b2430;--dga-ink-soft:#5c6570;--dga-panel:linear-gradient(180deg,#fbf7ee,#ffffff 46%)}",
    "body[data-ds-dark-theme]{--dga-surface:#0f2429;--dga-surface-2:#132b31;--dga-line:rgba(217,180,90,.20);--dga-line-strong:rgba(217,180,90,.38);--dga-glow:rgba(217,180,90,.14);--dga-ink:#e9f1ef;--dga-ink-soft:#9db0ad;--dga-panel:linear-gradient(180deg,#0c2026,#091a1f 55%,#0a171b)}",
    ".dga-root{background:var(--dga-panel);color:var(--dga-ink)}",
    ".dga-head{border-bottom:1px solid var(--dga-line);background:transparent}",
    ".dga-title{letter-spacing:.04em}",
    ".dga-tabs{border-bottom:1px solid var(--dga-line)}",
    ".dga-tab-on{color:var(--dga-ink);border-bottom-color:var(--dga-gold)}",
    ".dga-btn{border-color:var(--dga-line);color:var(--dga-ink-soft)}",
    ".dga-btn:hover:not(:disabled){color:var(--dga-ink);border-color:var(--dga-line-strong)}",
    ".dga-btn-primary{background:linear-gradient(180deg,var(--dga-gold),color-mix(in srgb,var(--dga-gold) 78%, #000));color:#1a1206;border-color:transparent;font-weight:600}",
    ".dga-btn-primary:hover:not(:disabled){color:#1a1206;filter:brightness(1.06)}",
    ".dga-hero{position:relative;overflow:hidden;border:1px solid var(--dga-line);background:linear-gradient(135deg,var(--dga-surface-2),var(--dga-surface));box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}",
    ".dga-hero::after{content:'';position:absolute;right:-60px;top:-90px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,var(--dga-glow),transparent 68%);pointer-events:none}",
    ".dga-heroName{letter-spacing:.02em}",
    ".dga-heroMeta{color:var(--dga-ink-soft)}",
    ".dga-sec{display:flex;align-items:center;gap:8px;color:var(--dga-ink);letter-spacing:.03em}",
    ".dga-sec::before{content:'';width:3px;height:12px;border-radius:2px;background:var(--dga-gold);flex:0 0 auto}",
    ".dga-card,.dga-artiCard,.dga-wCard,.dga-progressCard,.dga-tile,.dga-build,.dga-guide,.dga-banner{border-color:var(--dga-line);background:linear-gradient(180deg,rgba(255,255,255,.035),transparent 60%),var(--dga-surface);box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}",
    ".dga-artiCard,.dga-wCard{box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 1px 2px rgba(0,0,0,.12)}",
    ".dga-artiMain{background:color-mix(in srgb,var(--dga-gold) 8%,var(--dga-surface-2));border:1px solid var(--dga-line)}",
    ".dga-row-on{background:linear-gradient(90deg,color-mix(in srgb,var(--dga-gold) 12%,transparent),transparent 70%);border-color:var(--dga-line-strong)}",
    ".dga-row:hover{background:color-mix(in srgb,var(--dga-gold) 7%,transparent)}",
    ".dga-serverTag{border-color:var(--dga-line);color:var(--dga-ink-soft)}",
    ".dga-showcaseTag{border-color:var(--dga-line-strong);background:color-mix(in srgb,var(--dga-gold) 14%,transparent);color:var(--dga-gold)}",
    ".dga-guideNum{border-color:var(--dga-line);color:var(--dga-ink)}",
    ".dga-adv{border-color:var(--dga-line)}",
    ".dga-skel{background:color-mix(in srgb,var(--dga-gold) 12%,var(--dga-surface-2))}",
    ".dga-barTrack,.dga-meter,.dga-pityBar,.dga-ratioBar{background:color-mix(in srgb,var(--dga-gold) 10%,transparent)}",
    ".dga-wPop{background:var(--dga-surface-2);border-color:var(--dga-line-strong)}",
    ".dga-empty,.dga-hint,.dga-sub{color:var(--dga-ink-soft)}",
    ".dga-cvL,.dga-artiSlot,.dga-progressK,.dga-progressS,.dga-tileLabel{color:var(--dga-ink-soft)}",
  ].join("\n");

  var CSS_TAG = PKG + "/panel.css";
  function ensureCss() {
    if (typeof document === "undefined") return;
    if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + "]") !== null) return;
    var tag = document.createElement("style");
    tag.dataset.plugin = PKG;
    tag.dataset.pluginCss = CSS_TAG;
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }

  // ── data access ──────────────────────────────────────────────────────────
  function getJson(path) {
    return fetch(API + path, { headers: { accept: "application/json" } }).then(function (res) {
      return res.json();
    });
  }

  function postJson(path, body) {
    var headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    return fetch(API + path, {
      method: "POST",
      headers: headers,
      body: body === undefined ? undefined : body,
    }).then(function (res) {
      return res.json();
    });
  }

  function when(ms) {
    if (!ms) return "—";
    try {
      return new Date(ms).toLocaleString("zh-CN");
    } catch (error) {
      return String(ms);
    }
  }

  // ── small pieces ─────────────────────────────────────────────────────────
  function Dot(props) {
    var color = ELEMENT_COLOR[props.element] || ELEMENT_COLOR.none;
    return h("span", { className: "dga-dot", style: { background: color } });
  }

  function Stat(props) {
    return h("div", { className: "dga-stat" },
      h("span", { className: "dga-statK" }, props.label),
      h("span", { className: "dga-statV" }, props.value));
  }

  function Cards(props) {
    return h("div", { className: "dga-cards" },
      props.items.map(function (item) {
        return h("div", { className: "dga-card", key: item.label },
          h("div", { className: "dga-cardV" }, item.value),
          h("div", { className: "dga-cardL" }, item.label));
      }));
  }

  // ── setup wizard ────────────────────────────────────────────────────────
  function SetupTab(props) {
    var draft = props.draft;
    var set = props.setField;

    // Each concern gets its own card: the account, the login, the showcase sync.
    // A flat list of labels on the page background read as an unfinished form.
    var accountCard = h("section", { className: "dga-card dga-setCard" },
      h("div", { className: "dga-sec" }, "账号"),
      h("label", { className: "dga-label", htmlFor: "dga-uid" }, "国服 UID"),
      h("input", {
        id: "dga-uid",
        className: "dga-input",
        type: "text",
        inputMode: "numeric",
        placeholder: "例如 123456789",
        value: draft.miyousheUid,
        onChange: function (event) { props.setMiyousheUid(event.target.value.trim()); },
      }),
      h("p", { className: "dga-hint" },
        "填游戏里的 UID。区服自动判断：1/2 开头天空岛，5 开头世界树。" +
        (draft.miyousheServer ? " 当前：" + draft.miyousheServer : "")));

    var loginCard = h("section", { className: "dga-card dga-setCard" },
      h("div", { className: "dga-sec" }, "扫码登录"),
      h("div", { className: "dga-setRow" },
        h("button", {
          className: "dga-btn dga-btn-primary",
          onClick: props.onStartQr,
          disabled: props.busy || props.qrBusy,
        }, props.qrBusy ? "生成中…" : (props.qr ? "换一张二维码" : "生成二维码")),
        props.qr
          ? h("button", { className: "dga-btn", onClick: props.onCancelQr, disabled: props.qrBusy }, "取消")
          : null,
        h("span", { className: "dga-status" + (draft.hasCookie ? " dga-statusOn" : "") },
          draft.hasCookie ? "已登录" : "未登录")),
      props.qr
        ? h("div", { className: "dga-qrBox", dangerouslySetInnerHTML: { __html: props.qr.svg } })
        : null,
      props.qrStatus ? h("p", { className: "dga-hint" }, props.qrStatus) : null,
      h("p", { className: "dga-hint" },
        "用手机米游社 App 扫码并在手机上确认。会话由这次扫码签发、只存在本机：插件不接触你的密码，也不需要你复制 Cookie。"));

    var showcaseCard = h("section", { className: "dga-card dga-setCard" },
      h("div", { className: "dga-sec" }, "圣遗物副词条"),
      h("p", { className: "dga-hint", style: { marginTop: 0 } },
        "副词条只从游戏内「角色展柜」读取：放上角色并开启「显示详情」，5 分钟后重新同步即可。"),
      h("div", { className: "dga-setRow" },
        h("button", { className: "dga-btn", onClick: props.onRefresh }, "重新同步（读展柜）")),
      props.verifyStatus ? h("p", { className: "dga-hint" }, props.verifyStatus) : null);

    return h("div", { className: "dga-scroll" },
      h("div", { className: "dga-wizard" },
        accountCard,
        loginCard,
        showcaseCard,

        h("div", { className: "dga-actions" },
          h("button", { className: "dga-btn dga-btn-primary", onClick: props.onSaveAndSync, disabled: props.busy },
            props.busy ? "处理中…" : "保存并同步"),
          h("button", { className: "dga-btn", onClick: props.onSaveOnly, disabled: props.busy }, "仅保存"),
          h("span", { className: "dga-msg" }, props.message || "")),
        !props.writable
          ? h("p", { className: "dga-hint", style: { marginTop: 12 } },
              "当前页面无法写入配置（可能不是从本机打开，或插件配置未就绪）。可以直接编辑 profile 的 cordis.patch.yml。")
          : null));
  }

  // ── data tabs ───────────────────────────────────────────────────────────
  // ── visual helpers ──────────────────────────────────────────────────────
  /** Element accents; the actual values live in the CSS tokens. */
  var ELEMENT_COLOR = {
    pyro: "var(--dga-el-pyro)",
    hydro: "var(--dga-el-hydro)",
    anemo: "var(--dga-el-anemo)",
    electro: "var(--dga-el-electro)",
    cryo: "var(--dga-el-cryo)",
    geo: "var(--dga-el-geo)",
    dendro: "var(--dga-el-dendro)",
    none: "var(--dga-el-none)",
  };
  /**
   * Rarity tint used behind item and character icons.
   *
   * This is the game's own rarity palette: 5★ gold-orange, 4★ purple, 3★ blue,
   * 2★ green, 1★ grey. 3★ is blue, not red — the wish screen shows 3★ weapons on
   * a blue card.
   */
  var RARITY_TINT = { 5: "#e0a33e", 4: "#a256e1", 3: "#4f8fe0", 2: "#3fa05e", 1: "#8e8e8e" };

  /** Soft radial tint so the icon sits on a rarity card instead of transparent. */
  function rarityBackground(rarity) {
    var tint = RARITY_TINT[Number(rarity)] || RARITY_TINT[1];
    return "radial-gradient(125% 125% at 50% 0%, color-mix(in srgb, " + tint +
      " 62%, transparent), color-mix(in srgb, " + tint + " 20%, transparent))";
  }

  var RARITY_COLOR = { 5: "var(--dga-gold)", 4: "#9c7bb8", 3: "#5f8fc0", 2: "#5c9c6a", 1: "#8b93a5" };

  function elementColor(element) {
    return ELEMENT_COLOR[element] || ELEMENT_COLOR.none;
  }

  /** Grade → colour, so a card's CV, accent bar and pill all agree. */
  var GRADE_COLOR = {
    极品: "var(--dga-gold)",
    优秀: "var(--dga-blue)",
    可用: "var(--dga-green)",
    S: "var(--dga-gold)",
    A: "var(--dga-blue)",
    B: "var(--dga-green)",
    C: "var(--dsw-alias-label-dimmed)",
  };
  function gradeColor(grade) {
    return GRADE_COLOR[grade] || "var(--dsw-alias-label-dimmed)";
  }

  /**
   * Slot mark for an artifact, used when the artwork is unavailable.
   *
   * Newer sets have no icon on the record CDN yet (it answers with a placeholder),
   * so drawing the slot keeps the card honest instead of showing a broken image.
   */
  function SlotGlyph(props) {
    var color = props.color || "var(--dga-gold)";
    var slot = props.slot || "flower";
    var size = props.size || 42;
    var shapes = {
      flower: [
        h("circle", { key: "c", cx: 12, cy: 12, r: 2.7, fill: color }),
        h("circle", { key: "n", cx: 12, cy: 6.6, r: 2.5, fill: "none", stroke: color, strokeWidth: 1.4 }),
        h("circle", { key: "e", cx: 17.4, cy: 12, r: 2.5, fill: "none", stroke: color, strokeWidth: 1.4 }),
        h("circle", { key: "s", cx: 12, cy: 17.4, r: 2.5, fill: "none", stroke: color, strokeWidth: 1.4 }),
        h("circle", { key: "w", cx: 6.6, cy: 12, r: 2.5, fill: "none", stroke: color, strokeWidth: 1.4 }),
      ],
      plume: [
        h("path", { key: "p", d: "M8 20c6.5-1.6 9.4-6 9.4-13 0 0-7.4 1-8.6 6.2-.6 2.6 0 5.4-.8 6.8Z", fill: "none", stroke: color, strokeWidth: 1.5, strokeLinejoin: "round" }),
        h("path", { key: "l", d: "M8 20 15 9", fill: "none", stroke: color, strokeWidth: 1.3, strokeLinecap: "round" }),
      ],
      sands: [
        h("path", { key: "h", d: "M6.5 4h11l-5.5 8 5.5 8h-11l5.5-8-5.5-8Z", fill: "none", stroke: color, strokeWidth: 1.4, strokeLinejoin: "round" }),
        h("path", { key: "t", d: "M6.5 4h11M6.5 20h11", fill: "none", stroke: color, strokeWidth: 1.6, strokeLinecap: "round" }),
      ],
      goblet: [
        h("path", { key: "c", d: "M7 4h10l-1 6.2a4 4 0 0 1-8 0L7 4Z", fill: "none", stroke: color, strokeWidth: 1.4, strokeLinejoin: "round" }),
        h("path", { key: "s", d: "M12 14.4V19M8.6 20h6.8", fill: "none", stroke: color, strokeWidth: 1.5, strokeLinecap: "round" }),
      ],
      circlet: [
        h("path", { key: "c", d: "M5 17l2.2-8.6L11 13l1-6.6 1 6.6 3.8-4.6L19 17Z", fill: "none", stroke: color, strokeWidth: 1.4, strokeLinejoin: "round" }),
        h("path", { key: "b", d: "M5 19.4h14", fill: "none", stroke: color, strokeWidth: 1.6, strokeLinecap: "round" }),
      ],
    };
    return h("svg", { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": "true" }, shapes[slot] || shapes.flower);
  }

  /**
   * One artifact as a card.
   *
   * The table it replaces forced the eye across five columns to answer one
   * question ("is this piece good?"); a card answers it at a glance — set and
   * slot on top, the main stat as the one emphasised number, then the substats
   * with the two crit rolls highlighted, and CV plus the efficiency meter at the
   * bottom where the eye lands last.
   */
  function ArtifactCard(props) {
    var a = props.a;
    // 两种评分可切换：CV（双暴）或 权重评分（按角色的词条权重）
    var effMode = props.mode === "eff";
    var activeValue = effMode ? a.eff : a.cv;
    var activeGrade = effMode ? a.effGrade : a.cvGrade;
    // 色条 / 进度条 / 数值都用「当前评分模式」的评级色，切换时才一致
    var color = cvGradeColor(effMode ? a.effGrade : a.cvGrade);
    var isHex = /^#[0-9a-f]{6}$/i.test(color);
    var subs = a.subStats && a.subStats.length ? a.subStats : null;
    var efficiency = Math.max(3, Math.min(100, Number(a.efficiency) || 0));
    // 进度条 = 当前模式的分数 ÷ 该部位「传家宝」门槛；理之冠的门槛本来就更高
    var slot = a.slot;
    var top = effMode ? (slot === "circlet" ? EFF_TOP.circlet : EFF_TOP.piece) : (CV_TOP[slot] || 50);
    var activeBar = Math.max(3, Math.min(100, ((effMode ? Number(a.eff) : Number(a.cv)) / top) * 100));
    return h("div", { className: "dga-artiCard" },
      h("span", { className: "dga-artiAccent", style: { background: color } }),
      h("div", { className: "dga-artiHead" },
        h(Art, {
          src: a.icon,
          alt: a.setName,
          size: 42,
          className: "dga-artiIcon",
          fallback: h(SlotGlyph, { slot: a.slot, size: 26, color: color }),
        }),
        h("div", { className: "dga-artiHeadText" },
          h("div", { className: "dga-artiSet", title: a.setName }, a.setName + " " + (a.rarity || 5) + "★"),
          h("div", { className: "dga-artiSlot" }, a.slotZh + " · +" + (a.level == null ? "-" : a.level - 1)))),
      a.mainStat
        ? h("div", { className: "dga-artiMain" },
            h("span", { className: "dga-artiMainL" }, "主词条 · " + statDisplay(a.mainStat.label, "", a.mainStat.percent).label),
            h("span", { className: "dga-artiMainV" }, statDisplay(a.mainStat.label, a.mainStat.text, a.mainStat.percent).text))
        : null,
      h("div", { className: "dga-artiSubs" },
        subs
          ? subs.map(function (sub, index) {
              var crit = sub.key === "critRate_" || sub.key === "critDMG_";
              var shown = statDisplay(sub.label, sub.text, sub.percent);
              return h("div", { className: "dga-artiSub" + (crit ? " dga-artiSubCrit" : ""), key: index },
                h("span", { className: "dga-artiSubK" }, shown.label),
                h("span", {
                  className: "dga-artiSubRolls",
                  title: "这条副词条被强化了 " + ((sub.rolls || 1) - 1) + " 次（不含初始那一次）",
                }, sub.rolls == null ? "" : String(sub.rolls - 1) + " 次"),
                h("span", { className: "dga-artiSubV" }, sub.text));
            })
          : (a.subs || []).map(function (text, index) {
              return h("div", { className: "dga-artiSub", key: index }, h("span", { className: "dga-artiSubK" }, text));
            })),
      h("div", { className: "dga-artiFoot" },
        h("div", { className: "dga-artiStat" },
          h("span", { className: "dga-artiStatV", style: { color: color } }, String(activeValue)),
          h("span", { className: "dga-artiStatL" }, effMode ? "权重评分" : "CV")),
        a.initialSubstats
          ? h("div", { className: "dga-artiInit", title: "这件圣遗物初始是 " + a.initialSubstats + " 词条" },
              "初始 ", h("b", null, String(a.initialSubstats)), " 词条")
          : null,
        h("span", {
          className: "dga-gradePill",
          title: effMode ? "CV " + a.cv + " · 权重评分 " + a.eff : "CV " + a.cv + " · 效率 " + a.efficiency + "%",
          style: {
            color: cvGradeColor(activeGrade),
            border: "1px solid " + cvGradeColor(activeGrade),
            background: "var(--dsw-alias-bg-layer-3)",
          },
        }, activeGrade || "—")),
      h("div", { className: "dga-artiBar" },
        h("span", {
          className: "dga-artiBarFill",
          style: { transform: "scaleX(" + activeBar / 100 + ")", background: color },
        })));
  }

  /**
   * Attack / HP / DEF exist in both a flat and a percentage form. Show the
   * percentage one as `攻击力%` and drop the `%` from the value, so a card reads
   * `攻击力% 15.7` next to `攻击力 18` instead of two identical labels.
   */
  var PAIRED_STATS = { "攻击力": true, "生命值": true, "防御力": true };

  /** CV 评级的颜色：灰 → 蓝 → 绿 → 金 → 砖红，越往后越稀罕。 */
  var CV_GRADE_COLOR = {
    "拉完了": "var(--dsw-alias-label-tertiary)",
    "及格": "var(--dsw-alias-label-secondary)",
    "良好": "#7fb2e5",
    "小毕业": "#7fc9a0",
    "大毕业": "var(--dga-gold)",
    "传家宝": "#e8734a",
  };

  /** 各部位「传家宝」门槛，用来把卡片进度条归一化（与 lib/score.js、lib/roles.js 同步）。 */
  var CV_TOP = { flower: 50, plume: 50, sands: 45, goblet: 45, circlet: 95 };
  var EFF_TOP = { piece: 54.3, circlet: 116.3 };

  function cvGradeColor(grade) {
    return CV_GRADE_COLOR[grade] || "var(--dsw-alias-label-tertiary)";
  }

  function statDisplay(label, text, percent) {
    if (!percent || !PAIRED_STATS[label]) return { label: label, text: text };
    return { label: label + "%", text: String(text == null ? "" : text).replace(/%$/, "") };
  }

  /** Official art from the miHoYo CDN; degrades to a coloured placeholder. */
  function Art(props) {
    var style = Object.assign({ width: props.size, height: props.size }, props.style || {});
    if (props.rarity) {
      var tint = RARITY_TINT[Number(props.rarity)] || RARITY_TINT[1];
      var elementRing = style.borderColor;
      style.borderColor = tint;
      style.background = rarityBackground(props.rarity);
      if (elementRing) style.boxShadow = "inset 0 0 0 1.5px " + elementRing;
    }
    // A broken URL (a dead CDN, a stale hash) must degrade to the same letter
    // placeholder as a missing one instead of leaving an empty square.
    var brokenState = React.useState(false);
    var broken = brokenState[0], setBroken = brokenState[1];
    var fallbackNode = props.fallback
      ? props.fallback
      : (props.alt || "?").slice(0, 1);
    if (!props.src || broken) {
      return h("span", {
        className: "dga-art dga-art-ph" + (props.className ? " " + props.className : ""),
        style: style,
        title: props.alt || "",
      }, fallbackNode);
    }
    return h("img", {
      className: "dga-art" + (props.className ? " " + props.className : ""),
      src: props.src,
      alt: props.alt || "",
      title: props.alt || "",
      loading: "lazy",
      style: style,
      onError: function () { setBroken(true); },
      // The artwork CDN answers 200 with a 1200x1200 placeholder for icons it does
      // not have (new artifact sets), so `onError` alone would never fire.
      onLoad: function (event) {
        var img = event && event.currentTarget;
        if (img && img.naturalWidth >= 512) setBroken(true);
      },
    });
  }

  function StatTile(props) {
    return h("div", { className: "dga-tile" },
      h("div", { className: "dga-tileValue" }, props.value),
      h("div", { className: "dga-tileLabel" }, props.label));
  }

  // ── account overview ────────────────────────────────────────────────────
  var SERVER_LABEL = { cn_gf01: "天空岛", cn_qd01: "世界树" };

  /** A pulsing placeholder block; async surfaces show these instead of a bare "读取中…". */
  function Skeleton(props) {
    return h("span", {
      className: "dga-skel",
      style: Object.assign({ display: "block", height: 12 }, props.style || {}),
    });
  }

  /** Skeleton for the whole panel body while the first summary is in flight. */
  function PanelSkeleton() {
    return h("div", { className: "dga-skelStack" },
      h(Skeleton, { style: { width: 180, height: 22 } }),
      h(Skeleton, { style: { width: "55%", height: 12 } }),
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10, marginTop: 8 } },
        [0, 1, 2, 3].map(function (i) { return h(Skeleton, { key: i, style: { height: 54, borderRadius: 12 } }); })),
      h("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 10 } },
        [0, 1, 2, 3, 4].map(function (i) { return h(Skeleton, { key: i, style: { width: 86 - i * 9 + "%", height: 10 } }); })));
  }

  /** Skeleton for a list column (characters, weapons) while it loads. */
  function ListSkeleton() {
    return h("div", null,
      [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) {
        return h("div", { className: "dga-skelRow", key: i },
          h(Skeleton, { style: { width: 36, height: 36, borderRadius: 12, flex: "0 0 auto" } }),
          h(Skeleton, { style: { width: 52 + ((i * 7) % 30) + "%", height: 11 } }));
      }));
  }

  /**
   * One element mark. Drawn inline instead of shipped as images: the seven
   * glyphs are a few paths each, they inherit the element colour, and they stay
   * crisp in both themes without a sprite sheet.
   */
  /**
   * The seven elemental marks.
   *
   * Drawn as vector art in the element's own colour: a flame, a droplet with a
   * wave, a swirl, a bolt, a snowflake, a faceted rhombus and a leaf. The shapes
   * follow the in-game symbols rather than generic icons, and they scale to any
   * size because they are paths, not a sprite sheet.
   */
  var ELEMENT_ART = {
    pyro: {
      fill: "M12 2.3c3.6 4 5.6 7 5.6 9.6a5.6 5.6 0 0 1-11.2 0c0-2 1-3.8 2.3-5.3.1 1.4.7 2.4 1.7 2.9-.3-2.7.4-5.2 1.6-7.2Z",
    },
    hydro: {
      fill: "M12 2.4c3.8 4.5 5.8 7.5 5.8 10a5.8 5.8 0 1 1-11.6 0c0-2.5 2-5.5 5.8-10Z",
      inner: "M8.7 12.4c1.2.9 2.3.9 3.4-.1s2.2-1 3.2 0c.5.5 1 .7 1.5.6",
    },
    anemo: {
      stroke: "M4.2 9.1h9.6a2.9 2.9 0 1 0-2.9-2.9M4.2 14.9h11.9a2.9 2.9 0 1 1-2.9 2.9",
    },
    electro: {
      fill: "M13.9 2 6 13.4h4.3L9 22l7.9-11.5h-4.4L13.9 2Z",
    },
    cryo: {
      stroke: "M12 2.6v18.8M4 7.3l16 9.4M20 7.3 4 16.7",
      barbs: [
        "M10.2 4.4 12 6.2l1.8-1.8",
        "M10.2 19.6 12 17.8l1.8 1.8",
        "M5.3 10.1l2.5.5.5-2.5",
        "M18.7 13.9l-2.5-.5-.5 2.5",
        "M5.3 13.9l2.5-.5.5 2.5",
        "M18.7 10.1l-2.5.5-.5-2.5",
      ],
    },
    geo: {
      fill: "M12 2.8 20.4 12 12 21.2 3.6 12Z",
      inner: "M12 7.4 16.4 12 12 16.6 7.6 12Z",
    },
    dendro: {
      stroke: "M12 20.8V9.6M12 9.6c0-3.6 2.6-6 6.9-6 0 4.4-2.6 7-6.9 7ZM12 13.4c0-3.6-2.6-6-6.9-6 0 4.4 2.6 7 6.9 7Z",
    },
    none: {
      stroke: "M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z",
      dashed: true,
    },
  };

  /**
   * Official element symbols, embedded as 96px PNG data URLs (generated from the
   * webp masters in data/element-icons by scripts/build-element-icons.mjs).
   * Embedding avoids a route + file read on every panel load and keeps the icons
   * working offline and in the preview harness.
   */
  var ELEMENT_ICON_DATA = {
    "pyro": "data:image/png;base64,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",
    "hydro": "data:image/png;base64,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",
    "anemo": "data:image/png;base64,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",
    "electro": "data:image/png;base64,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",
    "cryo": "data:image/png;base64,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",
    "geo": "data:image/png;base64,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",
    "dendro": "data:image/png;base64,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"
  };

  function elementIconSrc(key) {
    return ELEMENT_ICON_DATA[key] || "";
  }

  function ElementGlyph(props) {
    var requested = props.element;
    var brokenState = React.useState(false);
    var broken = brokenState[0], setBroken = brokenState[1];
    if (!broken && ELEMENT_ART[requested] && requested !== "none" && ELEMENT_ICON_DATA[requested]) {
      return h("span", { className: "dga-elemIcon" },
        h("img", {
          src: ELEMENT_ICON_DATA[requested],
          alt: "",
          width: props.size || 18,
          height: props.size || 18,
          draggable: false,
          loading: "lazy",
          onError: function () { setBroken(true); },
        }));
    }
    var key = ELEMENT_ART[props.element] ? props.element : "none";
    var art = ELEMENT_ART[key];
    var color = elementColor(key);
    var size = props.size || 18;
    var parts = [];
    if (art.fill) {
      parts.push(h("path", { key: "f", d: art.fill, fill: color }));
    }
    if (art.inner) {
      // Light stroke over the filled body: reads as the engraved detail on the
      // in-game symbol without needing a lighter tint per element.
      parts.push(h("path", {
        key: "i",
        d: art.inner,
        fill: "none",
        stroke: "rgba(255,255,255,0.72)",
        strokeWidth: 1.2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }));
    }
    if (art.stroke) {
      parts.push(h("path", {
        key: "s",
        d: art.stroke,
        fill: "none",
        stroke: color,
        strokeWidth: 1.7,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeDasharray: art.dashed ? "2.4 2.6" : undefined,
      }));
    }
    (art.barbs || []).forEach(function (d, index) {
      parts.push(h("path", {
        key: "b" + index,
        d: d,
        fill: "none",
        stroke: color,
        strokeWidth: 1.5,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }));
    });
    return h("svg", {
      className: "dga-elemIcon",
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
    }, parts);
  }

  function OverviewTab(props) {
    var o = props.overview;
    var player = o.player || {};
    var counts = o.counts || {};
    var progress = o.progress || {};
    var list = o.elementList || [];
    var total = list.reduce(function (sum, entry) { return sum + entry.count; }, 0) || 1;
    // Bars are relative to the largest element, not to the whole roster: with a
    // 98-character account every bar was under 20% and the chart read as noise.
    var peak = list.reduce(function (max, entry) { return Math.max(max, entry.count); }, 1);
    var all = props.allCharacters || [];
    var five = all.filter(function (c) { return c.rarity === 5; }).length;
    var four = all.filter(function (c) { return c.rarity === 4; }).length;
    var showcase = counts.showcase || 0;

    // "cn_gf01" on its own means nothing to a player; the Chinese server name is
    // what they know, the code is what the API uses. Show both.
    var serverZh = SERVER_LABEL[player.region] || "";
    var serverText = player.region
      ? (serverZh ? serverZh + "（" + player.region + "）" : player.region)
      : "";

    var abyss = progress.abyss;
    var theater = progress.theater;
    var stygian = progress.stygian;
    var cards = [];
    if (abyss && abyss.text) {
      cards.push({ key: "abyss", label: "深境螺旋", value: abyss.text, sub: abyss.stars ? abyss.stars + " 星" : "" });
    }
    if (theater && (theater.act || theater.maxRound || theater.stars)) {
      var act = theater.act || theater.maxRound;
      cards.push({
        key: "theater",
        label: "幻想真境剧诗",
        value: act ? "第 " + act + " 幕" : "已挑战",
        sub: theater.stars ? theater.stars + " 星" : "",
      });
    }
    if (stygian && stygian.difficulty) {
      var secs = Number(stygian.seconds) || 0;
      cards.push({
        key: "stygian",
        label: "幽境危战" + (stygian.name ? " · " + stygian.name : ""),
        value: "难度 " + stygian.difficulty,
        sub: secs ? "用时 " + secs + " 秒" : "",
      });
    }
    if (progress.achievements) {
      cards.push({ key: "achievements", label: "成就达成", value: String(progress.achievements), sub: "" });
    }
    if (progress.activeDays) {
      cards.push({ key: "activeDays", label: "活跃天数", value: String(progress.activeDays), sub: "" });
    }
    if (progress.fetterCount) {
      cards.push({ key: "fetter", label: "好感角色", value: String(progress.fetterCount), sub: "" });
    }

    return h("div", { className: "dga-scroll" },
      h("div", { className: "dga-hero" },
        h("div", { className: "dga-heroMain" },
          h("div", { className: "dga-heroName" }, player.nickname || "旅行者"),
          h("div", { className: "dga-heroMeta" },
            [
              o.uid ? "UID " + o.uid : "",
              player.level ? "冒险等级 " + player.level : "",
              player.worldLevel ? "世界等级 " + player.worldLevel : "",
            ].filter(Boolean).join(" · ")),
          serverText
            ? h("div", { className: "dga-heroMeta", style: { marginTop: 4 } },
                h("span", { className: "dga-serverTag", title: "游戏服务器：1/2 开头为天空岛，5 开头为世界树" }, "服务器 " + serverText))
            : null),
        h("div", { className: "dga-heroStats" },
          h(StatTile, { value: String(counts.characters || 0), label: "角色" }),
          h(StatTile, { value: String(five), label: "五星" }),
          h(StatTile, { value: String(four), label: "四星" }),
          h(StatTile, { value: String(showcase), label: "展柜" }))),

      list.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "角色元素分布"),
            h("div", { className: "dga-bars" }, list.map(function (entry) {
              return h("div", { className: "dga-elemRow", key: entry.key },
                h(ElementGlyph, { element: entry.key, size: 22 }),
                h("span", { className: "dga-elemName" }, entry.key === "none" ? "其他" : entry.zh),
                h("span", { className: "dga-barTrack" },
                  h("span", {
                    className: "dga-barFill",
                    style: { width: Math.max(2, Math.round((entry.count / peak) * 100)) + "%", background: elementColor(entry.key) },
                  })),
                h("span", { className: "dga-elemCount" }, String(entry.count)));
            })),
            list.some(function (e) { return e.key === "none"; })
              ? h("p", { className: "dga-hint" }, "「其他」是元素随形态变化的旅行者与「奇偶」这类没有固定元素的角色。")
              : null)
        : null,

      cards.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "进度"),
            h("div", { className: "dga-progressGrid" }, cards.map(function (card) {
              return h("div", { className: "dga-progressCard", key: card.key },
                h("div", { className: "dga-progressK" }, card.label),
                h("div", { className: "dga-progressV" }, card.value),
                card.sub ? h("div", { className: "dga-progressS" }, card.sub) : null);
            })))
        : null,

      (function () {
        if (!all.length) return null;
        var bands = { "90+": 0, "90": 0, "80-89": 0, "70-79": 0, "1-69": 0 };
        all.forEach(function (c) {
          if (c.level > 90) bands["90+"] += 1;
          else if (c.level >= 90) bands["90"] += 1;
          else if (c.level >= 80) bands["80-89"] += 1;
          else if (c.level >= 70) bands["70-79"] += 1;
          else bands["1-69"] += 1;
        });
        var maxBand = Math.max.apply(null, Object.keys(bands).map(function (k) { return bands[k]; })) || 1;
        return h("div", { className: "dga-block" },
          h("div", { className: "dga-sec" }, "等级分布"),
          h("div", { className: "dga-bars" }, ["90+", "90", "80-89", "70-79", "1-69"].map(function (band) {
            return h("div", { className: "dga-barRow", key: band },
              h("span", { className: "dga-barLabel", style: { width: 56 } }, band === "90" ? "Lv.90" : band === "90+" ? "Lv.90+" : band),
              h("span", { className: "dga-barTrack" },
                h("span", {
                  className: "dga-barFill",
                  style: { width: Math.max(3, Math.round((bands[band] / maxBand) * 100)) + "%", background: "var(--dga-bar)" },
                })),
              h("span", { className: "dga-barValue" }, String(bands[band])));
          })));
      })(),

      h("div", { className: "dga-block" },
        h("div", { className: "dga-sec" }, "数据状态"),
        h("div", { className: "dga-sub" }, o.noteShort || "")));
  }

  /** Chinese element name → key, for colour lookup. */
  var ELEMENT_ZH_KEY = { pyro: "火", hydro: "水", anemo: "风", electro: "雷", cryo: "冰", geo: "岩", dendro: "草", none: "无" };

  // ── one character ───────────────────────────────────────────────────────
  function CharacterDetail(props) {
    var c = props.character;
    if (!c) return h("div", { className: "dga-empty" }, "从左侧选择一个角色。");
    var stats = c.stats || {};
    var statDefs = [
      ["生命", stats.hp], ["攻击", stats.atk], ["防御", stats.def],
      ["暴击率", stats.critRate_ != null ? stats.critRate_ + "%" : null],
      ["暴击伤害", stats.critDMG_ != null ? stats.critDMG_ + "%" : null],
      ["元素充能", stats.enerRech_ != null ? stats.enerRech_ + "%" : null],
      ["元素精通", stats.eleMas],
      ["元素伤害", stats.elemDmg ? stats.elemDmg + "%" : null],
      ["治疗加成", stats.heal_ ? stats.heal_ + "%" : null],
    ].filter(function (pair) { return pair[1] != null && pair[1] !== ""; });
    var weapon = c.equippedWeapon || c.weapon || null;
    var pieces = c.equippedPieces || [];
    var scored = c.artifacts || [];
    var color = elementColor(c.elementId || c.element);
    // 两种评分：CV（双暴）或 权重评分（角色权重）
    var modeState = React.useState("cv");
    var scoreMode = modeState[0], setScoreMode = modeState[1];
    var effMode = scoreMode === "eff";

    return h("div", { className: "dga-detail" },
      h("div", { className: "dga-charHead" },
        h(Art, { src: c.icon, alt: c.name, size: 76, rarity: c.rarity, style: { borderColor: color } }),
        h("div", { className: "dga-charHeadText" },
          h("div", { className: "dga-charName" }, c.name),
          h("div", { className: "dga-sub" },
            "Lv." + c.level + " · " + c.rarity + "★ · " + (c.elementZh || c.element) + " · " + (c.weaponTypeZh || c.weaponType)),
          h("div", { className: "dga-sub" },
            "命之座 " + c.constellation +
            (c.talents ? " · 天赋 " + [c.talents.auto, c.talents.skill, c.talents.burst].map(function (v) { return v == null ? "-" : v; }).join(" / ") : ""))),
        h("button", { className: "dga-btn", onClick: function () { props.onExport(c); } }, "生成图片")),

      c.talents
        ? h("div", { className: "dga-talentRow" },
            h("div", { className: "dga-talent" }, h("span", { className: "dga-talentLv" }, String(c.talents.auto == null ? "-" : c.talents.auto)), h("span", null, "普通攻击")),
            h("div", { className: "dga-talent" }, h("span", { className: "dga-talentLv" }, String(c.talents.skill == null ? "-" : c.talents.skill)), h("span", null, "元素战技")),
            h("div", { className: "dga-talent" }, h("span", { className: "dga-talentLv" }, String(c.talents.burst == null ? "-" : c.talents.burst)), h("span", null, "元素爆发")))
        : null,

      c.buildScore
        ? h("div", { className: "dga-build" },
            h("div", null,
              h("div", { className: "dga-buildGrade", style: { color: cvGradeColor(effMode ? (c.effective && c.effective.grade) : c.buildScore.cvGrade), fontSize: 20 } }, (effMode ? (c.effective && c.effective.grade) : c.buildScore.cvGrade) || "—"),
              h("div", { className: "dga-buildLabel" }, effMode ? "权重评分总评级" : "CV 总评级")),
            h("div", { className: "dga-seg", style: { alignSelf: "center" } },
              [["cv", "CV"], ["eff", "权重评分"]].map(function (pair) {
                return h("button", {
                  key: pair[0],
                  className: "dga-segBtn" + (scoreMode === pair[0] ? " dga-segBtnOn" : ""),
                  onClick: function () { setScoreMode(pair[0]); },
                }, pair[1]);
              })),
            h("div", { className: "dga-buildStats" },
              h("div", { className: "dga-buildStat" }, h("b", null, String(effMode ? (c.effective && c.effective.total) : c.buildScore.cv)), effMode ? "权重评分" : "CV 合计"),
              h("div", { className: "dga-buildStat" }, h("b", null, String(effMode ? ((c.effective && (c.effective.total / Math.max(1, c.effective.count))).toFixed(1)) : c.buildScore.averageCv)), effMode ? "平均每件" : "平均 CV"),
              h("div", { className: "dga-buildStat" }, h("b", null, c.buildScore.count + " 件"), "已读到")),
            h("details", { className: "dga-adv", style: { margin: 0, flex: "0 0 auto", border: "none", padding: 0 } },
              h("summary", null, "评分怎么算"),
              effMode
                ? h("div", { className: "dga-hint", style: { width: 300, marginTop: 8 } },
                    "权重评分 = Σ（词条数值 × 官方系数 × 该角色的权重）。",
                    h("br"),
                    "系数：暴击率 ×2 / 暴击伤害 ×1 / 精通 ×0.33 / 充能 ×1.1979 / 大攻击·大生命 ×1.33 / 大防御 ×1.06，",
                    "小攻击·小生命·小防御另有 0.5 / 0.66 的折扣。一次满档强化 ≈ 7.75 分。",
                    h("br"),
                    "只算副词条，外加理之冠的主词条（双暴头的主词条值 62.2，不计会失真）。",
                    h("br"),
                    "六档：普通部位 3/4/5/6/7 次有效强化（23.3 / 31 / 38.8 / 46.5 / 54.3），",
                    "理之冠多算主词条那 8 次，因此是 11/12/13/14/15 次（85.3 / 93 / 100.8 / 108.5 / 116.3），",
                    "五件合计 178.3 / 217 / 255.8 / 294.5 / 333.3。",
                    h("br"),
                    "权重来自 data/character-weights.json（120 个角色），未收录的用通用权重。")
                : h("div", { className: "dga-hint", style: { width: 300, marginTop: 8 } },
                    "CV（暴击值）= 暴击率 × 2 + 暴击伤害。理之冠的主词条是双暴时也计入（暴击率 31.1% 记 62.2）。",
                    h("br"),
                    "单件评级按部位分档：花/羽 30·35·40·45·50，沙/杯 20·25·30·35·40，冠 50·60·70·80·95，",
                    "对应 拉完了 / 及格 / 良好 / 小毕业 / 大毕业 / 传家宝。",
                    h("br"),
                    "五件套合计取「五件各自档位下限之和」：150 / 180 / 210 / 240 / 275。",
                    h("br"),
                    "注意：CV 只反映暴击，堆满暴击但对角色无用的圣遗物也会得高分；配装还要看套装与角色需求。")))
        : null,
      statDefs.length
        ? h("div", { className: "dga-statline" }, statDefs.map(function (pair) {
            return h(Stat, { label: pair[0], value: String(pair[1]), key: pair[0] });
          }))
        : h("p", { className: "dga-hint" },
            "面板数据只对游戏内「角色展柜」中的角色开放，把角色放进展柜即可显示。"),

      weapon
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "武器"),
            h(WeaponHover, { weapon: weapon, children: function (hover) {
              return h("div", { className: "dga-inline" + (hover ? " dga-inlineHover" : "") },
                h(Art, { src: weapon.icon, alt: weapon.name, size: 48, rarity: weapon.rarity }),
                h("div", null,
                  h("div", null, weapon.name),
                  h("div", { className: "dga-sub" },
                    "Lv." + weapon.level +
                    (weapon.refinement ? " · 精炼 " + weapon.refinement : "") +
                    " · " + weapon.rarity + "★")));
            } }))
        : null,

      scored.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "圣遗物 · 主副词条与评分"),
            h("div", { className: "dga-artiGrid" }, scored.map(function (a, index) {
              return h(ArtifactCard, { key: index, a: a, mode: scoreMode });
            })),
            h("p", { className: "dga-hint" },
              effMode
                ? "权重评分 = Σ（词条数值 × 官方系数 × 角色权重），只算副词条 + 理之冠主词条。评级线——普通部位 23.3/31/38.8/46.5/54.3，理之冠 85.3/93/100.8/108.5/116.3，五件合计 178.3/217/255.8/294.5/333.3。"
                : "CV = 暴击率×2 + 暴击伤害（双暴主词条的理之冠也计入）。评级线——花羽 30/35/40/45/50，沙杯 25/30/35/40/45，冠 50/60/70/80/95；五件套合计 160/190/220/250/285。"))
        : pieces.length
          ? h("div", { className: "dga-block" },
              h("div", { className: "dga-sec" }, "已装备圣遗物"),
              h("div", { className: "dga-pieceRow" }, pieces.map(function (piece) {
                return h("div", { className: "dga-pieceCard", key: piece.slot },
                  h(Art, { src: piece.icon, alt: piece.name, size: 48 }),
                  h("div", { className: "dga-pieceName" }, piece.name),
                  h("div", { className: "dga-sub" }, SLOT_ZH[piece.slot] + " · +" + (piece.level == null ? "-" : piece.level)));
              })),
              h("p", { className: "dga-hint" },
                "TA 不在游戏的「角色展柜」里，所以只能看到部位与等级。" +
                  "圣遗物详情只对展柜角色开放：把 TA 放进 资料 → 角色展柜 并开启「显示详情」，5 分钟后重新同步即可。"))
          : h("div", { className: "dga-empty" },
              h("div", null, "这个角色还没有可显示的圣遗物。"),
              h("p", { className: "dga-hint" },
                "圣遗物词条只对游戏内「角色展柜」中的角色开放——把 TA 放进展柜并开启「显示详情」，重新同步后就能看到完整的五件套。")),

      c.setEffects && c.setEffects.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "生效套装效果"),
            c.setEffects.map(function (effect, index) {
              return h("p", { className: "dga-effect", key: index }, "· " + effect);
            }))
        : null);
  }

  var SLOT_ZH = { flower: "生之花", plume: "死之羽", sands: "时之沙", goblet: "空之杯", circlet: "理之冠" };

  // ── character list + detail ─────────────────────────────────────────────
  function CharactersTab(props) {
    var snapshot = props.summary;
    var list = snapshot.characters || [];
    var query = props.query;
    var selected = props.selected;

    var sortState = React.useState("level");
    var sort = sortState[0], setSort = sortState[1];
    var elementState = React.useState("");
    var elementFilter = elementState[0], setElementFilter = elementState[1];

    var filtered = list.filter(function (c) {
      if (elementFilter && c.element !== elementFilter) return false;
      if (!query) return true;
      return String(c.name).indexOf(query) >= 0 || String(c.elementZh || "").indexOf(query) >= 0;
    });
    var sorted = filtered.slice().sort(function (a, b) {
      // Showcase characters are the ones with artifact stats, so they always
      // sit above the rest regardless of the chosen sort.
      var byShowcase = (b.showcase ? 1 : 0) - (a.showcase ? 1 : 0);
      if (byShowcase) return byShowcase;
      if (sort === "rarity") return b.rarity - a.rarity || b.level - a.level;
      if (sort === "name") return String(a.name).localeCompare(String(b.name), "zh");
      if (sort === "constellation") return b.constellation - a.constellation || b.level - a.level;
      return b.level - a.level || b.rarity - a.rarity;
    });
    var showcaseCount = list.filter(function (c) { return c.showcase; }).length;

    var elements = ["pyro", "hydro", "anemo", "electro", "cryo", "geo", "dendro"];
    var chip = function (key, label, active, onClick) {
      return h("button", {
        key: key,
        className: "dga-chipBtn" + (active ? " dga-chipBtnOn" : ""),
        onClick: onClick,
      }, label);
    };

    return h("div", { className: "dga-body" },
      h("div", { className: "dga-col-list" },
        h("input", {
          className: "dga-searcher",
          placeholder: "搜索角色…",
          value: query,
          onChange: function (event) { props.onQuery(event.target.value); },
        }),
        h("div", { className: "dga-chipRow" },
          chip("all", "全部", !elementFilter, function () { setElementFilter(""); }),
          elements.map(function (key) {
            return chip(key, ELEMENT_ZH_KEY[key] || key, elementFilter === key, function () {
              setElementFilter(elementFilter === key ? "" : key);
            });
          })),
        h("div", { className: "dga-chipRow" },
          [["level", "等级"], ["rarity", "稀有度"], ["constellation", "命座"], ["name", "名字"]].map(function (pair) {
            return chip("sort-" + pair[0], pair[1], sort === pair[0], function () { setSort(pair[0]); });
          })),
        h("div", { className: "dga-sub", style: { padding: "4px 10px 6px" } },
          sorted.length + " / " + list.length + " 个角色" +
          (showcaseCount ? " · 展柜 " + showcaseCount + " 个（有圣遗物词条）" : "")),
        sorted.map(function (c) {
          return h("div", {
            key: c.id,
            className: "dga-row" + (selected && selected.id === c.id ? " dga-row-on" : ""),
            onClick: function () { props.onSelect(c.name); },
          },
            h(Art, { src: c.icon, alt: c.name, size: 36, rarity: c.rarity, style: { borderColor: elementColor(c.element) } }),
            h("span", { className: "dga-rowname" }, c.name),
            h("div", { className: "dga-rowBadges" },
              c.showcase ? h("span", { className: "dga-showcaseTag", title: "在游戏内角色展柜里，能读到圣遗物主副词条" }, "展柜") : null),
            h("span", { className: "dga-rowlv" }, "Lv." + c.level));
        })),
      h("div", { className: "dga-col-detail" },
        props.loading
          ? h("div", { className: "dga-col-detail" }, h(ListSkeleton))
          : h(CharacterDetail, { character: props.selected, onExport: props.onExport })));
  }

  // ── weapons ─────────────────────────────────────────────────────────────
  function WeaponsTab(props) {
    var rows = props.rows || [];
    var typeState = React.useState("");
    var typeFilter = typeState[0], setTypeFilter = typeState[1];
    var rarityState = React.useState(0);
    var rarityFilter = rarityState[0], setRarityFilter = rarityState[1];

    if (props.loading) return h("div", { className: "dga-skelStack" }, h(ListSkeleton), h(ListSkeleton));
    if (!rows.length) return h("div", { className: "dga-empty" }, "没有武器数据。");

    var types = ["sword", "claymore", "polearm", "bow", "catalyst"];
    var filtered = rows.filter(function (w) {
      if (typeFilter && w.type !== typeFilter) return false;
      if (rarityFilter && w.rarity !== rarityFilter) return false;
      return true;
    });
    var chip = function (key, label, active, onClick) {
      return h("button", {
        key: key,
        className: "dga-chipBtn" + (active ? " dga-chipBtnOn" : ""),
        onClick: onClick,
      }, label);
    };

    return h("div", { className: "dga-scroll" },
      h("div", { className: "dga-chipRow", style: { paddingTop: 12 } },
        chip("all", "全部", !typeFilter, function () { setTypeFilter(""); }),
        types.map(function (type) {
          return chip(type, WEAPON_ZH[type] || type, typeFilter === type, function () {
            setTypeFilter(typeFilter === type ? "" : type);
          });
        })),
      h("div", { className: "dga-chipRow" },
        chip("r0", "全部星级", !rarityFilter, function () { setRarityFilter(0); }),
        [5, 4, 3].map(function (star) {
          return chip("r" + star, star + "★", rarityFilter === star, function () {
            setRarityFilter(rarityFilter === star ? 0 : star);
          });
        })),
      h("div", { className: "dga-sub", style: { padding: "0 2px 8px" } },
        filtered.length + " / " + rows.length + " 把武器 · 精炼只对游戏内「角色展柜」中角色的武器可见"),
      h("div", { className: "dga-cardGrid" }, filtered.map(function (w, index) {
        return h(WeaponCard, { key: index, w: w });
      })));
  }

  /**
   * Hover wrapper shared by the 武器 grid and the character page: renders its
   * children and shows the weapon popover while the pointer is inside.
   */
  function WeaponHover(props) {
    var on = React.useState(false);
    var hover = on[0], setHover = on[1];
    return h("div", {
      className: "dga-wCardRel",
      style: { position: "relative", display: "block" },
      onMouseEnter: function () { setHover(true); },
      onMouseLeave: function () { setHover(false); },
    },
      props.children(hover),
      hover ? h(WeaponPopover, { w: props.weapon }) : null);
  }

  /**
   * The hover card: the weapon's own page — max-level stats, passive text at the
   * current refinement, and the lore line. Name/type/rarity/level/owner are
   * already on the card, so repeating them here would waste the popover.
   */
  function WeaponPopover(props) {
    var w = props.w;
    var d = w.detail;
    if (!d) {
      return h("div", { className: "dga-wPop" },
        h("div", { className: "dga-hint", style: { margin: 0 } }, "暂无这把武器的资料。"));
    }
    var refineIndex = Math.max(0, Math.min(4, (Number(w.refinement) || 1) - 1));
    var passiveText = (d.refines && d.refines[refineIndex]) || (d.refines && d.refines[0]) || "";
    return h("div", { className: "dga-wPop" },
      h("div", { className: "dga-wPopStats" },
        h("span", { className: "dga-wPopK" }, "基础攻击力"),
        h("span", { className: "dga-wPopV" }, d.baseAtk == null ? "—" : String(d.baseAtk)),
        h("span", { className: "dga-wPopK" }, "副属性"),
        h("span", { className: "dga-wPopV" }, d.subLabel ? d.subLabel + " " + (d.subValue || "") : "—")),
      d.passive
        ? h("div", null,
            h("div", { className: "dga-wPopPassive" }, d.passive + (w.refinement ? " · 精炼 " + w.refinement : "")),
            h("div", { className: "dga-wPopRefine" }, passiveText))
        : null,
      d.lore ? h("div", { className: "dga-wPopLore" }, d.lore) : null);
  }

  /** One weapon card; hovering reveals the weapon's own details. */
  function WeaponCard(props) {
    var w = props.w;
    var hoverState = React.useState(false);
    var hover = hoverState[0], setHover = hoverState[1];
    return h("div", {
      className: "dga-wCardRel",
      onMouseEnter: function () { setHover(true); },
      onMouseLeave: function () { setHover(false); },
    },
      h("div", { className: "dga-wCard" },
        h(Art, { src: w.icon, alt: w.name, size: 56, style: { borderColor: RARITY_COLOR[w.rarity] || "var(--dga-el-none)" } }),
        h("div", { className: "dga-itemText" },
          h("div", { className: "dga-itemName" }, w.name),
          h("div", { className: "dga-sub" },
            w.rarity + "★ · " + w.typeZh + " · Lv." + w.level +
            (w.refinement ? " · 精炼 " + w.refinement : "")),
          h("div", { className: "dga-sub" }, w.owner ? "装备于 " + w.owner : "未装备"))),
      hover
        ? h(WeaponPopover, { w: w })
        : null);
  }

  var WEAPON_ZH = { sword: "单手剑", claymore: "双手剑", polearm: "长柄武器", bow: "弓", catalyst: "法器" };


  // ── wish history ────────────────────────────────────────────────────────
﻿  /** One numbered instruction line for the wish-history guide. */
  function GuideStep(props) {
    return h("div", { className: "dga-guideStep" },
      h("span", { className: "dga-guideNum" }, String(props.n)),
      h("div", { className: "dga-guideText" }, props.children));
  }

  /**
   * 欧非等级. `luck` is expected/average pulls, so >1 means luckier than the
   * published base rate. The bands are round numbers rather than a claim about
   * the real distribution.
   */
  function luckTier(luck) {
    if (luck == null || !isFinite(luck)) return null;
    if (luck >= 1.35) return { label: "欧皇", color: "var(--dga-gold)" };
    if (luck >= 1.15) return { label: "小欧", color: "var(--dga-green)" };
    if (luck >= 0.9) return { label: "正常", color: "var(--dga-blue)" };
    if (luck >= 0.7) return { label: "有点非", color: "var(--dga-red)" };
    return { label: "非酋", color: "var(--dga-red)" };
  }

  /** Coloured dot + label pair used by the rarity distribution legend. */
  function LegendItem(props) {
    return h("span", null,
      h("span", { className: "dga-legendDot", style: { background: props.color } }),
      props.label);
  }

  function GachaTab(props) {
    var a = props.analysis;
    var busy = props.busy;
    var manual = h("details", { className: "dga-adv" },
      h("summary", null, "找不到链接？手动粘贴祈愿历史地址"),
      h("div", { style: { marginTop: 10 } },
        h("p", { className: "dga-hint", style: { marginTop: 0 } },
          "在游戏里打开「祈愿 → 历史记录」后，那个网页的地址栏里有一整段很长的链接，" +
          "把整段复制过来（重点是 authkey= 后面那一长串）。authkey 约 24 小时过期，过期就再打开一次历史记录。"),
        h("textarea", {
          className: "dga-input dga-textarea",
          placeholder: "https://webstatic.mihoyo.com/hk4e/event/e20190909gacha-.../index.html?...&authkey=...#/log",
          value: props.url,
          onChange: function (event) { props.onUrl(event.target.value); },
        }),
        h("div", { className: "dga-fileRow", style: { marginTop: 8 } },
          h("button", { className: "dga-btn", onClick: props.onSyncManual, disabled: busy || !String(props.url || "").trim() },
            "用这段链接同步"))));

    var guideOpen = !a || !a.total;
    var guide = h("details", { className: "dga-guide", open: guideOpen },
      h("summary", { className: "dga-guideSummary" }, "怎么拿到祈愿记录"),
      h(GuideStep, { n: 1 }, h("span", null,
        "打开游戏 → ", h("b", null, "祈愿"), " → ", h("b", null, "历史记录"),
        "，随便翻一页。这一步会让游戏把一条带 authkey 的链接写进本地缓存，插件就是从那里读的。")),
      h(GuideStep, { n: 2 }, h("span", null,
        "回到这里点 ", h("b", null, "同步抽卡"), "。插件会自动在游戏安装目录的 webCaches 里找最新那条链接，不需要你复制任何东西。")),
      h(GuideStep, { n: 3 }, h("span", null,
        "如果提示找不到链接，就展开下面的「手动粘贴」，从游戏里打开的祈愿历史页地址栏整段复制过来。")),
      h("p", { className: "dga-hint" },
        "authkey 约 24 小时过期；过期后重新打开一次历史记录再同步即可。记录只存在本机，插件不会上传。" +
          "如果提示「没有新记录」但你知道刚抽过卡，请确认打开的是当前账号的祈愿历史。"));

    if (!a || !a.total) {
      return h("div", { className: "dga-scroll" },
        h("div", { className: "dga-block" }, guide),
        h("div", { className: "dga-block" },
          h("div", { className: "dga-fileRow" },
            h("button", { className: "dga-btn dga-btn-primary", onClick: props.onSync, disabled: busy },
              busy ? "同步中…" : "同步抽卡")),
          h("p", { className: "dga-hint" }, props.status || ""),
          manual));
    }

    var three = Math.max(0, a.total - a.five - a.four);
    var pct = function (n) { return a.total ? (n / a.total) * 100 : 0; };
    var maxMonth = Math.max.apply(null, a.monthly.map(function (m) { return m.pulls; }).concat([1]));
    var maxBucket = Math.max.apply(null, a.pityBuckets.map(function (b) { return b.count; }).concat([1]));
    var avg = a.averageFive == null ? null : a.averageFive;
    var tier = luckTier(a.luck);

    return h("div", { className: "dga-scroll" },
      h("div", { className: "dga-hero" },
        h("div", { className: "dga-heroMain" },
          h("div", { className: "dga-heroName" }, "祈愿记录"),
          h("div", { className: "dga-heroMeta" },
            (a.lastPullAt ? "最近一抽 " + a.lastPullAt : "还没有记录") +
            (a.updatedAt ? " · 更新于 " + when(a.updatedAt) : ""))),
        h("div", { className: "dga-heroStats" },
          h(StatTile, { value: String(a.total), label: "总抽数" }),
          h(StatTile, { value: String(a.five), label: "五星" }),
          h(StatTile, { value: String(a.four), label: "四星" }),
          h(StatTile, { value: avg == null ? "—" : String(avg), label: "平均出金" }),
          h(StatTile, { value: a.luck == null ? "—" : "×" + a.luck, label: "欧非比" }),
          tier
            ? h("div", { className: "dga-tile" },
                h("span", { className: "dga-tier", style: { color: tier.color, borderColor: tier.color } }, tier.label),
                h("div", { className: "dga-tileLabel" }, "欧非等级"))
            : null)),

      h("div", { className: "dga-block" },
        h("div", { className: "dga-fileRow" },
          h("button", { className: "dga-btn dga-btn-primary", onClick: props.onSync, disabled: busy },
            busy ? "同步中…" : "同步抽卡"),
          h("span", { className: "dga-hint" }, props.status || "")),
        guide,
        manual),

      h("div", { className: "dga-block" },
        h("div", { className: "dga-sec" }, "星级分布"),
        h("div", { className: "dga-ratioBar" },
          h("span", { className: "dga-ratioSeg", style: { width: pct(a.five) + "%", background: "var(--dga-gold)" } }),
          h("span", { className: "dga-ratioSeg", style: { width: pct(a.four) + "%", background: "var(--dga-purple)" } }),
          h("span", { className: "dga-ratioSeg", style: { width: pct(three) + "%", background: "var(--dsw-alias-bg-layer-3)" } })),
        h("div", { className: "dga-legend" },
          h(LegendItem, { color: "var(--dga-gold)", label: "五星 " + a.five + "（" + (a.total ? (pct(a.five)).toFixed(1) : "0") + "%）" }),
          h(LegendItem, { color: "var(--dga-purple)", label: "四星 " + a.four + "（" + (a.total ? (pct(a.four)).toFixed(1) : "0") + "%）" }),
          h(LegendItem, { color: "var(--dsw-alias-label-dimmed)", label: "三星 " + three }))),

      h("div", { className: "dga-block" },
        h("div", { className: "dga-sec" }, "各祈愿池 · 垫了多少"),
        h("div", { className: "dga-pityTrack" }, a.banners.map(function (bucket) {
          var progress = Math.min(100, (bucket.sinceFive / 90) * 100);
          var left = Math.max(0, 90 - bucket.sinceFive);
          var soft = bucket.sinceFive >= 74;
          return h("div", { className: "dga-pityNow", key: bucket.type },
            h("div", { style: { flex: 1, minWidth: 0 } },
              h("div", { style: { fontSize: 12.5, fontWeight: 600 } }, bucket.label),
              h("div", { className: "dga-sub" },
                "距硬保底 " + left + " 抽 · 累计 " + bucket.pulls + " 抽 " + bucket.five + " 金" +
                  (soft ? " · 已进软保底" : "")),
              h("div", { className: "dga-pityBar", style: { width: "100%", marginTop: 6 } },
                h("span", {
                  className: "dga-pityFill",
                  style: { width: Math.max(2, progress) + "%", background: soft ? "var(--dga-red)" : "var(--dga-gold)" },
                }))),
            h("span", {
              className: "dga-num",
              style: {
                color: soft ? "var(--dga-red)" : "var(--dsw-alias-label-secondary)",
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: "nowrap",
              },
            }, bucket.sinceFive + " / 90"));
        })),
        h("p", { className: "dga-hint" },
          "「已垫」= 这个池子自上一个五星之后又抽了多少次。90 抽为硬保底，74 抽之后进入软保底（概率明显提高）。")),

      a.monthly.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "每月抽卡量"),
            h("div", { className: "dga-monthChart" }, a.monthly.map(function (row) {
              return h("div", { className: "dga-monthCol", key: row.month },
                h("span", { className: "dga-monthVal" }, String(row.pulls)),
                h("span", { className: "dga-monthBar", style: { height: Math.max(3, Math.round((row.pulls / maxMonth) * 100)) + "%" } }),
                h("span", { className: "dga-monthLabel" }, row.month.slice(2)));
            })))
        : null,

      a.fiveStars.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "五星记录（最新在前）"),
            a.fiveStars.slice(0, 40).map(function (item, index) {
              var pity = Number(item.pity) || 0;
              var early = pity > 0 && pity <= 40;
              return h("div", { className: "dga-fiveRow", key: item.id || index },
                h("span", { className: "dga-fiveName" }, item.name),
                h("span", { className: "dga-fiveMeta" }, item.banner || ""),
                h("span", { className: "dga-pityBar" },
                  h("span", {
                    className: "dga-pityFill",
                    style: { width: Math.max(2, Math.min(100, (pity / 90) * 100)) + "%", background: early ? "var(--dga-green)" : "var(--dga-gold)" },
                  })),
                h("span", { className: "dga-num", style: { width: 62, textAlign: "right", color: early ? "var(--dga-green)" : "var(--dsw-alias-label-secondary)" } }, pity + " / 90"),
                h("span", { className: "dga-fiveMeta", style: { width: 96, textAlign: "right" } }, String(item.time || "").slice(0, 10)));
            }),
            h("p", { className: "dga-hint" }, "绿色 = 40 抽内出金（比较欧）。"))
        : null,

      a.pityBuckets && a.five
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "五星出货区间"),
            h("div", { className: "dga-pityTrack" }, a.pityBuckets.map(function (bucket) {
              return h("div", { className: "dga-pityLine", key: bucket.label },
                h("span", { style: { width: 64, flex: "0 0 auto", color: "var(--dsw-alias-label-secondary)" } }, bucket.label),
                h("span", { className: "dga-pityBar", style: { flex: 1, width: "auto" } },
                  h("span", { className: "dga-pityFill", style: { width: Math.max(2, Math.round((bucket.count / maxBucket) * 100)) + "%", background: "var(--dga-gold)" } })),
                h("span", { className: "dga-num", style: { width: 26, textAlign: "right", color: "var(--dsw-alias-label-tertiary)" } }, String(bucket.count)));
            })),
            h("p", { className: "dga-hint" },
              "基础出率 1.6%，折算约 " + a.expectedAverage + " 抽一个五星；欧非比 >1 表示比基础出率更欧。"))
        : null);
  }

  // ── shareable character image ───────────────────────────────────────────
  function loadArt(src) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      var img = new Image();
      // The miHoYo CDN echoes our Origin, so this keeps the canvas untainted.
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Draw one character card to a PNG and hand it to the browser as a download.
   * Everything is local: images come from the official CDN, text from the
   * snapshot, and the canvas never leaves the page.
   */
  // Canvas needs literal colours: the CSS tokens above are variables and would
  // draw nothing inside a 2D context.
  var ELEMENT_HEX = {
    pyro: "#ef7938", hydro: "#4cc2f1", anemo: "#74c2a8", electro: "#af8ec1",
    cryo: "#9fd6e3", geo: "#fab72e", dendro: "#a5c83b", none: "#8b93a5",
  };
  var RARITY_HEX = { 5: "#d8b56a", 4: "#a884c9", 3: "#6f95c4", 2: "#6fa87f", 1: "#8b93a5" };
  /** CV 评级的画布配色（CSS 变量在 canvas 里无效）。 */
  var CV_GRADE_HEX = {
    "拉完了": "#6f8a88", "及格": "#9db4b1", "良好": "#7fb2e5",
    "小毕业": "#7fc9a0", "大毕业": "#dcbb6f", "传家宝": "#e8734a",
  };
  var accountUid = "";
  var POSTER = {
    ink: "#08222a",
    ink2: "#0c3038",
    card: "#0f2c34",
    card2: "#123841",
    line: "rgba(216,181,106,0.28)",
    gold: "#dcbb6f",
    goldSoft: "#f0dcae",
    text: "#eaf3f1",
    soft: "#9db4b1",
    dim: "#6f8a88",
  };

  function hexA(hex, alpha) {
    var value = String(hex).replace("#", "");
    if (value.length === 3) value = value.split("").map(function (ch) { return ch + ch; }).join("");
    var num = parseInt(value, 16);
    var r = (num >> 16) & 255;
    var g = (num >> 8) & 255;
    var b = num & 255;
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function fillRound(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function strokeRound(ctx, x, y, w, h, r, stroke, width) {
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, r);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width || 1;
    ctx.stroke();
  }

  /** Card surface used across the poster: subtle gradient + gold hairline. */
  function panel(ctx, x, y, w, h, radius, accent) {
    var grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, POSTER.card2);
    grad.addColorStop(1, POSTER.card);
    fillRound(ctx, x, y, w, h, radius, grad);
    strokeRound(ctx, x, y, w, h, radius, POSTER.line, 1);
    if (accent) {
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, x, y, w, h, radius);
      ctx.clip();
      ctx.fillStyle = hexA(accent, 0.16);
      ctx.fillRect(x, y, 4, h);
      ctx.restore();
    }
  }

  function text(ctx, value, x, y, options) {
    var opts = options || {};
    ctx.font = (opts.weight ? opts.weight + " " : "") + (opts.size || 14) +
      "px system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = opts.color || POSTER.text;
    ctx.textAlign = opts.align || "left";
    ctx.textBaseline = opts.baseline || "alphabetic";
    ctx.fillText(String(value == null ? "" : value), x, y);
  }

  /** Truncate with an ellipsis to a pixel width. */
  function clipText(ctx, value, maxWidth, size, weight) {
    ctx.font = (weight ? weight + " " : "") + (size || 14) +
      "px system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif";
    var str = String(value == null ? "" : value);
    if (ctx.measureText(str).width <= maxWidth) return str;
    var cut = str;
    while (cut.length > 1 && ctx.measureText(cut + "…").width > maxWidth) cut = cut.slice(0, -1);
    return cut + "…";
  }

  /** Slot mark drawn on canvas, mirroring the SVG fallback used in the panel. */
  function drawSlotGlyph(ctx, slot, cx, cy, size, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.2, size / 16);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    var r = size / 2;
    if (slot === "flower") {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.26, 0, Math.PI * 2);
      ctx.fill();
      for (var i = 0; i < 4; i += 1) {
        var angle = (Math.PI / 2) * i;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * r * 0.52, cy + Math.sin(angle) * r * 0.52, r * 0.26, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (slot === "plume") {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.5, cy + r * 0.6);
      ctx.quadraticCurveTo(cx + r * 0.7, cy + r * 0.2, cx + r * 0.45, cy - r * 0.7);
      ctx.quadraticCurveTo(cx - r * 0.2, cy - r * 0.2, cx - r * 0.5, cy + r * 0.6);
      ctx.stroke();
    } else if (slot === "sands") {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.55, cy - r * 0.7);
      ctx.lineTo(cx + r * 0.55, cy - r * 0.7);
      ctx.lineTo(cx - r * 0.55, cy + r * 0.7);
      ctx.lineTo(cx + r * 0.55, cy + r * 0.7);
      ctx.closePath();
      ctx.stroke();
    } else if (slot === "goblet") {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.55, cy - r * 0.65);
      ctx.lineTo(cx + r * 0.55, cy - r * 0.65);
      ctx.quadraticCurveTo(cx + r * 0.4, cy + r * 0.15, cx, cy + r * 0.2);
      ctx.quadraticCurveTo(cx - r * 0.4, cy + r * 0.15, cx - r * 0.55, cy - r * 0.65);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.2);
      ctx.lineTo(cx, cy + r * 0.62);
      ctx.moveTo(cx - r * 0.32, cy + r * 0.7);
      ctx.lineTo(cx + r * 0.32, cy + r * 0.7);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.6, cy + r * 0.55);
      ctx.lineTo(cx - r * 0.35, cy - r * 0.55);
      ctx.lineTo(cx - r * 0.05, cy + r * 0.1);
      ctx.lineTo(cx + r * 0.2, cy - r * 0.65);
      ctx.lineTo(cx + r * 0.6, cy + r * 0.55);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * The shareable character poster.
   *
   * Modelled on the in-game character panel people screenshot: ink-teal surface,
   * one gold hairline, the build score as the headline number, and the five
   * artifacts as cards that keep their main stat and every substat. Everything is
   * drawn locally from the snapshot; nothing is uploaded.
   */
  function exportCharacterImage(c) {
    var W = 1000;
    var PAD = 48;
    var accent = ELEMENT_HEX[c.elementId || c.element] || ELEMENT_HEX.none;
    var artifacts = (c.artifacts || []).slice(0, 5);
    var pieces = (c.equippedPieces || []).slice(0, 5);
    var effects = (c.setEffects || []).slice(0, 4);
    var weapon = c.equippedWeapon || c.weapon || null;
    var build = c.buildScore || null;

    var cardW = (W - PAD * 2 - 32) / 3;
    var cardH = 232;
    var rows = Math.ceil(Math.max(1, artifacts.length || pieces.length) / 3);
    var hasStats = Boolean(c.stats && c.stats.hp);
    var H = 470 + (hasStats ? 58 : 0) + rows * (cardH + 16) + (effects.length ? 56 + effects.length * 22 : 0) + 80;

    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");

    var bg = ctx.createLinearGradient(0, 0, W * 0.6, H);
    bg.addColorStop(0, POSTER.ink2);
    bg.addColorStop(0.55, POSTER.ink);
    bg.addColorStop(1, "#061a20");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var bloom = ctx.createRadialGradient(W * 0.16, 60, 20, W * 0.16, 60, 520);
    bloom.addColorStop(0, hexA(accent, 0.3));
    bloom.addColorStop(1, hexA(accent, 0));
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, W, 520);

    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.strokeStyle = POSTER.goldSoft;
    for (var hx = -H; hx < W; hx += 26) {
      ctx.beginPath();
      ctx.moveTo(hx, H);
      ctx.lineTo(hx + H, 0);
      ctx.stroke();
    }
    ctx.restore();

    strokeRound(ctx, 16, 16, W - 32, H - 32, 18, POSTER.line, 1);

    var iconSize = 150;
    var images = [loadArt(c.icon), loadArt(weapon && weapon.icon)];
    artifacts.forEach(function (a) { images.push(loadArt(a.icon)); });
    pieces.forEach(function (p) { images.push(loadArt(p.icon)); });

    Promise.all(images).then(function (loaded) {
      var avatar = loaded[0];
      var weaponIcon = loaded[1];

      var plateTint = RARITY_HEX[c.rarity] || POSTER.gold;
      fillRound(ctx, PAD, 52, iconSize, iconSize, 18, hexA(plateTint, 0.22));
      if (avatar) {
        ctx.save();
        ctx.beginPath();
        roundRect(ctx, PAD, 52, iconSize, iconSize, 18);
        ctx.clip();
        ctx.drawImage(avatar, PAD, 52, iconSize, iconSize);
        ctx.restore();
      } else {
        text(ctx, (c.name || "?").slice(0, 1), PAD + iconSize / 2, 52 + iconSize / 2 + 18, {
          size: 56, weight: "600", color: POSTER.gold, align: "center",
        });
      }
      strokeRound(ctx, PAD, 52, iconSize, iconSize, 18, hexA(accent, 0.7), 2);

      var nameX = PAD + iconSize + 28;
      text(ctx, c.name || "", nameX, 108, { size: 44, weight: "700", color: POSTER.text });
      text(ctx, "Lv." + (c.level || 0), nameX, 146, { size: 18, weight: "600", color: POSTER.gold });

      var pillX = nameX + 84;
      var pills = [
        "命之座 " + (c.constellation || 0),
        (c.elementZh || c.element || "") + "元素",
        c.weaponTypeZh || c.weaponType || "",
        (c.rarity || 0) + "★",
      ];
      pills.forEach(function (label) {
        ctx.font = "500 13px system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif";
        var w = ctx.measureText(label).width + 20;
        fillRound(ctx, pillX, 130, w, 24, 12, "rgba(255,255,255,0.05)");
        strokeRound(ctx, pillX, 130, w, 24, 12, POSTER.line, 1);
        text(ctx, label, pillX + w / 2, 146, { size: 13, color: POSTER.soft, align: "center" });
        pillX += w + 8;
      });

      var uidText = c.uid || accountUid;
      if (uidText) {
        text(ctx, "UID " + uidText, W - PAD, 100, { size: 16, color: POSTER.soft, align: "right" });
      }
      text(ctx, "由 dsh-genshin-account 生成", W - PAD, 124, { size: 12, color: POSTER.dim, align: "right" });

      var y = 232;
      var talentDefs = [
        ["普通攻击", c.talents && c.talents.auto],
        ["元素战技", c.talents && c.talents.skill],
        ["元素爆发", c.talents && c.talents.burst],
      ];
      var boxW = 96;
      talentDefs.forEach(function (def, index) {
        var x = PAD + index * (boxW + 10);
        panel(ctx, x, y, boxW, 74, 12);
        text(ctx, def[1] == null ? "-" : String(def[1]), x + boxW / 2, y + 40, {
          size: 26, weight: "700", color: POSTER.text, align: "center",
        });
        text(ctx, def[0], x + boxW / 2, y + 60, { size: 11, color: POSTER.dim, align: "center" });
      });

      var scoreX = PAD + 3 * (boxW + 10) + 12;
      var scoreW = W - PAD - scoreX;
      panel(ctx, scoreX, y, scoreW, 74, 12, build ? POSTER.gold : null);
      if (build) {
        var buildGradeColor = CV_GRADE_HEX[build.cvGrade] || POSTER.gold;
        text(ctx, build.cvGrade, scoreX + 22, y + 46, {
          size: 22, weight: "800", color: buildGradeColor,
        });
        text(ctx, "CV 总评级", scoreX + 22, y + 66, { size: 11, color: POSTER.soft });
        var metrics = [
          ["CV 合计", String(build.cv)],
          ["平均效率", build.efficiency + "%"],
          ["平均 CV", String(build.averageCv)],
          ["已读到", build.count + " 件"],
        ];
        metrics.forEach(function (pair, index) {
          var mx = scoreX + 104 + index * ((scoreW - 120) / 4);
          text(ctx, pair[1], mx, y + 44, { size: 19, weight: "700", color: POSTER.text });
          text(ctx, pair[0], mx, y + 62, { size: 11, color: POSTER.dim });
        });
      } else {
        text(ctx, "圣遗物详情只对游戏内「角色展柜」中的角色开放", scoreX + 22, y + 44, {
          size: 13, color: POSTER.soft,
        });
      }

      // Panel values, when the character is in the in-game showcase.
      y = 322;
      if (hasStats) {
        var st = c.stats;
        var cells = [
          ["生命", String(st.hp)],
          ["攻击", String(st.atk)],
          ["防御", String(st.def)],
          ["暴击率", st.critRate_ + "%"],
          ["暴击伤害", st.critDMG_ + "%"],
          ["充能", st.enerRech_ + "%"],
          ["精通", String(st.eleMas)],
        ];
        if (st.elemDmg) cells.push([(c.elementZh || "") + "伤", st.elemDmg + "%"]);
        var cellW = (W - PAD * 2) / cells.length;
        cells.forEach(function (cell, index) {
          var cx = PAD + index * cellW;
          text(ctx, cell[1], cx, y + 20, { size: 16, weight: "700", color: POSTER.text });
          text(ctx, cell[0], cx, y + 38, { size: 10.5, color: POSTER.dim });
        });
        y += 60;
      }

      panel(ctx, PAD, y, W - PAD * 2, 96, 14, weapon ? RARITY_HEX[weapon.rarity] || POSTER.gold : null);
      if (weaponIcon && weaponIcon.naturalWidth && weaponIcon.naturalWidth < 512) {
        ctx.save();
        ctx.beginPath();
        roundRect(ctx, PAD + 16, y + 18, 60, 60, 10);
        ctx.clip();
        ctx.drawImage(weaponIcon, PAD + 16, y + 18, 60, 60);
        ctx.restore();
      } else {
        drawSlotGlyph(ctx, "plume", PAD + 46, y + 48, 34, POSTER.gold);
      }
      text(ctx, weapon ? weapon.name : "未装备武器", PAD + 92, y + 44, { size: 19, weight: "600" });
      text(
        ctx,
        weapon
          ? "Lv." + weapon.level + (weapon.refinement ? " · 精炼 " + weapon.refinement : "") + " · " + weapon.rarity + "★"
          : "—",
        PAD + 92, y + 70, { size: 13, color: POSTER.soft },
      );
      if (c.sets && c.sets.length) {
        var setLine = c.sets.map(function (set) { return set.setName + " ×" + set.count; }).join("   ");
        text(ctx, clipText(ctx, setLine, W - PAD * 2 - 380, 13), W - PAD - 20, y + 44, {
          size: 13, color: POSTER.goldSoft, align: "right",
        });
        text(ctx, "套装件数", W - PAD - 20, y + 70, { size: 11, color: POSTER.dim, align: "right" });
      }

      y += 122;
      text(ctx, "圣遗物", PAD, y, { size: 16, weight: "600", color: POSTER.text });
      text(ctx, artifacts.length ? artifacts.length + " 件 · 主副词条与评分" : "暂无词条数据", W - PAD, y, {
        size: 12, color: POSTER.dim, align: "right",
      });
      y += 16;

      var list = artifacts.length ? artifacts : pieces;
      list.forEach(function (item, index) {
        var col = index % 3;
        var row = Math.floor(index / 3);
        var x = PAD + col * (cardW + 16);
        var cy = y + row * (cardH + 16);
        var gradeColor = CV_GRADE_HEX[item.cvGrade] || POSTER.dim;
        panel(ctx, x, cy, cardW, cardH, 14, RARITY_HEX[item.rarity] || POSTER.gold);

        var icon = loaded[2 + index];
        var iconY = cy + 14;
        if (icon && icon.naturalWidth && icon.naturalWidth < 512) {
          ctx.save();
          ctx.beginPath();
          roundRect(ctx, x + 14, iconY, 40, 40, 10);
          ctx.clip();
          ctx.drawImage(icon, x + 14, iconY, 40, 40);
          ctx.restore();
        } else {
          drawSlotGlyph(ctx, item.slot, x + 34, iconY + 20, 26, gradeColor);
        }
        text(ctx, clipText(ctx, item.setName, cardW - 84, 13, "600"), x + 62, cy + 30, { size: 13, weight: "600" });
        text(ctx, item.slotZh + " · +" + (item.level == null ? "-" : item.level - 1), x + 62, cy + 47, {
          size: 11, color: POSTER.dim,
        });

        var mainY = cy + 66;
        fillRound(ctx, x + 14, mainY, cardW - 28, 34, 9, "rgba(255,255,255,0.04)");
        if (item.mainStat) {
          var shownMain = statDisplay(item.mainStat.label, item.mainStat.text, item.mainStat.percent);
          text(ctx, shownMain.label, x + 24, mainY + 22, { size: 11, color: POSTER.dim });
          text(ctx, shownMain.text, x + cardW - 24, mainY + 23, { size: 16, weight: "700", align: "right" });
        } else {
          text(ctx, "主词条", x + 24, mainY + 22, { size: 11, color: POSTER.dim });
        }

        var subs = item.subStats || [];
        subs.slice(0, 4).forEach(function (sub, subIndex) {
          var sy = mainY + 56 + subIndex * 21;
          var crit = sub.key === "critRate_" || sub.key === "critDMG_";
          var shownSub = statDisplay(sub.label, sub.text, sub.percent);
          text(ctx, shownSub.label, x + 18, sy, { size: 12, color: crit ? POSTER.goldSoft : POSTER.soft });
          text(ctx, shownSub.text, x + cardW - 18, sy, {
            size: 12, weight: crit ? "600" : "", color: crit ? POSTER.gold : POSTER.soft, align: "right",
          });
          if (sub.rolls != null) {
            text(ctx, String(sub.rolls - 1) + " 次", x + cardW - 66, sy, {
              size: 10, color: crit ? POSTER.gold : POSTER.dim, align: "right",
            });
          }
        });

        var footY = cy + cardH - 40;
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.beginPath();
        ctx.moveTo(x + 14, footY);
        ctx.lineTo(x + cardW - 14, footY);
        ctx.stroke();
        text(ctx, String(item.cv), x + 18, footY + 26, { size: 18, weight: "700", color: gradeColor });
        ctx.font = "700 18px system-ui, sans-serif";
        text(ctx, "CV", x + 22 + ctx.measureText(String(item.cv)).width, footY + 26, { size: 10, color: POSTER.dim });
        if (item.initialSubstats) {
          text(ctx, "初始 " + item.initialSubstats + " 词条", x + 92, footY + 25, { size: 10, color: POSTER.dim });
        }
        if (item.cvGrade) {
          text(ctx, item.cvGrade, x + cardW - 18, footY + 26, {
            size: 11, weight: "600", color: gradeColor, align: "right",
          });
        }
      });

      if (effects.length) {
        var ey = y + rows * (cardH + 16) + 4;
        text(ctx, "生效套装效果", PAD, ey, { size: 14, weight: "600", color: POSTER.text });
        effects.forEach(function (line, index) {
          text(ctx, clipText(ctx, "· " + line, W - PAD * 2, 12), PAD, ey + 22 + index * 22, {
            size: 12, color: POSTER.soft,
          });
        });
      }

      text(
        ctx,
        "数据来源：" + (c.source === "miyoushe" ? "米游社（扫码登录）" : c.source || "") + " · 圣遗物词条来自游戏内角色展柜",
        PAD, H - 34, { size: 11, color: POSTER.dim },
      );
      text(ctx, new Date().toLocaleString("zh-CN"), W - PAD, H - 34, {
        size: 11, color: POSTER.dim, align: "right",
      });

      canvas.toBlob(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = (c.name || "character") + "-" + new Date().toISOString().slice(0, 10) + ".png";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      }, "image/png");
    });
  }
  // ── page ────────────────────────────────────────────────────────────────
  function draftFrom(config) {
    var c = config || {};
    return {
      source: "miyoushe",
      miyousheUid: c.miyousheUid || "",
      miyousheServer: c.miyousheServer || "",
      miyousheCookie: "",
      hasCookie: c.hasCookie === true,
      miyousheAppVersion: c.miyousheAppVersion || "",
      miyousheDsSalt: c.miyousheDsSalt || "",
      cacheSeconds: c.cacheSeconds == null ? 600 : c.cacheSeconds,
    };
  }

  function serverOfUid(uid) {
    var first = String(uid || "")[0];
    if (first === "1" || first === "2" || first === "3") return "cn_gf01";
    if (first === "5") return "cn_qd01";
    return "";
  }

  function GenshinPage(props) {
    var tabState = React.useState("settings");
    var tab = tabState[0], setTab = tabState[1];
    // The panel opens on the form so a first-time user sees the login steps; once
    // the account loads it moves to 概览 unless the user already clicked a tab.
    var tabTouched = React.useRef(false);

    var summaryState = React.useState(null);
    var summary = summaryState[0], setSummary = summaryState[1];

    var loadingState = React.useState(true);
    var loading = loadingState[0], setLoading = loadingState[1];

    var queryState = React.useState("");
    var query = queryState[0], setQuery = queryState[1];

    var charState = React.useState(null);
    var character = charState[0], setCharacter = charState[1];
    var charLoadingState = React.useState(false);
    var charLoading = charLoadingState[0], setCharLoading = charLoadingState[1];

    var weaponsState = React.useState([]);
    var weapons = weaponsState[0], setWeapons = weaponsState[1];
    var weaponsLoadingState = React.useState(false);
    var weaponsLoading = weaponsLoadingState[0], setWeaponsLoading = weaponsLoadingState[1];


    var syncingState = React.useState(false);
    var syncing = syncingState[0], setSyncing = syncingState[1];

    var busyState = React.useState(false);
    var busy = busyState[0], setBusy = busyState[1];

    var probeState = React.useState(null);
    var probe = probeState[0], setProbe = probeState[1];
    var probingState = React.useState(false);
    var probing = probingState[0], setProbing = probingState[1];

    var qrState = React.useState(null);
    var qr = qrState[0], setQr = qrState[1];
    var qrStatusState = React.useState("");
    var qrStatus = qrStatusState[0], setQrStatus = qrStatusState[1];
    var qrBusyState = React.useState(false);
    var qrBusy = qrBusyState[0], setQrBusy = qrBusyState[1];
    var qrTimerRef = React.useRef(null);

    var verifyInlineState = React.useState(false);
    var verifyInline = verifyInlineState[0], setVerifyInline = verifyInlineState[1];

    var gachaState = React.useState(null);
    var gacha = gachaState[0], setGacha = gachaState[1];
    var gachaBusyState = React.useState(false);
    var gachaBusy = gachaBusyState[0], setGachaBusy = gachaBusyState[1];
    var gachaStatusState = React.useState("");
    var gachaStatus = gachaStatusState[0], setGachaStatus = gachaStatusState[1];
    var gachaUrlState = React.useState("");
    var gachaUrl = gachaUrlState[0], setGachaUrl = gachaUrlState[1];

    var verifyTaskState = React.useState(null);
    var verifyTask = verifyTaskState[0], setVerifyTask = verifyTaskState[1];
    var verifyStatusState = React.useState("");
    var verifyStatus = verifyStatusState[0], setVerifyStatus = verifyStatusState[1];
    var verifyBusyState = React.useState(false);
    var verifyBusy = verifyBusyState[0], setVerifyBusy = verifyBusyState[1];
    var verifyBoxRef = React.useRef(null);

    var messageState = React.useState("");
    var message = messageState[0], setMessage = messageState[1];
    var messageErrorState = React.useState(false);
    var messageError = messageErrorState[0], setMessageError = messageErrorState[1];

    var draftState = React.useState(draftFrom(null));
    var draft = draftState[0], setDraft = draftState[1];

    // The Host registers a bundle's Config under the LOADER entry id, which is
    // `include:<patch row id>` here — not the bare package name. Probe both so
    // this keeps working whichever way the row was composed.
    var ENTRY_ID_CANDIDATES = ["include:" + ENTRY_ID, ENTRY_ID];

    var formState = React.useState(null);
    var formSnap = formState[0], setFormSnap = formState[1];


    // The Config form of this bundle's own entry.
    //
    // `configForms` IS declared in `exports.inject`: Cordis throws
    // `cannot get property "configForms" without inject` on access alone, so
    // reading it while undeclared is not a degradable path — it is a crash.
    // The try/catch stays as a second line of defence for a context whose
    // service was torn down.
    function configFormsService() {
      try {
        return (clientCtx && clientCtx.configForms) || null;
      } catch (error) {
        return null;
      }
    }

    function resolveForm() {
      var service = configFormsService();
      if (!service) return null;
      var fallback = null;
      for (var i = 0; i < ENTRY_ID_CANDIDATES.length; i++) {
        try {
          var candidate = service.get(ENTRY_ID_CANDIDATES[i]);
          if (!candidate) continue;
          if (!fallback) fallback = candidate;
          var snap = candidate.getSnapshot();
          if (snap && (snap.status === "ready" || snap.status === "loading")) {
            // Reuse a memoised form: `get` is keyed by entry id and stable.
            return candidate;
          }
        } catch (error) {
          /* try the next candidate */
        }
      }
      return fallback;
    }

    function formSnapshot() {
      var form = resolveForm();
      if (!form) return null;
      try {
        return form.getSnapshot();
      } catch (error) {
        return null;
      }
    }

    /** Follow the form's own snapshot so `writable` appears once it is ready. */
    React.useEffect(function () {
      var form = resolveForm();
      if (!form) {
        setFormSnap(null);
        return undefined;
      }
      var publish = function () {
        try {
          setFormSnap(form.getSnapshot());
        } catch (error) {
          /* ignore a torn-down form */
        }
      };
      publish();
      var off = null;
      try {
        off = typeof form.subscribe === "function" ? form.subscribe(publish) : null;
      } catch (error) {
        off = null;
      }
      return function () {
        if (off) off();
      };
    }, []);

    // The snapshot says whether the Host document accepts writes; a form that
    // is still loading is not yet known to be read-only.
    var writable = Boolean(formSnap && formSnap.writable === true && formSnap.status === "ready");

    /** Write changed fields in one revision-fenced mutation. */
    function persist(fields) {
      var form = resolveForm();
      if (!form) return Promise.reject(new Error("配置表单不可用（插件配置未就绪）"));

      /** Build the set-ops that actually change something, for one snapshot. */
      function opsFor(snapshot) {
        var current = (snapshot && snapshot.value) || {};
        var ops = [];
        Object.keys(fields).forEach(function (key) {
          // Only touch keys the live schema exposes: one unknown path makes
          // the whole atomic write fail.
          if (!Object.prototype.hasOwnProperty.call(current, key)) {
            if (key !== "miyousheCookie") return;
          }
          var next = fields[key];
          var prev = current[key];
          if (next === prev) return;
          ops.push({ op: "set", path: [key], value: next });
        });
        return ops;
      }

      function writeOnce() {
        var snap = formSnapshot();
        if (!snap) return Promise.resolve(false);
        var ops = opsFor(snap);
        if (!ops.length) return Promise.resolve(true);
        return Promise.resolve(form.mutate(ops, snap.revision));
      }

      // A refused write is usually a revision collision; re-read and retry once.
      return writeOnce().then(function (accepted) {
        if (accepted !== false) return accepted;
        return writeOnce();
      });
    }

    function setField(key, value) {
      setDraft(function (previous) {
        var next = Object.assign({}, previous);
        next[key] = value;
        return next;
      });
    }

    function showMessage(text, isError) {
      setMessage(text);
      setMessageError(Boolean(isError));
    }

    /** A precise "why can't I save" instead of one catch-all sentence. */
    function notWritableMessage() {
      var snap = formSnapshot();
      if (!snap) {
        return "读不到本插件的配置表单。请改用「设置 → 插件 → dsh-genshin-account」里的配置项填写，或直接编辑 profile 的 cordis.patch.yml。";
      }
      if (snap.status === "loading") return "配置还在加载，等一秒再点一次。";
      if (snap.status === "unavailable") {
        return "当前页面读不到这份配置（可能不是从 localhost 打开的）。请改用「设置 → 插件 → dsh-genshin-account」里的配置项填写。";
      }
      if (snap.writable !== true) {
        return "这个页面不允许写入配置。请改用「设置 → 插件 → dsh-genshin-account」里的配置项填写，或直接编辑 profile 的 cordis.patch.yml。";
      }
      return "配置暂不可写。";
    }

    /**
     * A 1034 is not a dead end: send the user to the wizard and open the slider
     * for them. Any other failure just shows its message.
     */
    function offerVerification(message) {
      if (!/1034/.test(String(message || ""))) return false;
      setTab("settings");
      if (!verifyBusy) beginVerify("index");
      return true;
    }

    /** Read the locally stored wish history (no network). */
    function loadGacha() {
      getJson("/gacha")
        .then(function (data) {
          if (data && data.ok && data.analysis) setGacha(data.analysis);
        })
        .catch(function () { /* the pane simply stays empty */ });
    }

    /** Pull fresh records; the host reads the game cache for the authkey. */
    function runGachaSync(urlOverride) {
      setGachaBusy(true);
      setGachaStatus("正在读取祈愿记录…");
      postJson("/gacha/sync", JSON.stringify(urlOverride ? { url: urlOverride } : {}))
        .then(function (data) {
          if (data && data.analysis) setGacha(data.analysis);
          if (!data || data.ok === false) throw new Error((data && data.error) || "同步失败");
          setGachaStatus("新增 " + (data.added || 0) + " 条，共 " + (data.total || 0) + " 条");
        })
        .catch(function (failure) {
          setGachaStatus(String(failure && failure.message ? failure.message : failure));
        })
        .then(function () { setGachaBusy(false); });
    }

    function loadSummary(force) {
      setLoading(true);
      var request = force ? postJson("/sync") : getJson("/summary");
      return request
        .then(function (data) {
          var state = (data && data.state) || null;
          if (state) {
            setDraft(function (previous) {
              var next = draftFrom(state.config);
              // Keep an in-progress cookie edit across a refresh.
              next.miyousheCookie = previous.miyousheCookie;
              return next;
            });
            // Land on the wizard until the account actually renders, then show
            // the account itself: opening on 设置 made the panel look stuck on
            // the login form even when everything was configured.
            if (state.configured === false) setTab("settings");
            else if (!tabTouched.current) setTab("overview");
          }
          if (!data || data.ok === false) {
            var reason = (data && data.error) || "";
            if (reason) showMessage(reason, true);
            offerVerification(reason);
            return;
          }
          accountUid = (data.state && data.state.uid) || (data.overview && data.overview.uid) || accountUid;
          setSummary(data);
          return data;
        })
        .catch(function (failure) {
          showMessage(String(failure && failure.message ? failure.message : failure), true);
        })
        .then(function () { setLoading(false); });
    }

    function loadCharacter(name) {
      if (!name) return;
      setCharLoading(true);
      getJson("/character?name=" + encodeURIComponent(name))
        .then(function (data) {
          setCharacter(data && data.ok ? data.character : null);
        })
        .catch(function (failure) { showMessage(String(failure && failure.message ? failure.message : failure), true); })
        .then(function () { setCharLoading(false); });
    }

    React.useEffect(function () {
      loadSummary(false);
      loadGacha();
    }, []);

    React.useEffect(function () {
      if (tab === "gacha" && !gacha) loadGacha();
    }, [tab]);

    React.useEffect(function () {
      if (tab !== "weapons" || weapons.length) return;
      setWeaponsLoading(true);
      getJson("/weapons")
        .then(function (data) { if (data && data.ok) setWeapons(data.weapons || []); })
        .catch(function () {})
        .then(function () { setWeaponsLoading(false); });
    }, [tab]);

    React.useEffect(function () {
      if (!summary || !summary.characters || !summary.characters.length) return;
      if (character) return;
      loadCharacter(summary.characters[0].name);
    }, [summary]);

    function onSync() {
      setSyncing(true);
      loadSummary(true).then(function () {
        setWeapons([]);
        if (character) loadCharacter(character.name);
        setSyncing(false);
      });
    }

    function fieldsFromDraft() {
      var fields = {
        source: draft.source,
        miyousheUid: draft.miyousheUid,
        cacheSeconds: Number(draft.cacheSeconds) || 0,
      };
      if (draft.miyousheServer) fields.miyousheServer = draft.miyousheServer;
      if (draft.miyousheAppVersion) fields.miyousheAppVersion = draft.miyousheAppVersion;
      if (draft.miyousheDsSalt) fields.miyousheDsSalt = draft.miyousheDsSalt;
      // Never overwrite a stored cookie with an empty draft.
      if (draft.miyousheCookie) fields.miyousheCookie = draft.miyousheCookie;
      return fields;
    }

    /** Persist every wizard field, then read the account back. */
    function saveAndSync() {
      if (!writable) {
        showMessage(notWritableMessage(), true);
        return;
      }
      setBusy(true);
      showMessage("保存中…");
      persist(fieldsFromDraft())
        .then(function (accepted) {
          if (accepted === false) throw new Error("部署未接受这些值");
          setField("miyousheCookie", "");
          setField("hasCookie", draft.hasCookie || Boolean(draft.miyousheCookie));
          return postJson("/sync");
        })
        .then(function (data) {
          if (!data || data.ok === false) {
            var failure = (data && data.error) || "同步失败";
            showMessage(failure, true);
            offerVerification(failure);
            loadSummary(false);
            return;
          }
          setSummary(data);
          setDraft(draftFrom((data.state && data.state.config) || {}));
          showMessage("已同步：" + data.characters.length + " 个角色");
          if (data.state && data.state.configured) setTab("overview");
        })
        .catch(function (failure) {
          showMessage("保存/同步失败：" + String(failure && failure.message ? failure.message : failure), true);
        })
        .then(function () { setBusy(false); });
    }

    function saveOnly() {
      if (!writable) {
        showMessage(notWritableMessage(), true);
        return;
      }
      setBusy(true);
      persist(fieldsFromDraft())
        .then(function (accepted) {
          if (accepted === false) throw new Error("部署未接受这些值");
          setField("miyousheCookie", "");
          setField("hasCookie", draft.hasCookie || Boolean(draft.miyousheCookie));
          showMessage("已保存配置，点右上角「同步」读取账号。");
        })
        .catch(function (failure) {
          showMessage("保存失败：" + String(failure && failure.message ? failure.message : failure), true);
        })
        .then(function () { setBusy(false); });
    }




    /**
     * QR login. The host mints the QR and owns the polling; this half only
     * renders the SVG, keeps the user oriented, and writes the resulting cookie
     * through the settings document once miHoYo confirms the scan.
     */
    function stopQrPolling() {
      if (qrTimerRef.current) {
        clearInterval(qrTimerRef.current);
        qrTimerRef.current = null;
      }
    }

    function startQr() {
      stopQrPolling();
      setQrBusy(true);
      setQr(null);
      setQrStatus("生成二维码…");
      postJson("/login/qr")
        .then(function (data) {
          if (!data || data.ok === false) throw new Error((data && data.error) || "生成二维码失败");
          setQr({ svg: data.svg, ticket: data.ticket });
          setQrStatus("用手机米游社 App 扫码，然后在手机上点「确认登录」");
          var attempts = 0;
          qrTimerRef.current = setInterval(function () {
            attempts += 1;
            if (attempts > 60) {
              stopQrPolling();
              setQrStatus("二维码已超时，请重新生成");
              return;
            }
            postJson("/login/poll", JSON.stringify({ ticket: data.ticket }))
              .then(function (poll) {
                if (!poll || poll.ok === false) throw new Error((poll && poll.error) || "查询失败");
                if (poll.status === "Confirmed") {
                  stopQrPolling();
                  setQrStatus("登录成功，正在写入会话并同步…");
                  setQr(null);
                  return finishQrLogin(poll.cookie);
                }
                if (poll.status === "Scanned") setQrStatus("已扫描，请在手机上点「确认登录」");
                else if (poll.status === "Expired") {
                  stopQrPolling();
                  setQrStatus("二维码已过期，请重新生成");
                } else if (poll.status === "Canceled") {
                  stopQrPolling();
                  setQrStatus("已在手机上取消登录");
                }
              })
              .catch(function (failure) {
                stopQrPolling();
                setQrStatus("查询扫码状态失败：" + String(failure && failure.message ? failure.message : failure));
              });
          }, 2000);
        })
        .catch(function (failure) {
          setQrStatus("生成二维码失败：" + String(failure && failure.message ? failure.message : failure));
        })
        .then(function () { setQrBusy(false); });
    }

    function cancelQr() {
      stopQrPolling();
      setQr(null);
      setQrStatus("");
    }

    function finishQrLogin(cookie) {
      setBusy(true);
      persist({ miyousheCookie: cookie })
        .then(function (accepted) {
          if (accepted === false) {
            throw new Error(
              "配置写入被拒绝（可能是 revision 冲突或字段校验失败）。请再点一次「生成二维码」重试；" +
                "仍不行就到「设置 → 插件 → dsh-genshin-account」里手动粘贴 Cookie。",
            );
          }
          setField("miyousheCookie", "");
          setField("hasCookie", true);
          return postJson("/sync");
        })
        .then(function (data) {
          if (!data || data.ok === false) {
            showMessage((data && data.error) || "同步失败", true);
            return;
          }
          setSummary(data);
          setDraft(draftFrom((data.state && data.state.config) || {}));
          showMessage("扫码登录成功，已同步 " + data.characters.length + " 个角色");
          setTab("overview");
        })
        .catch(function (failure) {
          showMessage("写入登录会话失败：" + String(failure && failure.message ? failure.message : failure), true);
        })
        .then(function () { setBusy(false); });
    }

    /**
     * The geetest slider that clears `retcode 1034`.
     *
     * miHoYo hands out a geetest v3 task for the exact endpoint being read; the
     * slider produces `geetest_challenge` + `geetest_validate`, the host trades
     * them for an `x-rpc-challenge`, and the read is retried with that header.
     * Nothing is bypassed: a person solves one slider, same as the official
     * page and 胡桃工具箱 do.
     */
    function loadGtScript() {
      if (window.initGeetest) return Promise.resolve(window.initGeetest);
      if (gtScriptPromise) return gtScriptPromise;
      gtScriptPromise = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = "https://static.geetest.com/static/tools/gt.js";
        script.async = true;
        script.onload = function () {
          if (window.initGeetest) resolve(window.initGeetest);
          else reject(new Error("验证组件已加载，但没有可用的 initGeetest"));
        };
        script.onerror = function () {
          gtScriptPromise = null;
          reject(new Error("加载验证组件失败（网络或内容安全策略可能拦截了 static.geetest.com）"));
        };
        document.head.appendChild(script);
      });
      return gtScriptPromise;
    }

    function beginVerify(purpose) {
      var want = purpose === "characters" ? "characters" : "index";
      setVerifyBusy(true);
      setVerifyStatus(want === "characters" ? "正在为「角色详情」申请验证…" : "正在获取验证任务…");
      postJson("/verify/start", JSON.stringify({ purpose: want }))
        .then(function (data) {
          if (!data || data.ok === false) throw new Error((data && data.error) || "获取验证任务失败");
          setVerifyTask(data);
          setVerifyStatus("请拖动滑块完成验证");
          return loadGtScript().then(function (initGeetest) {
            return new Promise(function (resolve, reject) {
              // Give React one tick to mount the container this appends into.
              setTimeout(function () {
                var box = verifyBoxRef.current;
                if (!box) {
                  reject(new Error("验证控件容器没有就绪"));
                  return;
                }
                box.innerHTML = "";
                initGeetest(
                  {
                    gt: data.gt,
                    challenge: data.challenge,
                    new_captcha: data.newCaptcha === true,
                    offline: false,
                    product: "float",
                    lang: "zh-cn",
                  },
                  function (captcha) {
                    captcha.onReady(function () { captcha.verify(); });
                    captcha.onSuccess(function () {
                      var value = captcha.getValidate() || {};
                      submitVerify(value.geetest_challenge || "", value.geetest_validate || "");
                      resolve();
                    });
                    captcha.onError(function () {
                      setVerifyStatus("验证控件报错，请点「开始验证」重试");
                      reject(new Error("geetest error"));
                    });
                    captcha.onClose(function () {
                      setVerifyStatus("验证窗口已关闭，可以重新开始");
                    });
                  },
                );
              }, 60);
            });
          });
        })
        .catch(function (failure) {
          setVerifyStatus(String(failure && failure.message ? failure.message : failure));
        })
        .then(function () { setVerifyBusy(false); });
    }

    /**
     * Fallback path: the plugin serves /verify/widget itself, so the slider runs
     * on a plain same-origin page instead of inside the DSH shell (where a
     * content-security policy can stop the geetest script from loading).
     */
    /** The embedded verification page finished loading. */
    function onFrameLoad() {
      setVerifyStatus("验证页已加载；如果框里看不到滑块，点「在新窗口验证」。");
      report({ instance: "client", event: "verify-frame-load", detail: { inline: true } });
    }

    function onFrameError() {
      setVerifyStatus("验证页加载失败，请点「在新窗口验证」。");
      report({ instance: "client", event: "verify-frame-error", detail: { inline: true } });
    }

    function verifyInWindow(purpose) {
      var want = purpose === "characters" ? "characters" : "index";
      var url = API + "/verify/widget?purpose=" + want;
      var win = window.open(url, "dga-verify", "width=560,height=640");
      if (!win) {
        setVerifyStatus("浏览器拦截了新窗口，请允许弹窗，或继续用页面内的滑块。");
        return;
      }
      setVerifyStatus("已在新窗口打开验证页面，完成后会自动刷新这里。");
    }

    // The verification page tells us when it is done.
    React.useEffect(function () {
      function onMessage(event) {
        if (event.origin !== window.location.origin) return;
        var data = event.data || {};
        if (data.type !== "dga-verify-done") return;
        setVerifyInline(false);
        setVerifyTask(null);
        setVerifyStatus("验证已完成，正在刷新账号数据…");
        loadSummary(true);
      }
      window.addEventListener("message", onMessage);
      return function () { window.removeEventListener("message", onMessage); };
    }, []);

    function submitVerify(challenge, validate) {
      setVerifyStatus("验证通过，正在重新读取账号…");
      postJson("/verify/finish", JSON.stringify({
        purpose: (verifyTask && verifyTask.purpose) || "index",
        challenge: challenge,
        validate: validate,
      }))
        .then(function (data) {
          if (!data || data.ok === false) throw new Error((data && data.error) || "验证后读取失败");
          // /character/detail is verified under its own challenge path, so a
          // pass for /index can be followed by a second prompt.
          if (data.needNext) {
            setVerifyStatus(data.needNext === "characters" ? "账号概览已通过，还需要为「角色详情」再验证一次" : "还需要再验证一次");
            beginVerify(data.needNext);
            return;
          }
          setVerifyTask(null);
          setVerifyStatus("");
          setSummary(data);
          setDraft(draftFrom((data.state && data.state.config) || {}));
          showMessage("验证通过，已同步 " + data.characters.length + " 个角色");
          setTab("overview");
        })
        .catch(function (failure) {
          setVerifyStatus("仍未通过：" + String(failure && failure.message ? failure.message : failure));
        });
    }

    /** Ask the host which record endpoints this cookie can actually reach. */
    function runProbe() {
      setProbing(true);
      setProbe(null);
      postJson("/probe-miyoushe")
        .then(function (data) {
          if (!data || data.ok === false) throw new Error((data && data.error) || "诊断失败");
          setProbe(data.results || []);
          var blocked = (data.results || []).filter(function (row) { return !row.ok && !row.skipped });
          showMessage(
            blocked.length === 0
              ? "所有接口都通过了"
              : blocked.length + " 个接口被拦，具体返回码见下方表格",
            blocked.length > 0,
          );
        })
        .catch(function (failure) {
          showMessage(String(failure && failure.message ? failure.message : failure), true);
        })
        .then(function () { setProbing(false); });
    }

    var tabs = [
      { id: "overview", label: "概览" },
      { id: "characters", label: "角色" },
      { id: "gacha", label: "抽卡" },
      { id: "weapons", label: "武器" },
      { id: "settings", label: "设置" },
    ];

    var state = summary && summary.state ? summary.state : null;
    var configured = state ? state.configured !== false : null;

    var body = null;
    if (tab === "settings") {
      body = h(SetupTab, {
        draft: draft,
        state: state || {},
        writable: writable,
        busy: busy,
        message: message,
        setField: setField,
        setSource: function (id) { setField("source", id); },
        setMiyousheUid: function (value) {
          setDraft(function (previous) {
            var next = Object.assign({}, previous);
            next.miyousheUid = value;
            next.miyousheServer = serverOfUid(value) || previous.miyousheServer;
            return next;
          });
        },
        onSaveAndSync: saveAndSync,
        onSaveOnly: saveOnly,
        onProbe: runProbe,
        probe: probe,
        probing: probing,
        onStartQr: startQr,
        onCancelQr: cancelQr,
        qr: qr,
        qrStatus: qrStatus,
        qrBusy: qrBusy,
        onVerify: function () { beginVerify("index"); },
        onVerifyWindow: function () {
          report({ instance: "client", event: "verify-open-window", detail: { popup: true } });
          verifyInWindow("index");
        },
        onVerifyInline: function () {
          report({ instance: "client", event: "verify-open-inline", detail: { inline: !verifyInline } });
          setVerifyInline(!verifyInline);
        },
        onRefresh: onSync,
        verifyInline: verifyInline,
        onFrameLoad: onFrameLoad,
        onFrameError: onFrameError,
        verifyTask: verifyTask,
        verifyStatus: verifyStatus,
        verifyBusy: verifyBusy,
        verifyBoxRef: verifyBoxRef,
      });
    } else if (loading && !summary) {
      body = h(PanelSkeleton);
    } else if (!summary) {
      body = h("div", { className: "dga-empty" },
        "还没有可显示的数据。" + (configured === false ? "先到「设置」里选一种数据源。" : "配置好数据源后点右上角「同步」。"));
    } else if (tab === "overview") {
      body = h(OverviewTab, {
        overview: summary.overview,
        allCharacters: summary.characters || [],
        onOpenCharacter: function (name) {
          setTab("characters");
          setCharacter(null);
          loadCharacter(name);
        },
      });
    } else if (tab === "characters") {
      body = h(CharactersTab, {
        summary: summary,
        query: query,
        onQuery: setQuery,
        selected: character,
        loading: charLoading,
        onSelect: function (name) { setCharacter(null); loadCharacter(name); },
        onExport: exportCharacterImage,
      });
    } else if (tab === "gacha") {
      body = h(GachaTab, {
        // `gacha` already holds the analysis object (`setGacha(data.analysis)`),
        // so reading `gacha.analysis` here silently blanked the whole tab.
        analysis: gacha || null,
        busy: gachaBusy,
        status: gachaStatus,
        url: gachaUrl,
        onUrl: setGachaUrl,
        onSync: function () { runGachaSync(); },
        onSyncManual: function () { runGachaSync(gachaUrl); },
      });
    } else {
      body = h(WeaponsTab, { rows: weapons, loading: weaponsLoading });
    }

    return h("div", { className: "dga-root" },
      h("div", { className: "dga-head" },
        h("div", { className: "dga-grow" },
          h("div", { className: "dga-title" }, "原神启动"),
          h("div", { className: "dga-sub" },
            state
              ? (SOURCE_LABEL[state.source] || state.source) +
                (state.uid ? " · UID " + state.uid : "") +
                " · 同步于 " + when(state.fetchedAt)
              : loading ? "读取中…" : "尚未配置")),
        h("button", { className: "dga-btn dga-btn-primary", onClick: onSync, disabled: syncing }, syncing ? "同步中…" : "同步")),
      h("div", { className: "dga-tabs" }, tabs.map(function (item) {
        return h("button", {
          key: item.id,
          className: "dga-tab" + (tab === item.id ? " dga-tab-on" : ""),
          onClick: function () { tabTouched.current = true; setTab(item.id); },
        }, item.label);
      })),
      // Feedback lives above the panel body, not inside the wizard: pressing
      // the header's 同步 from another tab must still say what happened.
      message
        ? h("div", { className: "dga-banner" + (messageError ? " dga-banner-err" : "") }, message)
        : null,
      body);
  }

  // ── sidebar icon ────────────────────────────────────────────────────────
  // The sidebar owns the button, the tooltip and the click; this is only the
  // glyph, sized by the `size` prop and tinted when `active`.
  function GenshinIcon(props) {
    var size = props.size || 18;
    var color = props.active ? "var(--dsw-alias-label-primary)" : "currentColor";
    return h("svg", {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": "true",
      style: { display: "block" },
    },
      h("path", {
        d: "M12 2.6 4.6 7v10L12 21.4 19.4 17V7L12 2.6Z",
        stroke: color,
        strokeWidth: 1.6,
        strokeLinejoin: "round",
      }),
      h("circle", { cx: 12, cy: 12, r: 3.4, stroke: color, strokeWidth: 1.6 }),
      h("circle", { cx: 12, cy: 12, r: 1.1, fill: color }));
  }

  /**
   * Catches a render-time throw inside the panel so a bug shows a message
   * instead of an empty column, and reports it to the host for diagnosis.
   *
   * Built only when the host React actually exposes `Component`; a build whose
   * React does not would otherwise throw while this bundle is being evaluated,
   * which is far worse than losing the boundary.
   */
  var PageBoundary = null;
  if (React && React.Component && React.Component.prototype) {
    PageBoundary = function PageBoundary(props) {
      React.Component.call(this, props);
      this.state = { error: null };
    };
    PageBoundary.prototype = Object.create(React.Component.prototype);
    PageBoundary.prototype.constructor = PageBoundary;
    PageBoundary.getDerivedStateFromError = function (error) {
      return { error: error };
    };
    PageBoundary.prototype.componentDidCatch = function (error) {
      report("render-error", { message: String((error && error.message) || error) });
    };
    PageBoundary.prototype.render = function () {
      if (this.state.error) {
        return h("div", { className: "dga-root" },
          h("div", { className: "dga-scroll" },
            h("div", { className: "dga-err" },
              "原神启动面板渲染出错：\n" +
              String((this.state.error && this.state.error.message) || this.state.error) +
              "\n\n详细信息已上报，可以把这段文字发给开发者。")));
      }
      return this.props.children;
    };
  }

  function GenshinPageSafe(props) {
    return PageBoundary ? h(PageBoundary, null, h(GenshinPage, props)) : h(GenshinPage, props);
  }

  // Every registration this module currently owns. The client module table can
  // load/re-apply a plugin bundle more than once in one page session (module
  // recomposition, HMR); without this, the second registration displaces the
  // first in the same keyed cell, the second is then disposed, and what is left
  // is an ABDICATED entry — the panel key resolves to nothing and selecting it
  // renders an empty column. Disposing the previous set before registering
  // again keeps exactly one live occupant.
  var owned = [];

  function disposeOwned() {
    for (var i = 0; i < owned.length; i++) {
      try {
        owned[i]();
      } catch (error) {
        /* already gone */
      }
    }
    owned = [];
  }

  var INSTANCE_ID = Math.random().toString(36).slice(2, 8);
  var applyCount = 0;
  var healScheduled = false;
  var healTimers = [];

  /** Report one lifecycle event to the host, which exposes it through /state. */
  function report(event, detail) {
    try {
      fetch(API + "/diag", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instance: INSTANCE_ID,
          event: event,
          detail: detail === undefined ? null : detail,
          url: typeof location !== "undefined" ? String(location.pathname) : "",
        }),
      }).catch(function () {
        /* diagnostics never break the page */
      });
    } catch (error) {
      /* ignore */
    }
  }

  /** Register both seats from scratch: any registrations still owned are dropped
   *  first, so a cell is never left with an abdicated occupant only. */
  function registerBoth(ctx) {
    disposeOwned();
    // `main` first: the sidebar's click validates the key against the live
    // `main` entries, so the panel must exist before the icon can be pressed.
    owned.push(
      ctx.slots.inject("main", function () {
        return ctx.slots.register({ name: "main", key: PANEL_ID, registrant: PKG }, GenshinPageSafe);
      }),
    );
    owned.push(
      ctx.slots.inject("sidebar.panellist", function () {
        return ctx.slots.register(
          { name: "sidebar.panellist", id: PANEL_ID, order: 20, label: function () { return "原神启动"; }, registrant: PKG },
          GenshinIcon,
        );
      }),
    );
  }

  /**
   * Re-register shortly after boot.
   *
   * A cell left with only an abdicated occupant is not observable through the
   * public slot API, so the plugin cannot detect it and ask for a repair.
   * Re-registering from this still-live fiber is cheap and always yields a live
   * occupant — turning "blank panel until the app restarts" into "the panel
   * appears a moment later".
   */
  function scheduleHeal(ctx) {
    if (healScheduled) return;
    healScheduled = true;
    var delays = [1200, 5000];
    for (var i = 0; i < delays.length; i++) {
      (function (delay) {
        var timer = setTimeout(function () {
          try {
            registerBoth(ctx);
            report("heal", { after: delay, applies: applyCount });
          } catch (error) {
            report("heal-failed", { message: String((error && error.message) || error) });
          }
        }, delay);
        if (timer && typeof timer.unref === "function") timer.unref();
        healTimers.push(timer);
      })(delays[i]);
    }
  }

  function apply(ctx) {
    ensureCss();
    clientCtx = ctx;
    applyCount += 1;
    report("apply", { count: applyCount, hasSlots: Boolean(ctx && ctx.slots) });
    registerBoth(ctx);
    report("registered", { owned: owned.length });
    scheduleHeal(ctx);
  }

  exports.name = PKG;
  // `configForms` is a real dependency, not an optional one: Cordis throws on
  // property access unless it is declared here, and the wizard cannot save
  // without it.
  exports.inject = ["slots", "configForms"];
  exports.apply = apply;
  // Exposed so the real-React render check can render the tabs that need data
  // (the page always mounts on the settings pane, so effects never fill them in
  // a server render). Not used by the host.
  exports.__components = {
    ArtifactCard: ArtifactCard,
    CharacterDetail: CharacterDetail,
    CharactersTab: CharactersTab,
    GachaTab: GachaTab,
    exportImage: exportCharacterImage,
  };
  return module.exports;
}});
