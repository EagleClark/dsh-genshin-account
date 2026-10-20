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

  var SOURCE_LABEL = { good: "本地 GOOD 文件", enka: "Enka.Network", miyoushe: "米游社（国服）" };

  /** One card per data source: what it reads, and its catch. */
  var SOURCES = [
    {
      id: "good",
      name: "本地 GOOD 文件",
      badge: "推荐",
      reads: "完整背包：全部角色、全部武器、全部圣遗物（含每条副词条）",
      limits: "需要先用导出工具生成一份 JSON；角色/圣遗物变动后要重新导出",
      servers: "国服 / 国际服都行",
    },
    {
      id: "enka",
      name: "Enka.Network",
      badge: "",
      reads: "角色展柜上的角色详情（最多 8 个）：等级、命座、天赋、武器、圣遗物",
      limits: "只有展柜角色；国服 UID 不支持；国内网络常连不上 enka.network",
      servers: "仅国际服",
    },
    {
      id: "miyoushe",
      name: "米游社（国服）",
      badge: "",
      reads: "账号概览 + 全部角色列表 + 已公开角色详情的天赋/武器/圣遗物",
      limits: "只对「角色详情已公开」的角色返回详细数据；官方改版时签名会失效",
      servers: "国服",
    },
  ];

  /** Step lists shown under the selected source card. */
  var GUIDES = {
    good: [
      "装一个导出工具：Amenoma（最省事）、Genshin Optimizer、或 Inventory Kamera",
      "在工具里读取你的角色（展柜或本地背包），导出为 GOOD 格式的 JSON",
      "回到这里点「选择 GOOD 文件」并选中那个 JSON —— 不需要手填路径",
    ],
    enka: [
      "在游戏里：派蒙菜单 → 角色 → 展柜设置，把想看的角色放上展柜，并设为「公开」",
      "确认 UID 是国际服（6/7/8/9 开头）；1/2/5 开头的国服 UID 查不到",
      "填入 UID 后点「保存并同步」",
    ],
    miyoushe: [
      "浏览器登录 bbs.mihoyo.com，并确认米游社「我的角色」→ 设置里已开启角色详情公开",
      "F12 → Application（应用）→ Cookies → bbs.mihoyo.com",
      "复制 ltuid_v2、ltoken_v2、ltmid_v2 三项，拼成 ltuid_v2=…; ltoken_v2=…; ltmid_v2=…",
      "粘贴到下面并点「保存并同步」",
    ],
  };

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
    var state = props.state || {};
    var sources = state.sources || {};
    var set = props.setField;

    var card = function (source) {
      var on = draft.source === source.id;
      var status = sources[source.id] || {};
      return h("button", {
        key: source.id,
        type: "button",
        className: "dga-src" + (on ? " dga-src-on" : ""),
        onClick: function () { props.setSource(source.id); },
        "aria-pressed": on,
      },
        h("span", { className: "dga-radio" + (on ? " dga-radio-on" : "") }),
        h("span", { style: { flex: 1, minWidth: 0 } },
          h("span", { className: "dga-srcName" },
            source.name,
            source.badge ? h("span", { className: "dga-badge" }, source.badge) : null,
            status.configured ? h("span", { className: "dga-badge dga-badgeOk" }, "已配置") : null),
          h("div", { className: "dga-srcDesc" }, source.reads),
          h("div", { className: "dga-srcLimit" }, source.limits + " · " + source.servers)),
      );
    };

    var guide = GUIDES[draft.source] || [];
    var fields = null;

    if (draft.source === "good") {
      fields = h("div", null,
        h("div", { className: "dga-field" },
          h("label", { className: "dga-label" }, "GOOD 文件"),
          h("div", { className: "dga-fileRow" },
            h("button", { className: "dga-btn dga-btn-primary", onClick: props.onPickFile, disabled: props.busy }, "选择 GOOD 文件…"),
            h("input", {
              type: "file",
              accept: ".json,application/json",
              style: { display: "none" },
              ref: props.fileInputRef,
              onChange: props.onFileChange,
            }),
            draft.goodPath
              ? h("span", { className: "dga-path" }, draft.goodPath)
              : h("span", { className: "dga-muted" }, "还没有选择文件")),
          h("p", { className: "dga-hint" }, "文件只在本机读取，会被复制到 DSH 数据目录，不会上传到任何服务器。")));
    } else if (draft.source === "enka") {
      fields = h("div", null,
        h("div", { className: "dga-field" },
          h("label", { className: "dga-label" }, "国际服 UID"),
          h("input", {
            className: "dga-input",
            type: "text",
            inputMode: "numeric",
            placeholder: "例如 812345678",
            value: draft.enkaUid,
            onChange: function (event) { set("enkaUid", event.target.value.trim()); },
          }),
          h("p", { className: "dga-hint" }, "8/9 开头是亚服，6 美服，7 欧服。1/2/5 开头的国服 UID Enka 不支持。")));
    } else {
      fields = h("div", null,
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
            "服务器按 UID 自动判断：1/2/3 → 官服（天空岛），5 → 渠道服（世界树）。当前：" +
            (draft.miyousheServer || "（自动）"))),
        h("div", { className: "dga-field" },
          h("label", { className: "dga-label" }, "米游社 Cookie"),
          h("textarea", {
            className: "dga-input dga-textarea",
            placeholder: draft.hasCookie ? "已保存 Cookie（留空表示不修改）" : "ltuid_v2=…; ltoken_v2=…; ltmid_v2=…",
            value: draft.miyousheCookie,
            onChange: function (event) { set("miyousheCookie", event.target.value); },
          }),
          h("p", { className: "dga-hint" }, "Cookie 等同于登录凭据，会明文保存在本机 profile 配置里。只想读数据的话，优先用 GOOD 文件。")));
    }

    return h("div", { className: "dga-scroll" },
      h("div", { className: "dga-wizard" },
        h("div", { className: "dga-block" },
          h("div", { className: "dga-sec" }, "选择数据源"),
          h("div", { className: "dga-srcList" }, SOURCES.map(card))),

        h("div", { className: "dga-block" },
          h("div", { className: "dga-sec" }, (SOURCE_LABEL[draft.source] || draft.source) + " 的配置"),
          fields,
          h("p", { className: "dga-hint" }, "怎么拿到这些数据："),
          h("ol", { className: "dga-steps" }, guide.map(function (line, index) {
            return h("li", { key: index }, line);
          }))),

        h("details", { className: "dga-adv" },
          h("summary", null, "高级设置"),
          h("div", { style: { marginTop: 12 } },
            draft.source === "enka"
              ? h("div", { className: "dga-field" },
                  h("label", { className: "dga-label" }, "接口地址"),
                  h("input", {
                    className: "dga-input",
                    type: "text",
                    value: draft.enkaBase,
                    onChange: function (event) { set("enkaBase", event.target.value.trim()); },
                  }),
                  h("p", { className: "dga-hint" }, "连接不上 enka.network 时，可以填一个可达的镜像地址。"))
              : null,
            draft.source === "miyoushe"
              ? h("div", null,
                  h("div", { className: "dga-field" },
                    h("label", { className: "dga-label" }, "签名盐 miyousheDsSalt"),
                    h("input", {
                      className: "dga-input",
                      type: "text",
                      placeholder: "留空使用内置默认值",
                      value: draft.miyousheDsSalt,
                      onChange: function (event) { set("miyousheDsSalt", event.target.value.trim()); },
                    })),
                  h("div", { className: "dga-field" },
                    h("label", { className: "dga-label" }, "app_version"),
                    h("input", {
                      className: "dga-input",
                      type: "text",
                      placeholder: "留空使用内置默认值",
                      value: draft.miyousheAppVersion,
                      onChange: function (event) { set("miyousheAppVersion", event.target.value.trim()); },
                    })),
                  h("p", { className: "dga-hint" }, "只有出现「签名被拒绝 retcode=-10001」时才需要动这里，而且两个值必须配对更新。"))
              : null,
            h("div", { className: "dga-field" },
              h("label", { className: "dga-label" }, "缓存时间（秒）"),
              h("input", {
                className: "dga-input",
                type: "number",
                value: String(draft.cacheSeconds),
                onChange: function (event) { set("cacheSeconds", Number(event.target.value) || 0); },
              }),
              h("p", { className: "dga-hint" }, "这段时间内重复查询直接用缓存，避免频繁打接口。")))),

        h("div", { className: "dga-actions" },
          h("button", { className: "dga-btn dga-btn-primary", onClick: props.onSaveAndSync, disabled: props.busy }, props.busy ? "处理中…" : "保存并同步"),
          h("button", { className: "dga-btn", onClick: props.onSaveOnly, disabled: props.busy }, "仅保存"),
          h("span", { className: "dga-msg" }, props.message || "")),
        !props.writable
          ? h("p", { className: "dga-hint", style: { marginTop: 12 } },
              "当前页面无法写入配置（可能不是从本机打开，或插件配置未就绪）。可以直接编辑 profile 的 cordis.patch.yml。")
          : null));
  }

  // ── data tabs ───────────────────────────────────────────────────────────
  function OverviewTab(props) {
    var o = props.overview;
    var player = o.player || {};
    var items = [
      { label: "角色", value: String(o.counts.characters) },
      { label: "武器", value: String(o.counts.weapons) },
      { label: "圣遗物", value: String(o.counts.artifacts) },
      { label: "五星圣遗物", value: String(o.counts.fiveStarArtifacts || 0) },
    ];
    var elements = Object.keys(o.elements || {});
    return h("div", { className: "dga-scroll" },
      h("div", { className: "dga-block" },
        h("div", { className: "dga-sec" }, player.nickname ? player.nickname : "账号概览"),
        h("div", { className: "dga-sub" },
          [
            o.uid ? "UID " + o.uid : "",
            player.level ? "冒险等级 " + player.level : "",
            player.worldLevel ? "世界等级 " + player.worldLevel : "",
            player.region || "",
          ].filter(Boolean).join(" · "))),
      h(Cards, { items: items }),
      elements.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "元素分布"),
            h("div", null, elements.map(function (zh) {
              return h("span", { className: "dga-chip", key: zh }, zh + " " + o.elements[zh]);
            })))
        : null,
      o.bestArtifact
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "最佳圣遗物"),
            h("div", { className: "dga-sub" },
              o.bestArtifact.setName + " " + o.bestArtifact.slotZh +
              " · CV " + o.bestArtifact.cv + " · 效率 " + o.bestArtifact.efficiency + "%" +
              (o.bestArtifact.owner ? " · " + o.bestArtifact.owner : "")))
        : null,
      h("div", { className: "dga-block" },
        h("div", { className: "dga-sec" }, "数据来源"),
        h("div", { className: "dga-sub" }, (SOURCE_LABEL[o.source] || o.source) + (o.note ? " · " + o.note : ""))),
      h("div", { className: "dga-sub" }, "同步时间：" + when(o.fetchedAt)));
  }

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

    return h("div", null,
      h("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 } },
        h(Dot, { element: c.element }),
        h("div", { className: "dga-title" }, c.name),
        h("span", { className: "dga-sub" },
          "Lv." + c.level + " · " + c.rarity + "★ · " + c.element + " · " + c.weaponType)),
      h("div", { className: "dga-sub" },
        "命之座 " + c.constellation +
        (c.talents ? " · 天赋 " + c.talents.auto + " / " + c.talents.skill + " / " + c.talents.burst : "")),
      statDefs.length
        ? h("div", { className: "dga-statline" }, statDefs.map(function (pair) {
            return h(Stat, { label: pair[0], value: String(pair[1]), key: pair[0] });
          }))
        : null,

      c.weapon
        ? h("div", { className: "dga-block", style: { marginTop: 16 } },
            h("div", { className: "dga-sec" }, "武器"),
            h("div", null,
              c.weapon.name + "  Lv." + c.weapon.level +
              (c.weapon.refinement ? "  精" + c.weapon.refinement : "") +
              "  " + c.weapon.rarity + "★"))
        : null,

      c.sets && c.sets.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "套装"),
            h("div", null, c.sets.map(function (s) {
              return h("span", { className: "dga-chip", key: s.setName }, s.setName + " ×" + s.count);
            })))
        : null,

      c.artifacts && c.artifacts.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "圣遗物"),
            h("table", { className: "dga-table" },
              h("thead", null, h("tr", null,
                h("th", null, "部位"), h("th", null, "套装"), h("th", null, "主词条"),
                h("th", null, "副词条"), h("th", null, "CV"), h("th", null, "效率"))),
              h("tbody", null, c.artifacts.map(function (a, index) {
                return h("tr", { key: index },
                  h("td", null, a.slotZh),
                  h("td", null, a.setName + (a.rarity ? " " + a.rarity + "★" : "") + (a.level ? " +" + a.level : "")),
                  h("td", { className: "dga-num" }, a.main),
                  h("td", { className: "dga-subs" }, (a.subs || []).join(" / ")),
                  h("td", { className: "dga-num" }, String(a.cv)),
                  h("td", { className: "dga-num" }, a.efficiency + "% " + (a.grade || "")));
              }))))
        : h("div", { className: "dga-empty" }, "这个角色在当前数据源里没有圣遗物数据。"),

      c.setEffects && c.setEffects.length
        ? h("div", { className: "dga-block" },
            h("div", { className: "dga-sec" }, "生效套装效果"),
            c.setEffects.map(function (effect, index) {
              return h("p", { className: "dga-effect", key: index }, "· " + effect);
            }))
        : null);
  }

  function CharactersTab(props) {
    var snapshot = props.summary;
    var list = snapshot.characters || [];
    var query = props.query;
    var filtered = query
      ? list.filter(function (c) { return String(c.name).indexOf(query) >= 0 || String(c.elementZh || "").indexOf(query) >= 0; })
      : list;
    var selected = props.selected;

    return h("div", { className: "dga-body" },
      h("div", { className: "dga-col-list" },
        h("input", {
          className: "dga-searcher",
          placeholder: "搜索角色…",
          value: query,
          onChange: function (event) { props.onQuery(event.target.value); },
        }),
        filtered.map(function (c) {
          return h("div", {
            key: c.id,
            className: "dga-row" + (selected && selected.id === c.id ? " dga-row-on" : ""),
            onClick: function () { props.onSelect(c.name); },
          },
            h(Dot, { element: c.element }),
            h("span", { className: "dga-rowname" }, c.name),
            h("span", { className: "dga-rowlv" }, "Lv." + c.level));
        })),
      h("div", { className: "dga-col-detail" },
        props.loading ? h("div", { className: "dga-empty" }, "读取中…") : h(CharacterDetail, { character: props.selected })));
  }

  function WeaponsTab(props) {
    var rows = props.rows || [];
    if (props.loading) return h("div", { className: "dga-empty" }, "读取中…");
    if (!rows.length) return h("div", { className: "dga-empty" }, "当前数据源没有武器数据（GOOD 文件才包含完整武器背包）。");
    return h("div", { className: "dga-scroll" },
      h("table", { className: "dga-table" },
        h("thead", null, h("tr", null,
          h("th", null, "武器"), h("th", null, "类型"), h("th", null, "稀有度"),
          h("th", null, "等级"), h("th", null, "精炼"), h("th", null, "装备角色"))),
        h("tbody", null, rows.map(function (w, index) {
          return h("tr", { key: index },
            h("td", null, w.name),
            h("td", null, w.typeZh),
            h("td", { className: "dga-num" }, w.rarity + "★"),
            h("td", { className: "dga-num" }, "Lv." + w.level),
            h("td", { className: "dga-num" }, w.refinement ? "精" + w.refinement : "—"),
            h("td", null, w.owner || h("span", { className: "dga-muted" }, "未装备")));
        }))));
  }

  function ArtifactsTab(props) {
    var rows = props.rows || [];
    if (props.loading) return h("div", { className: "dga-empty" }, "读取中…");
    if (!rows.length) return h("div", { className: "dga-empty" }, "当前数据源没有圣遗物数据。");
    return h("div", { className: "dga-scroll" },
      h("table", { className: "dga-table" },
        h("thead", null, h("tr", null,
          h("th", null, "部位"), h("th", null, "套装"), h("th", null, "主词条"),
          h("th", null, "副词条"), h("th", null, "CV"), h("th", null, "评价"), h("th", null, "角色"))),
        h("tbody", null, rows.map(function (a, index) {
          return h("tr", { key: index },
            h("td", null, a.slotZh),
            h("td", null, a.setName + " " + a.rarity + "★ +" + a.level),
            h("td", { className: "dga-num" }, a.main),
            h("td", { className: "dga-subs" }, (a.subs || []).join(" / ")),
            h("td", { className: "dga-num" }, String(a.cv)),
            h("td", null, h("span", { className: "dga-grade" }, a.grade || ""), " " + a.efficiency + "%"),
            h("td", null, a.owner || h("span", { className: "dga-muted" }, "—")));
        }))));
  }

  // ── page ────────────────────────────────────────────────────────────────
  function draftFrom(config) {
    var c = config || {};
    return {
      source: c.source || "good",
      goodPath: c.goodPath || "",
      enkaUid: c.enkaUid || "",
      enkaBase: c.enkaBase || "https://enka.network",
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

    var fileInputRef = React.useRef(null);

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
            if (data && data.error) showMessage(data.error, true);
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
    }, []);

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
        goodPath: draft.goodPath,
        enkaUid: draft.enkaUid,
        enkaBase: draft.enkaBase,
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
            showMessage((data && data.error) || "同步失败", true);
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

    function onPickFile() {
      var input = fileInputRef.current;
      if (input) input.click();
    }

    /** Browser file → host (validates + stores), then point the config at it. */
    function onFileChange(event) {
      var input = event.target;
      var file = input && input.files && input.files[0] ? input.files[0] : null;
      if (!file) return;
      setBusy(true);
      showMessage("读取 " + file.name + " …");
      file
        .text()
        .then(function (text) { return postJson("/upload-good", text); })
        .then(function (data) {
          if (!data || data.ok === false) throw new Error((data && data.error) || "导入失败");
          setField("goodPath", data.path);
          setField("source", "good");
          showMessage("已导入 " + (data.summary.characters || 0) + " 个角色、" +
            (data.summary.weapons || 0) + " 把武器、" + (data.summary.artifacts || 0) + " 件圣遗物，正在同步…");
          return persist({ source: "good", goodPath: data.path }).then(function (accepted) {
            if (accepted === false) throw new Error("部署未接受这些值");
            return postJson("/sync");
          });
        })
        .then(function (data) {
          if (!data || data.ok === false) {
            showMessage((data && data.error) || "同步失败", true);
            loadSummary(false);
            return;
          }
          setSummary(data);
          setDraft(draftFrom((data.state && data.state.config) || {}));
          showMessage("导入并同步完成：" + data.characters.length + " 个角色");
          setTab("overview");
        })
        .catch(function (failure) {
          showMessage(String(failure && failure.message ? failure.message : failure), true);
        })
        .then(function () {
          setBusy(false);
          if (input) input.value = "";
        });
    }

    var tabs = [
      { id: "overview", label: "概览" },
      { id: "characters", label: "角色" },
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
        onPickFile: onPickFile,
        onFileChange: onFileChange,
        fileInputRef: fileInputRef,
      });
    } else if (loading && !summary) {
      body = h("div", { className: "dga-empty" }, "读取中…");
    } else if (!summary) {
      body = h("div", { className: "dga-empty" },
        "还没有可显示的数据。" + (configured === false ? "先到「设置」里选一种数据源。" : "配置好数据源后点右上角「同步」。"));
    } else if (tab === "overview") {
      body = h(OverviewTab, { overview: summary.overview });
    } else if (tab === "characters") {
      body = h(CharactersTab, {
        summary: summary,
        query: query,
        onQuery: setQuery,
        selected: character,
        loading: charLoading,
        onSelect: function (name) { setCharacter(null); loadCharacter(name); },
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
