# dsh-genshin-account

DeepSeek Harness 插件：把**你的原神账号**读进来 —— 角色练度、命座、天赋、面板、武器、圣遗物 —— 然后在**对话里直接问**（agent 调用工具查），也能在 **GUI 里看**（侧边栏「原神账号」页面）。

A DeepSeek Harness plugin that reads your Genshin Impact account (characters, talents, weapons, artifacts) into one canonical snapshot and exposes it both as **agent tools** and as a **GUI page**.

---

## 先说清楚：数据从哪来

原神**没有官方公开的账号数据 API**。这个插件不碰游戏内存、不解包、不登录游戏客户端，只做三件事之一：

| 数据源 | 能读到什么 | 服务器 | 需要什么 | 稳定性 |
| --- | --- | --- | --- | --- |
| **`good`** 本地 GOOD 文件 | **完整背包**：全部角色、全部武器、全部圣遗物（含每条副词条与强化次数） | 任意（国服/国际服都行） | 用 Amenoma / Genshin Optimizer / Inventory Kamera 导出一次 JSON | ⭐ 最稳，纯本地离线 |
| **`enka`** Enka.Network | **只有角色展柜上的角色**（最多 8 个），含其武器与圣遗物详情 | **仅国际服**（亚/美/欧/台港澳，UID 6/7/8/9 开头） | 国际服 UID + 展柜公开 | 中；国内网络常连不上 enka.network |
| **`miyoushe`** 米游社 | 账号概览 + 所有角色列表 + **已公开角色详情**（天赋/武器/圣遗物主副词条） | **国服**（UID 1/2/5 开头） | 米游社登录 Cookie | 中；官方换签名盐/风控时需更新配置 |

> 一句话建议：**国服、想要完整数据 → 用 `good`**。`enka` / `miyoushe` 都是「角色展柜」级别的数据，只能看到你放进展柜的那几个角色，不含整个背包。

---

## 安装

直接从 GitHub 安装：

```sh
dsh plugin --profile web add github:EagleClark/dsh-genshin-account
```

本地开发时也可以装成本地 link（改动即时生效）：

```sh
dsh plugin --profile web add <仓库绝对路径>
```

装完**重启 `dsh web`**（或重启 Desktop），刷新页面。之后侧边栏会多一个「原神账号」图标。

---

## 配置

打开 **设置 → 插件 → dsh-genshin-account**，配置项直接由插件自身的 Config schema 生成：

| 字段 | 说明 |
| --- | --- |
| `source` | 数据源：`good` / `enka` / `miyoushe` |
| `goodPath` | GOOD 格式 JSON 的**绝对路径** |
| `enkaUid` / `enkaBase` | 国际服 UID；接口地址（默认 `https://enka.network`，国内不通时填自建镜像） |
| `miyousheUid` / `miyousheServer` / `miyousheCookie` | 国服 UID、`cn_gf01`（官服）/ `cn_qd01`（渠道服）、Cookie |
| `miyousheDsSalt` / `miyousheAppVersion` | 签名盐与版本号（默认已是当前值；官方改版报 `-10001` 时在此更新，**两者必须配对**） |
| `cacheSeconds` | 快照缓存秒数，默认 600 |

配置即时生效（全部字段 `volatile`），改完点页面右上角「同步」即可。

### 怎么拿 GOOD 文件

1. 装一个导出工具：**Amenoma**、**Genshin Optimizer**（导入 UID 后另存 GOOD）、或 **Inventory Kamera**。
2. 导出得到 `GOOD.json`，把绝对路径填进 `goodPath`。
3. 页面上点「同步」。

### 怎么拿米游社 Cookie

浏览器登录 `bbs.mihoyo.com` → 开发者工具 → Application/存储 → Cookies，复制 **`ltuid_v2`、`ltoken_v2`、`ltmid_v2`** 三项，拼成：

```
ltuid_v2=…; ltoken_v2=…; ltmid_v2=…
```

填进 `miyousheCookie`。**注意**：Cookie 等同于登录凭据，会以明文存在本机 profile 的 `cordis.patch.yml` 里；只想读数据的话，优先用 `good`。

