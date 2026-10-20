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
// Nothing here talks to a business service: everything is read from the host's
// same-origin JSON routes mounted by ../lib/index.js.
window.__ModuleLoader__.load({ id: "dsh-genshin-account", factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

  var React = require("react");
  var h = React.createElement;

  var PKG = "dsh-genshin-account";
  var PANEL_ID = "genshin";
  var API = "/dsh-genshin-account";

  var ELEMENT_COLOR = {
    pyro: "#ef7938", hydro: "#4cc2f1", anemo: "#74c2a8", electro: "#af8ec1",
    dendro: "#a5c83b", cryo: "#9fd6e3", geo: "#fab632", none: "#9aa0a6",
  };
  var SLOT_ZH = { flower: "生之花", plume: "死之羽", sands: "时之沙", goblet: "空之杯", circlet: "理之冠" };

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

  function postJson(path) {
    return fetch(API + path, { method: "POST", headers: { accept: "application/json" } }).then(function (res) {
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

  var SOURCE_LABEL = { good: "本地 GOOD 文件", enka: "Enka.Network", miyoushe: "米游社" };

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

  function Problem(props) {
    if (!props.error) return null;
    return h("div", { className: "dga-err" }, props.error + (props.hint ? "\n" + props.hint : ""));
  }

  // ── tabs ─────────────────────────────────────────────────────────────────
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
      elements.length ? h("div", { className: "dga-block" },
        h("div", { className: "dga-sec" }, "元素分布"),
        h("div", null, elements.map(function (zh) {
          return h("span", { className: "dga-chip", key: zh }, zh + " " + o.elements[zh]);
        }))) : null,
      o.bestArtifact ? h("div", { className: "dga-block" },
        h("div", { className: "dga-sec" }, "最佳圣遗物"),
        h("div", { className: "dga-sub" },
          o.bestArtifact.setName + " " + o.bestArtifact.slotZh +
          " · CV " + o.bestArtifact.cv + " · 效率 " + o.bestArtifact.efficiency + "%" +
          (o.bestArtifact.owner ? " · " + o.bestArtifact.owner : ""))) : null,
      h("div", { className: "dga-block" },
        h("div", { className: "dga-sec" }, "数据来源"),
        h("div", { className: "dga-sub" },
          (SOURCE_LABEL[o.source] || o.source) + (o.note ? " · " + o.note : ""))),
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
      statDefs.length ? h("div", { className: "dga-statline" }, statDefs.map(function (pair) {
        return h(Stat, { label: pair[0], value: String(pair[1]), key: pair[0] });
      })) : null,

      c.weapon ? h("div", { className: "dga-block", style: { marginTop: 16 } },
        h("div", { className: "dga-sec" }, "武器"),
        h("div", null,
          c.weapon.name + "  Lv." + c.weapon.level +
          (c.weapon.refinement ? "  精" + c.weapon.refinement : "") +
          "  " + c.weapon.rarity + "★")) : null,

      c.sets && c.sets.length ? h("div", { className: "dga-block" },
        h("div", { className: "dga-sec" }, "套装"),
        h("div", null, c.sets.map(function (s) {
          return h("span", { className: "dga-chip", key: s.setName }, s.setName + " ×" + s.count);
        }))) : null,

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
            h("td", null, h("span", { className: "dga-grade" }, a.grade || "") , " " + a.efficiency + "%"),
            h("td", null, a.owner || h("span", { className: "dga-muted" }, "—")));
        }))));
  }

  // ── page ────────────────────────────────────────────────────────────────
  function GenshinPage() {
    var tabState = React.useState("overview");
    var tab = tabState[0], setTab = tabState[1];

    var summaryState = React.useState(null);
    var summary = summaryState[0], setSummary = summaryState[1];

    var errorState = React.useState("");
    var error = errorState[0], setError = errorState[1];

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

    var artifactsState = React.useState([]);
    var artifacts = artifactsState[0], setArtifacts = artifactsState[1];
    var artifactsLoadingState = React.useState(false);
    var artifactsLoading = artifactsLoadingState[0], setArtifactsLoading = artifactsLoadingState[1];
    var weaponsLoadingState = React.useState(false);
    var weaponsLoading = weaponsLoadingState[0], setWeaponsLoading = weaponsLoadingState[1];

    var syncState = React.useState(false);
    var syncing = syncState[0], setSyncing = syncState[1];

    function loadSummary(force) {
      setLoading(true);
      var request = force ? postJson("/sync") : getJson("/summary");
      return request
        .then(function (data) {
          if (!data || data.ok === false) {
            setError((data && data.error) || "读取失败");
            setSummary(null);
            return;
          }
          setError("");
          setSummary(data);
        })
        .catch(function (failure) {
          setError(String(failure && failure.message ? failure.message : failure));
        })
        .then(function () { setLoading(false); });
    }

    function loadCharacter(name) {
      if (!name) return;
      setCharLoading(true);
      getJson("/character?name=" + encodeURIComponent(name))
        .then(function (data) {
          setCharacter(data && data.ok ? data.character : null);
          if (data && data.ok === false) setError(data.error || "");
        })
        .catch(function (failure) { setError(String(failure && failure.message ? failure.message : failure)); })
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

    // Auto-select the first character the first time the list arrives.
    React.useEffect(function () {
      if (!summary || !summary.characters || !summary.characters.length) return;
      if (character) return;
      loadCharacter(summary.characters[0].name);
    }, [summary]);

    function onSync() {
      setSyncing(true);
      loadSummary(true)
        .then(function () {
          setWeapons([]);
          setArtifacts([]);
          if (character) loadCharacter(character.name);
        })
        .then(function () { setSyncing(false); });
    }

    var tabs = [
      { id: "overview", label: "概览" },
      { id: "characters", label: "角色" },
      { id: "weapons", label: "武器" },
      { id: "artifacts", label: "圣遗物" },
    ];

    var configHint = summary && summary.state && summary.state.configured === false
      ? "还没有配置数据源：打开 设置 → 插件 → dsh-genshin-account，选择数据源并填写 GOOD 文件路径 / UID / Cookie。"
      : "";

    return h("div", { className: "dga-root" },
      h("div", { className: "dga-head" },
        h("div", { className: "dga-grow" },
          h("div", { className: "dga-title" }, "原神账号"),
          h("div", { className: "dga-sub" },
            summary && summary.state
              ? (SOURCE_LABEL[summary.state.source] || summary.state.source) +
                (summary.state.uid ? " · UID " + summary.state.uid : "") +
                " · 同步于 " + when(summary.state.fetchedAt)
              : loading ? "读取中…" : "尚未同步")),
        h("button", { className: "dga-btn dga-btn-primary", onClick: onSync, disabled: syncing }, syncing ? "同步中…" : "同步")),
      h("div", { className: "dga-tabs" }, tabs.map(function (item) {
        return h("button", {
          key: item.id,
          className: "dga-tab" + (tab === item.id ? " dga-tab-on" : ""),
          onClick: function () { setTab(item.id); },
        }, item.label);
      })),
      error || configHint
        ? h("div", { style: { padding: "12px 20px 0" } }, h(Problem, { error: error, hint: configHint }))
        : null,
      loading && !summary
        ? h("div", { className: "dga-empty" }, "读取中…")
        : !summary
          ? h("div", { className: "dga-empty" }, "还没有可显示的数据。配置好数据源后点右上角「同步」。")
          : tab === "overview"
            ? h(OverviewTab, { overview: summary.overview })
            : tab === "characters"
              ? h(CharactersTab, {
                  summary: summary,
                  query: query,
                  onQuery: setQuery,
                  selected: character,
                  loading: charLoading,
                  onSelect: function (name) { setCharacter(null); loadCharacter(name); },
                })
              : tab === "weapons"
                ? h(WeaponsTab, { rows: weapons, loading: weaponsLoading })
                : h(ArtifactsTab, { rows: artifacts, loading: artifactsLoading }));
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

  function apply(ctx) {
    ensureCss();
    // `main` first: the sidebar's click validates the key against the live
    // `main` entries, so the panel must exist before the icon can be pressed.
    ctx.slots.inject("main", function () {
      return ctx.slots.register({ name: "main", key: PANEL_ID, registrant: PKG }, GenshinPage);
    });
    ctx.slots.inject("sidebar.panellist", function () {
      return ctx.slots.register(
        { name: "sidebar.panellist", id: PANEL_ID, order: 20, label: function () { return "原神账号"; }, registrant: PKG },
        GenshinIcon,
      );
    });
  }

  exports.name = PKG;
  exports.inject = ["slots"];
  exports.apply = apply;
  return module.exports;
}});
