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

  var ELEMENT_COLOR = {
    pyro: "#ef7938", hydro: "#4cc2f1", anemo: "#74c2a8", electro: "#af8ec1",
    dendro: "#a5c83b", cryo: "#9fd6e3", geo: "#fab632", none: "#9aa0a6",
  };

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
    ".dga-root{height:100%;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}",
    ".dga-head{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:0 0 auto}",
    ".dga-title{font-size:15px;font-weight:600;margin:0}",
    ".dga-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}",
    ".dga-grow{flex:1;min-width:0}",
    ".dga-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
    ".dga-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
    ".dga-btn:disabled{opacity:.45;cursor:default}",
    ".dga-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:transparent}",
    ".dga-tabs{display:flex;gap:4px;padding:10px 20px 0;flex:0 0 auto;border-bottom:1px solid var(--dsw-alias-border-l2)}",
    ".dga-tab{appearance:none;font:inherit;cursor:pointer;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--dsw-alias-label-tertiary);padding:6px 12px 8px;font-size:13px}",
    ".dga-tab:hover{color:var(--dsw-alias-label-primary)}",
    ".dga-tab-on{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary)}",
    ".dga-body{flex:1;min-height:0;display:flex;overflow:hidden}",
    ".dga-scroll{overflow:auto;padding:16px 20px}",
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
    ".dga-subs{color:var(--dsw-alias-label-secondary);line-height:1.6}",
    ".dga-empty{color:var(--dsw-alias-label-tertiary);padding:32px 4px;line-height:1.8}",
    ".dga-err{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;padding:12px 16px;color:var(--dsw-alias-label-primary);line-height:1.7;white-space:pre-wrap}",
    ".dga-grade{font-weight:600}",
    ".dga-muted{color:var(--dsw-alias-label-tertiary)}",
    ".dga-statline{display:flex;flex-wrap:wrap;gap:6px 18px;margin:6px 0 0}",
    ".dga-stat{display:flex;gap:6px;align-items:baseline}",
    ".dga-statK{color:var(--dsw-alias-label-tertiary);font-size:12px}",
    ".dga-statV{font-variant-numeric:tabular-nums}",
    ".dga-effect{color:var(--dsw-alias-label-secondary);line-height:1.7;margin:2px 0 0;padding-left:12px}",

    // setup wizard
    ".dga-wizard{max-width:780px}",
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
    ".dga-label{display:block;color:var(--dsw-alias-label-primary);font-size:12.5px;font-weight:500;margin-bottom:5px}",
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
    ".dga-hero{display:flex;align-items:center;gap:20px;flex-wrap:wrap;padding:18px 20px;margin:16px 20px 4px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-base))}",
    ".dga-heroMain{flex:1;min-width:190px}",
    ".dga-heroName{font-size:22px;font-weight:650;margin-bottom:4px}",
    ".dga-heroMeta{color:var(--dsw-alias-label-tertiary);font-size:12px}",
    ".dga-heroStats{display:flex;gap:10px;flex-wrap:wrap}",
    ".dga-tile{min-width:78px;padding:10px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);text-align:center}",
    ".dga-tileValue{font-size:20px;font-weight:650;line-height:1.2}",
    ".dga-tileLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:2px}",
    ".dga-avatarRow{display:flex;gap:14px;flex-wrap:wrap}",
    ".dga-avatarCell{display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;width:64px}",
    ".dga-avatarCell:hover .dga-art{border-color:var(--dsw-alias-label-dimmed)}",
    ".dga-avatarLv{font-size:11px;color:var(--dsw-alias-label-secondary)}",
    ".dga-avatarName{font-size:11px;color:var(--dsw-alias-label-tertiary);max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
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

    var fields = h("div", null,
      h("div", { className: "dga-field" },
        h("label", { className: "dga-label" }, "国服 UID"),
        h("input", {
          className: "dga-input",
          type: "text",
          inputMode: "numeric",
          placeholder: "例如 123456789",
          value: draft.miyousheUid,
          onChange: function (event) { props.setMiyousheUid(event.target.value.trim()); },
        }),
        h("p", { className: "dga-hint" },
          "填游戏里的 UID。区服自动判断：1/2 开头天空岛，5 开头世界树。" +
          (draft.miyousheServer ? " 当前：" + draft.miyousheServer : ""))),

      h("div", { className: "dga-field" },
        h("label", { className: "dga-label" }, "扫码登录"),
        h("div", { className: "dga-fileRow" },
          h("button", {
            className: "dga-btn dga-btn-primary",
            onClick: props.onStartQr,
            disabled: props.busy || props.qrBusy,
          }, props.qrBusy ? "生成中…" : (props.qr ? "换一张二维码" : "生成二维码")),
          props.qr
            ? h("button", { className: "dga-btn", onClick: props.onCancelQr, disabled: props.qrBusy }, "取消")
            : null),
        props.qr
          ? h("div", {
              style: { marginTop: 10, padding: 10, background: "#fff", width: 280, borderRadius: 10 },
              dangerouslySetInnerHTML: { __html: props.qr.svg },
            })
          : null,
        props.qrStatus ? h("p", { className: "dga-hint" }, props.qrStatus) : null,
        h("p", { className: "dga-hint" },
          "用手机米游社 App 扫码并在手机上确认。会话由这次扫码签发、只存在本机：插件不接触你的密码，也不需要你复制 Cookie。" +
          (draft.hasCookie ? " 当前状态：已登录。" : " 当前状态：未登录。"))),

      h("div", { className: "dga-field" },
        h("label", { className: "dga-label" }, "圣遗物副词条（可选）"),
        h("div", { className: "dga-fileRow" },
          h("button", { className: "dga-btn dga-btn-primary", onClick: props.onVerifyInline },
            props.verifyInline ? "收起验证" : "在页面内验证"),
          h("button", { className: "dga-btn", onClick: props.onVerifyWindow }, "在新窗口验证"),
          h("button", { className: "dga-btn", onClick: props.onRefresh }, "已完成，刷新数据")),
        props.verifyInline
          ? h("iframe", {
              className: "dga-verifyFrame",
              src: API + "/verify/widget?purpose=index",
              title: "米游社安全验证",
              onLoad: props.onFrameLoad,
              onError: props.onFrameError,
            })
          : null,
        props.verifyStatus ? h("p", { className: "dga-hint" }, props.verifyStatus) : null,
        h("p", { className: "dga-hint" },
          "角色、等级、命座、天赋、武器、圣遗物部位/等级都不需要验证。只有圣遗物的副词条（CV / 词条效率）" +
            "来自需要人机验证的接口：点上面按钮拖一次滑块，通过后立刻能算评分。")));

    return h("div", { className: "dga-scroll" },
      h("div", { className: "dga-wizard" },
        h("div", { className: "dga-block" },
          h("div", { className: "dga-sec" }, "登录"),
          fields),

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
  /** Element accent colours, tuned to stay readable on the dark shell. */
  var ELEMENT_COLOR = {
    pyro: "#ef7938", hydro: "#4cc2f1", anemo: "#74c2a8", electro: "#af8ec1",
    cryo: "#9fd6e3", geo: "#fab72e", dendro: "#a5c83b", none: "#8b93a5",
  };
  var RARITY_COLOR = { 5: "#c8a24a", 4: "#9c7bb8", 3: "#5f8fc0", 2: "#5c9c6a", 1: "#8b93a5" };

  function elementColor(element) {
    return ELEMENT_COLOR[element] || ELEMENT_COLOR.none;
  }

  /** Official art from the miHoYo CDN; degrades to a coloured placeholder. */
  function Art(props) {
    var style = Object.assign({ width: props.size, height: props.size }, props.style || {});
    if (!props.src) {
      return h("span", {
        className: "dga-art dga-art-ph" + (props.className ? " " + props.className : ""),
        style: style,
        title: props.alt || "",
      }, (props.alt || "?").slice(0, 1));
    }
    return h("img", {
      className: "dga-art" + (props.className ? " " + props.className : ""),
      src: props.src,
      alt: props.alt || "",
      title: props.alt || "",
      loading: "lazy",
      style: style,
    });
  }

  function StatTile(props) {
    return h("div", { className: "dga-tile" },
      h("div", { className: "dga-tileValue" }, props.value),
      h("div", { className: "dga-tileLabel" }, props.label));
  }

  // ── account overview ────────────────────────────────────────────────────
  function OverviewTab(props) {
    var o = props.overview;
    var player = o.player || {};
    var counts = o.counts || {};
    var elements = Object.keys(o.elements || {});
    var total = elements.reduce(function (sum, key) { return sum + o.elements[key]; }, 0) || 1;
    var top = (props.topCharacters || []).slice(0, 8);

    return h("div", { className: "dga-scroll" },
      h("div", { className: "dga-hero" },
        h("div", { className: "dga-heroMain" },
          h("div", { className: "dga-heroName" }, player.nickname || "旅行者"),
          h("div", { className: "dga-heroMeta" },
            [
              o.uid ? "UID " + o.uid : "",
              player.level ? "冒险等级 " + player.level : "",
              player.worldLevel ? "世界等级 " + player.worldLevel : "",
              player.region || "",
            ].filter(Boolean).join(" · "))),
        h("div", { className: "dga-heroStats" },
          h(StatTile, { value: String(counts.characters || 0), label: "角色" }),
          h(StatTile, { value: String(counts.weapons || 0), label: "武器" }),
          h(StatTile, { value: String(counts.artifacts || 0), label: "圣遗物" }),
          h(StatTile, { value: String(counts.fiveStarArtifacts || 0), label: "五星圣遗物" }))),

      top.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "练度最高的角色"),
            h("div", { className: "dga-avatarRow" }, top.map(function (c) {
              return h("div", {
                className: "dga-avatarCell",
                key: c.id,
                onClick: function () { if (props.onOpenCharacter) props.onOpenCharacter(c.name); },
              },
                h(Art, { src: c.icon, alt: c.name, size: 56, style: { borderColor: elementColor(c.element) } }),
                h("span", { className: "dga-avatarLv" }, "Lv." + c.level),
                h("span", { className: "dga-avatarName" }, c.name));
            })))
        : null,

      elements.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "元素分布"),
            h("div", { className: "dga-bars" }, elements.map(function (zh) {
              var count = o.elements[zh];
              var key = Object.keys(ELEMENT_COLOR).find(function (k) {
                return ELEMENT_ZH_KEY[k] === zh;
              });
              return h("div", { className: "dga-barRow", key: zh },
                h("span", { className: "dga-barLabel" }, zh),
                h("span", { className: "dga-barTrack" },
                  h("span", {
                    className: "dga-barFill",
                    style: { width: Math.max(6, Math.round((count / total) * 100)) + "%", background: elementColor(key) },
                  })),
                h("span", { className: "dga-barValue" }, String(count)));
            })))
        : null,

      (function () {
        var all = props.allCharacters || [];
        if (!all.length) return null;
        var rarity = { 5: 0, 4: 0 };
        var bands = { "90": 0, "80-89": 0, "70-79": 0, "1-69": 0 };
        all.forEach(function (c) {
          if (c.rarity === 5) rarity[5] += 1;
          else if (c.rarity === 4) rarity[4] += 1;
          if (c.level >= 90) bands["90"] += 1;
          else if (c.level >= 80) bands["80-89"] += 1;
          else if (c.level >= 70) bands["70-79"] += 1;
          else bands["1-69"] += 1;
        });
        var maxBand = Math.max.apply(null, Object.keys(bands).map(function (k) { return bands[k]; })) || 1;
        return h("div", { className: "dga-block" },
          h("div", { className: "dga-sec" }, "角色构成"),
          h("div", { className: "dga-heroStats", style: { marginBottom: 12 } },
            h(StatTile, { value: String(rarity[5]), label: "五星角色" }),
            h(StatTile, { value: String(rarity[4]), label: "四星角色" }),
            h(StatTile, { value: String(bands["90"]), label: "满级 Lv.90" })),
          h("div", { className: "dga-bars" }, ["90", "80-89", "70-79", "1-69"].map(function (band) {
            return h("div", { className: "dga-barRow", key: band },
              h("span", { className: "dga-barLabel", style: { width: 56 } }, band === "90" ? "Lv.90" : band),
              h("span", { className: "dga-barTrack" },
                h("span", {
                  className: "dga-barFill",
                  style: { width: Math.max(3, Math.round((bands[band] / maxBand) * 100)) + "%", background: "#7d9bd1" },
                })),
              h("span", { className: "dga-barValue" }, String(bands[band])));
          })));
      })(),

      (o.player && (o.player.activeDays || o.player.achievements)) || o.challenges
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "活跃与挑战"),
            h("div", { className: "dga-heroStats", style: { marginBottom: 12 } },
              o.player && o.player.activeDays
                ? h(StatTile, { value: o.player.activeDays, label: "活跃天数" })
                : null,
              o.player && o.player.achievements
                ? h(StatTile, { value: o.player.achievements, label: "成就达成" })
                : null,
              o.challenges && o.challenges.hardChallenge
                ? h(StatTile, { value: "难度 " + o.challenges.hardChallenge.difficulty, label: "幻想真境剧诗" })
                : null,
              o.challenges && o.challenges.roleCombat
                ? h(StatTile, { value: o.challenges.roleCombat.medals + "/" + o.challenges.roleCombat.maxRound, label: "幽境危战奖章" })
                : null),
            o.challenges && o.challenges.hardChallenge
              ? h("p", { className: "dga-hint" },
                  "本期剧诗「" + o.challenges.hardChallenge.name + "」最高难度 " +
                  o.challenges.hardChallenge.difficulty + "，用时 " +
                  Math.round(o.challenges.hardChallenge.seconds / 60) + " 分 " +
                  (o.challenges.hardChallenge.seconds % 60) + " 秒" +
                  (o.challenges.hardChallenge.end ? "；结束于 " + new Date(o.challenges.hardChallenge.end).toLocaleDateString("zh-CN") : ""))
              : null,
            o.challenges && o.challenges.card
              ? h("p", { className: "dga-hint" },
                  "名片数据：深境螺旋 " + (o.challenges.card.abyss || "—") +
                  " · 幻想剧诗 " + (o.challenges.card.theater || "—") +
                  (o.challenges.card.matched === false ? "（名片里没有当前 UID 的角色，只取账号级指标）" : ""))
              : null)
        : null,

      o.bestArtifact
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "最佳圣遗物"),
            h("div", { className: "dga-inline" },
              h(Art, { src: o.bestArtifact.icon, alt: o.bestArtifact.setName, size: 44 }),
              h("div", null,
                h("div", null, o.bestArtifact.setName + " · " + o.bestArtifact.slotZh),
                h("div", { className: "dga-sub" },
                  "CV " + o.bestArtifact.cv + " · 效率 " + o.bestArtifact.efficiency + "%" +
                  (o.bestArtifact.owner ? " · " + o.bestArtifact.owner : "")))))
        : null,

      h("div", { className: "dga-block" },
        h("div", { className: "dga-sec" }, "数据状态"),
        h("div", { className: "dga-sub" }, (SOURCE_LABEL[o.source] || o.source) + (o.note ? " · " + o.note : "")),
        h("div", { className: "dga-sub" }, "同步时间：" + when(o.fetchedAt))));
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
    ].filter(function (pair) { return pair[1] != null && pair[1] !== ""; });
    var weapon = c.equippedWeapon || c.weapon || null;
    var pieces = c.equippedPieces || [];
    var scored = c.artifacts || [];
    var color = elementColor(c.element);

    return h("div", { className: "dga-detail" },
      h("div", { className: "dga-charHead" },
        h(Art, { src: c.icon, alt: c.name, size: 76, style: { borderColor: color } }),
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

      statDefs.length
        ? h("div", { className: "dga-statline" }, statDefs.map(function (pair) {
            return h(Stat, { label: pair[0], value: String(pair[1]), key: pair[0] });
          }))
        : null,

      weapon
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "武器"),
            h("div", { className: "dga-inline" },
              h(Art, { src: weapon.icon, alt: weapon.name, size: 48 }),
              h("div", null,
                h("div", null, weapon.name),
                h("div", { className: "dga-sub" },
                  "Lv." + weapon.level +
                  (weapon.refinement ? " · 精" + weapon.refinement : "") +
                  " · " + weapon.rarity + "★"))))
        : null,

      scored.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "圣遗物（含词条评分）"),
            h("table", { className: "dga-table" },
              h("thead", null, h("tr", null,
                h("th", null, "部位"), h("th", null, "套装"), h("th", null, "主词条"),
                h("th", null, "副词条"), h("th", null, "CV"), h("th", null, "效率"))),
              h("tbody", null, scored.map(function (a, index) {
                return h("tr", { key: index },
                  h("td", null, a.slotZh),
                  h("td", null, a.setName + (a.rarity ? " " + a.rarity + "★" : "") + (a.level ? " +" + a.level : "")),
                  h("td", { className: "dga-num" }, a.main || "—"),
                  h("td", { className: "dga-subs" }, (a.subs || []).join(" / ") || "—"),
                  h("td", { className: "dga-num" }, String(a.cv)),
                  h("td", { className: "dga-num" }, a.efficiency + "% " + (a.grade || "")));
              }))))
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
                "这里只显示部位与等级：米游社把圣遗物副词条放在需要人机验证的接口后面。完成一次「打开验证页面」后，这里会换成带 CV / 词条效率的评分表。"))
          : h("div", { className: "dga-empty" }, "这个角色没有可显示的圣遗物。"),

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
      if (sort === "rarity") return b.rarity - a.rarity || b.level - a.level;
      if (sort === "name") return String(a.name).localeCompare(String(b.name), "zh");
      if (sort === "constellation") return b.constellation - a.constellation || b.level - a.level;
      return b.level - a.level || b.rarity - a.rarity;
    });

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
          sorted.length + " / " + list.length + " 个角色"),
        sorted.map(function (c) {
          return h("div", {
            key: c.id,
            className: "dga-row" + (selected && selected.id === c.id ? " dga-row-on" : ""),
            onClick: function () { props.onSelect(c.name); },
          },
            h(Art, { src: c.icon, alt: c.name, size: 36, style: { borderColor: elementColor(c.element) } }),
            h("span", { className: "dga-rowname" }, c.name),
            h("span", { className: "dga-rowlv" }, "Lv." + c.level));
        })),
      h("div", { className: "dga-col-detail" },
        props.loading
          ? h("div", { className: "dga-empty" }, "读取中…")
          : h(CharacterDetail, { character: props.selected, onExport: props.onExport })));
  }

  // ── weapons ─────────────────────────────────────────────────────────────
  function WeaponsTab(props) {
    var rows = props.rows || [];
    var typeState = React.useState("");
    var typeFilter = typeState[0], setTypeFilter = typeState[1];
    var rarityState = React.useState(0);
    var rarityFilter = rarityState[0], setRarityFilter = rarityState[1];

    if (props.loading) return h("div", { className: "dga-empty" }, "读取中…");
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
        filtered.length + " / " + rows.length + " 把武器"),
      h("div", { className: "dga-cardGrid" }, filtered.map(function (w, index) {
        return h("div", { className: "dga-itemCard", key: index },
          h(Art, { src: w.icon, alt: w.name, size: 56, style: { borderColor: RARITY_COLOR[w.rarity] || "#8b93a5" } }),
          h("div", { className: "dga-itemText" },
            h("div", { className: "dga-itemName" }, w.name),
            h("div", { className: "dga-sub" },
              w.rarity + "★ · " + w.typeZh + " · Lv." + w.level +
              (w.refinement ? " · 精" + w.refinement : "")),
            h("div", { className: "dga-sub" }, w.owner ? "装备于 " + w.owner : "未装备")));
      })));
  }

  var WEAPON_ZH = { sword: "单手剑", claymore: "双手剑", polearm: "长柄武器", bow: "弓", catalyst: "法器" };


  // ── artifacts ───────────────────────────────────────────────────────────
  function ArtifactsTab(props) {
    var rows = props.rows || [];
    if (props.loading) return h("div", { className: "dga-empty" }, "读取中…");
    if (!rows.length) {
      return h("div", { className: "dga-scroll" },
        h("div", { className: "dga-empty" },
          "圣遗物评分需要读取圣遗物副词条，而这部分受米游社风控限制。"),
        h("p", { className: "dga-hint", style: { textAlign: "center" } },
          "到「设置」点「打开验证页面」拖一次滑块，之后这里会按 CV 从高到低列出全部圣遗物。"));
    }
    return h("div", { className: "dga-scroll" },
      h("table", { className: "dga-table" },
        h("thead", null, h("tr", null,
          h("th", null, "部位"), h("th", null, "套装"), h("th", null, "主词条"),
          h("th", null, "副词条"), h("th", null, "CV"), h("th", null, "评价"), h("th", null, "角色"))),
        h("tbody", null, rows.map(function (a, index) {
          return h("tr", { key: index },
            h("td", null, a.slotZh),
            h("td", null, a.setName + " " + a.rarity + "★ +" + a.level),
            h("td", { className: "dga-num" }, a.main || "—"),
            h("td", { className: "dga-subs" }, (a.subs || []).join(" / ")),
            h("td", { className: "dga-num" }, String(a.cv)),
            h("td", null, h("span", { className: "dga-grade" }, a.grade || ""), " " + a.efficiency + "%"),
            h("td", null, a.owner || h("span", { className: "dga-muted" }, "—")));
        }))));
  }

  // ── wish history ────────────────────────────────────────────────────────
  function GachaTab(props) {
    var a = props.analysis;
    var busy = props.busy;

    if (!a || !a.total) {
      return h("div", { className: "dga-scroll" },
        h("div", { className: "dga-block" },
          h("div", { className: "dga-sec" }, "还没有抽卡记录"),
          h("p", { className: "dga-hint" },
            "插件的祈愿数据来自游戏自己的祈愿历史：先在游戏里打开一次「祈愿 → 历史记录」" +
            "（这一步会让游戏把带 authkey 的链接写进本地缓存），然后回到这里点「同步抽卡」。"),
          h("div", { className: "dga-fileRow" },
            h("button", { className: "dga-btn dga-btn-primary", onClick: props.onSync, disabled: busy },
              busy ? "同步中…" : "同步抽卡")),
          h("p", { className: "dga-hint" }, props.status || ""),
          h("details", { className: "dga-adv" },
            h("summary", null, "同步失败？手动粘贴祈愿链接"),
            h("div", { style: { marginTop: 10 } },
              h("textarea", {
                className: "dga-input dga-textarea",
                placeholder: "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?...authkey=...",
                value: props.url,
                onChange: function (event) { props.onUrl(event.target.value); },
              }),
              h("div", { className: "dga-fileRow", style: { marginTop: 8 } },
                h("button", { className: "dga-btn", onClick: props.onSyncManual, disabled: busy || !String(props.url || "").trim() },
                  "用这段链接同步"))))));
    }

    return h("div", { className: "dga-scroll" },
      h("div", { className: "dga-hero" },
        h("div", { className: "dga-heroMain" },
          h("div", { className: "dga-heroName" }, "祈愿记录"),
          h("div", { className: "dga-heroMeta" },
            "共 " + a.total + " 抽 · " +
            (a.lastPullAt ? "最近一抽 " + a.lastPullAt : "") +
            (a.updatedAt ? " · 更新于 " + when(a.updatedAt) : " · 尚未同步"))),
        h("div", { className: "dga-heroStats" },
          h(StatTile, { value: String(a.total), label: "总抽数" }),
          h(StatTile, { value: String(a.five), label: "五星" }),
          h(StatTile, { value: String(a.four), label: "四星" }),
          h(StatTile, { value: a.averageFive == null ? "—" : String(a.averageFive), label: "平均出金" }),
          h(StatTile, { value: a.luck == null ? "—" : "×" + a.luck, label: "欧非比" }))),

      h("div", { className: "dga-block" },
        h("div", { className: "dga-fileRow" },
          h("button", { className: "dga-btn dga-btn-primary", onClick: props.onSync, disabled: busy },
            busy ? "同步中…" : "同步抽卡"),
          h("span", { className: "dga-hint" }, props.status || ""))),

      h("div", { className: "dga-block" },
        h("div", { className: "dga-sec" }, "各祈愿池"),
        h("table", { className: "dga-table" },
          h("thead", null, h("tr", null,
            h("th", null, "祈愿"), h("th", null, "抽数"), h("th", null, "五星"),
            h("th", null, "四星"), h("th", null, "距离上次五星"))),
          h("tbody", null, a.banners.map(function (bucket) {
            return h("tr", { key: bucket.type },
              h("td", null, bucket.label),
              h("td", { className: "dga-num" }, String(bucket.pulls)),
              h("td", { className: "dga-num" }, String(bucket.five)),
              h("td", { className: "dga-num" }, String(bucket.four)),
              h("td", { className: "dga-num" }, String(bucket.sinceFive)));
          })))),

      a.fiveStars.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "五星记录（最新在前）"),
            h("table", { className: "dga-table" },
              h("thead", null, h("tr", null,
                h("th", null, "名称"), h("th", null, "祈愿"), h("th", null, "第几抽"), h("th", null, "时间"))),
              h("tbody", null, a.fiveStars.slice(0, 50).map(function (item, index) {
                return h("tr", { key: item.id || index },
                  h("td", null, item.name),
                  h("td", null, item.banner || item.gacha_type),
                  h("td", { className: "dga-num" }, String(item.pity)),
                  h("td", { className: "dga-num" }, item.time));
              }))))
        : null,

      a.monthly && a.monthly.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "每月抽卡量"),
            h("div", { className: "dga-bars" }, a.monthly.map(function (row) {
              var max = Math.max.apply(null, a.monthly.map(function (m) { return m.pulls; })) || 1;
              return h("div", { className: "dga-barRow", key: row.month },
                h("span", { className: "dga-barLabel", style: { width: 56 } }, row.month.slice(2)),
                h("span", { className: "dga-barTrack" },
                  h("span", {
                    className: "dga-barFill",
                    style: { width: Math.max(4, Math.round((row.pulls / max) * 100)) + "%", background: "#c8a24a" },
                  })),
                h("span", { className: "dga-barValue" }, String(row.pulls)));
            })))
        : null,

      a.pityBuckets && a.five
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "五星出货区间"),
            h("table", { className: "dga-table" },
              h("thead", null, h("tr", null, h("th", null, "第几抽"), h("th", null, "次数"))),
              h("tbody", null, a.pityBuckets.map(function (bucket) {
                return h("tr", { key: bucket.label },
                  h("td", null, bucket.label),
                  h("td", { className: "dga-num" }, String(bucket.count)));
              }))),
            h("p", { className: "dga-hint" },
              "基础出率 1.6%，折算约 " + a.expectedAverage + " 抽一个五星；「欧非比」>1 表示比基础出率更欧。"))
        : null,

      h("p", { className: "dga-hint" },
        "「距离上次五星」= 该池子自上一个五星之后又抽了多少次，用来判断保底进度。"));
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
  function exportCharacterImage(c) {
    var W = 760;
    var H = 460;
    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");
    var accent = elementColor(c.element);

    var bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#171b23");
    bg.addColorStop(1, "#0f1218");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(0, 0, W, 6);
    ctx.globalAlpha = 1;

    var images = [loadArt(c.icon), loadArt(c.equippedWeapon && c.equippedWeapon.icon)];
    var pieces = (c.equippedPieces || []).slice(0, 5);
    pieces.forEach(function (piece) { images.push(loadArt(piece.icon)); });

    Promise.all(images).then(function (loaded) {
      var avatar = loaded[0];
      var weaponIcon = loaded[1];
      if (avatar) {
        ctx.save();
        roundRect(ctx, 36, 40, 148, 148, 18);
        ctx.clip();
        ctx.drawImage(avatar, 36, 40, 148, 148);
        ctx.restore();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        roundRect(ctx, 36, 40, 148, 148, 18);
        ctx.stroke();
      }

      ctx.fillStyle = "#f2f4f8";
      ctx.font = "600 34px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillText(c.name || "", 208, 84);

      ctx.fillStyle = "#a9b1c1";
      ctx.font = "16px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillText(
        "Lv." + c.level + " · " + (c.rarity || 0) + "★ · " + (c.elementZh || c.element || "") +
        " · " + (c.weaponTypeZh || c.weaponType || ""),
        208, 114,
      );
      ctx.fillText("命之座 " + (c.constellation || 0), 208, 140);
      if (c.talents) {
        ctx.fillText(
          "天赋 " + [c.talents.auto, c.talents.skill, c.talents.burst]
            .map(function (v) { return v == null ? "-" : v; }).join(" / "),
          208, 166,
        );
      }

      // weapon line
      var y = 206;
      if (weaponIcon) ctx.drawImage(weaponIcon, 36, y - 22, 44, 44);
      ctx.fillStyle = "#e6e8ee";
      ctx.font = "600 18px system-ui, -apple-system, 'Segoe UI', sans-serif";
      var weapon = c.equippedWeapon;
      ctx.fillText(weapon ? weapon.name : "未装备武器", 92, y);
      if (weapon) {
        ctx.fillStyle = "#a9b1c1";
        ctx.font = "15px system-ui, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText(
          "Lv." + weapon.level + (weapon.refinement ? " · 精" + weapon.refinement : "") + " · " + weapon.rarity + "★",
          92, y + 24,
        );
      }

      // artifact pieces
      ctx.fillStyle = "#a9b1c1";
      ctx.font = "15px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillText("已装备圣遗物", 36, 296);
      pieces.forEach(function (piece, index) {
        var x = 36 + index * 140;
        var icon = loaded[2 + index];
        if (icon) ctx.drawImage(icon, x, 312, 56, 56);
        ctx.fillStyle = "#e6e8ee";
        ctx.font = "14px system-ui, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText((SLOT_ZH[piece.slot] || ""), x, 390);
        ctx.fillStyle = "#a9b1c1";
        ctx.font = "13px system-ui, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText("+" + (piece.level == null ? "-" : piece.level), x, 410);
      });

      if (!pieces.length) {
        ctx.fillStyle = "#6f7787";
        ctx.font = "14px system-ui, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText("（没有圣遗物数据）", 36, 330);
      }

      ctx.fillStyle = "#6f7787";
      ctx.font = "13px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillText("dsh-genshin-account · " + new Date().toLocaleDateString("zh-CN"), 36, H - 20);

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

    var artifactsState = React.useState([]);
    var artifacts = artifactsState[0], setArtifacts = artifactsState[1];
    var artifactsLoadingState = React.useState(false);
    var artifactsLoading = artifactsLoadingState[0], setArtifactsLoading = artifactsLoadingState[1];

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
      var snap = formSnapshot();
      if (!form || !snap) return Promise.reject(new Error("配置表单不可用（插件配置未就绪）"));
      var current = snap.value || {};
      var ops = [];
      Object.keys(fields).forEach(function (key) {
        var next = fields[key];
        var prev = current[key];
        if (next === prev) return;
        ops.push({ op: "set", path: [key], value: next });
      });
      if (!ops.length) return Promise.resolve(true);
      return form.mutate(ops, snap.revision);
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
            // Land on the wizard until the account actually renders.
            if (state.configured === false) setTab("settings");
          }
          if (!data || data.ok === false) {
            var reason = (data && data.error) || "";
            if (reason) showMessage(reason, true);
            offerVerification(reason);
            return;
          }
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
      if (tab !== "artifacts" || artifacts.length) return;
      setArtifactsLoading(true);
      getJson("/artifacts?limit=60")
        .then(function (data) { if (data && data.ok) setArtifacts(data.artifacts || []); })
        .catch(function () {})
        .then(function () { setArtifactsLoading(false); });
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
        setArtifacts([]);
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
      persist({ source: "miyoushe", miyousheCookie: cookie })
        .then(function (accepted) {
          if (accepted === false) throw new Error("部署未接受登录得到的 Cookie");
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
      { id: "artifacts", label: "圣遗物" },
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
        onRefresh: function () { loadSummary(true); },
        verifyInline: verifyInline,
        onFrameLoad: onFrameLoad,
        onFrameError: onFrameError,
        verifyTask: verifyTask,
        verifyStatus: verifyStatus,
        verifyBusy: verifyBusy,
        verifyBoxRef: verifyBoxRef,
      });
    } else if (loading && !summary) {
      body = h("div", { className: "dga-empty" }, "读取中…");
    } else if (!summary) {
      body = h("div", { className: "dga-empty" },
        "还没有可显示的数据。" + (configured === false ? "先到「设置」里选一种数据源。" : "配置好数据源后点右上角「同步」。"));
    } else if (tab === "overview") {
      body = h(OverviewTab, {
        overview: summary.overview,
        topCharacters: (summary.characters || []).slice(0, 8),
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
        analysis: gacha ? gacha.analysis : null,
        busy: gachaBusy,
        status: gachaStatus,
        url: gachaUrl,
        onUrl: setGachaUrl,
        onSync: function () { runGachaSync(); },
        onSyncManual: function () { runGachaSync(gachaUrl); },
      });
    } else if (tab === "weapons") {
      body = h(WeaponsTab, { rows: weapons, loading: weaponsLoading });
    } else {
      body = h(ArtifactsTab, { rows: artifacts, loading: artifactsLoading });
    }

    return h("div", { className: "dga-root" },
      h("div", { className: "dga-head" },
        h("div", { className: "dga-grow" },
          h("div", { className: "dga-title" }, "原神账号"),
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
          onClick: function () { setTab(item.id); },
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
              "原神账号面板渲染出错：\n" +
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
          { name: "sidebar.panellist", id: PANEL_ID, order: 20, label: function () { return "原神账号"; }, registrant: PKG },
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
  return module.exports;
}});