---

## GUI 用法

点侧边栏「原神账号」图标，四个页签：

- **概览** —— 昵称/冒险等级、角色/武器/圣遗物数量、元素分布、最佳圣遗物、数据来源与同步时间
- **角色** —— 左侧可搜索角色列表，右侧看等级、命座、三段天赋、面板、武器、五件圣遗物（主词条/副词条/CV/效率/评价）与**生效中的套装效果原文**
- **武器** —— 类型/稀有度/等级/精炼/装备角色
- **圣遗物** —— 按暴击值排序，含主副词条、评价、所属角色

右上角「同步」强制重新读取数据源。

---

## Agent 工具

装好后 agent 自动获得 5 个工具，你可以直接在对话里问，例如：

> 「我胡桃的圣遗物怎么样，哪件该换？」
> 「我这个号有多少五星武器？」
> 「列出所有火系角色」
> 「圣遗物里暴击值最高的 10 件」

| 工具 | 作用 |
| --- | --- |
| `genshin_account_overview` | 账号总览（数据源、数量、元素分布、最佳圣遗物）；`refresh:true` 强制同步 |
| `genshin_characters` | 角色列表，按元素/武器类型/最低等级过滤，按等级/稀有度/名字/圣遗物 CV 排序 |
| `genshin_character` | 单个角色完整练度（支持 中文名 / 英文名 / GOOD key / 数字 id） |
| `genshin_artifacts` | 圣遗物筛选与排序（套装、部位、角色、最低 CV） |
| `genshin_weapons` | 武器筛选（类型、最低稀有度、是否已装备） |

工具返回结构化 JSON，同时渲染成给人看的文本；数据源不可用时返回**可读的错误**而不是抛异常，agent 会转告你该怎么配。

---

## 圣遗物评分怎么算

插件给每件圣遗物两个数，都可解释、都不假装是伤害计算：

- **CV（暴击值）** = `暴击率 × 2 + 暴击伤害`，只统计**副词条**。这是社区通用口径，与角色需求无关。
- **效率** = 每条副词条 `数值 ÷ 该词条 5★ 最高单次强化值`，求和后除以该圣遗物的强化位数（5★ +20 按 9 位，4★ +16 按 7 位）。100% = 每次强化都吃到最高档。
- **评价**（极品 / 优秀 / 可用 / 一般）由 CV 或效率任一达标决定。

这两项**不能替代**按角色配装的伤害模拟（元素精通、充能、特定套装 4 件套的价值因人而异）。插件会把套装 2/4 件套效果原文一起给出来，让 agent 结合角色判断。

---

## 随包数据与更新

`data/` 里是精简过的中文字典（约 100KB，离线可用，不依赖运行时网络）：

| 文件 | 内容 |
| --- | --- |
| `characters.json` | 124 个角色：中文名/英文名/元素/武器类型/稀有度/别名 |
| `weapons.json` | 255 把武器：中文名/类型/稀有度 |
| `artifact-sets.json` | 63 套圣遗物：中文名 + 2 件套 / 4 件套效果原文 |
| `aliases.json` | `"HuTao"` → `10000046` 这类 GOOD key 索引（大小写与标点无关） |
| `names-zh.json` | Enka 的 `nameTextMapHash` → 中文名（含 `FIGHT_PROP_*` 词条名） |
| `skill-orders.json` | 每个角色的「普攻/战技/爆发」技能 id 顺序 |

**为什么需要 `skill-orders.json`**：Enka 只给 `skillLevelMap`（技能 id → 等级），而技能 id **不是**按 普攻→战技→爆发 递增的（神里绫华的普攻 id 比爆发 id 大），按 id 排序会把天赋等级张冠李戴。

重新生成（需要网络，仅开发时）：

```sh
npm i -D genshin-db            # 或任意路径下有 genshin-db
node scripts/build-dict.mjs <genshin-db 路径>
node scripts/build-names.mjs
node scripts/build-skill-orders.mjs
```

游戏更新后角色/武器/圣遗物名字缺失时，重跑上面三条即可；插件本身不需要改代码。

---

## 工作原理

| 端 | 职责 |
| --- | --- |
| Host (`lib/index.js`) | 定义 Config；按 `source` 调度 `lib/sources/*`；把结果统一成一份 snapshot 后**内存 + 磁盘双缓存**（`$DSH_HOME/data/dsh-genshin-account/snapshot-<source>.json`），刷新失败时继续用上一份好数据；注册 5 个工具；用 `webServer` 挂 6 条同源 JSON 路由（`/state` `/summary` `/character` `/artifacts` `/weapons` `/sync`，`/sync` 只接受同源 POST） |
| `lib/model.js` | 三个来源 → 同一形状：解析名字/元素/部位、按 `location` 把武器与圣遗物挂回角色、排序与筛选、组装套装效果 |
| `lib/score.js` | CV / 效率 / 评价 |
| Client (`client/client.js`) | `window.__ModuleLoader__.load({ id, factory })` 包；`ctx.slots.inject` + 两次 `ctx.slots.register`（`main` 用 key `genshin`，`sidebar.panellist` 用同 id）——侧边栏按钮由 sidebar 自己渲染，插件只提供图标；样式全部走 `--dsw-*` 主题变量，自动跟随明暗主题 |

数据源被设计成**适配器**：新增一个来源只要实现 `fetchSnapshot(config)` 返回 canonical snapshot，再在 `SOURCES` 里登记。

---

## 已知限制

- **Enka 与国服无关**：1/2/5 开头的 UID 它不服务；国内网络通常也连不上 `enka.network`（可用 `enkaBase` 指向镜像）。
- **Enka / 米游社 只有展柜角色**（最多 8 个），且米游社只对「已公开角色详情」的角色返回天赋与圣遗物。
- **米游社接口是逆向接口**：签名盐与 `app_version` 会随官方改版失效（返回 `-10001`），此时在设置里更新这两个值；频繁查询会被限流（`-110`/`1028`/`10101`）。
- **GOOD 文件是快照**：升级角色/换圣遗物后要重新导出。
- CV / 效率是**通用质量指标**，不等于角色收益，更不是伤害计算。
- 4★ 圣遗物的强化位数按 7 位估算，与游戏内实际可能差一位。

---

## 验证状态

已用离线测试覆盖（`npm test`，全部通过）：

- `test/smoke-good.mjs` —— GOOD 解析、别名解析（中文名/GOOD key）、套装效果原文、CV/效率、筛选排序
- `test/smoke-enka.mjs` —— Enka 响应解析：`propMap` 等级、天赋顺序（用 `SkillOrder` 而非 id 排序）、`affixMap`→精炼、`fightPropMap` 面板、`icon`→套装 id、4★ 保留
- `test/smoke-miyoushe.mjs` —— DS2 签名格式（三段、t 为秒、r 范围、md5）、`base` 嵌套、`skill_type`→天赋、`property_map`→词条、百分比/固定值区分、套装名解析
- `test/smoke-host.mjs` —— 插件入口注册 5 个工具 + 6 条路由、渲染文本、软错误降级、跨源 POST 拒绝、缓存
- `test/smoke-client.mjs` —— 按 web boot 协议加载浏览器 bundle：注册 `main` + `sidebar.panellist` 且 key 一致、图标渲染 svg、页面渲染不抛错，并**逐个校验页面读取的字段都存在于 Host 返回的 JSON 里**（两半之间最容易出的契约错）

**未能在本机验证**（如实说明）：

- **Enka 真实联网**：本机访问 `enka.network` 超时，解析逻辑用合成响应验证。
- **米游社真实联网**：没有你的 Cookie，签名与响应结构依据公开实现（`genshin.py`）与文档，用合成响应验证。
- **GUI 真实渲染**：用桩 React + 桩 ctx 跑通了注册与渲染路径，但没在运行中的浏览器里点过；真实外观（尤其明暗主题下的排版）需要你打开页面确认。

---

## 许可

MIT。随包游戏数据由 [genshin-db](https://github.com/theBowja/genshin-db)（MIT）与 [EnkaNetwork/API-docs](https://github.com/EnkaNetwork/API-docs) 生成，游戏名称与内容版权归米哈游所有。
