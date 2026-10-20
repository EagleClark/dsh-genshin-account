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

## 配置（在页面里做，不用改文件）

点侧边栏「原神账号」图标，第一次打开会直接落在 **设置** 页签，里面就是配置向导：

1. **选择数据源** —— 三张卡片，各自写明「能读到什么 / 限制 / 支持哪些服务器」，点一下就选中。
2. **填当前数据源的配置** —— 卡片下方只显示所选数据源需要的字段。
3. **照着「怎么拿到这些数据」的步骤做** —— 每种数据源都有分步引导。
4. 点 **保存并同步** —— 保存配置并立刻读取账号；失败时页面直接显示原因。

| 数据源 | 页面里要做什么 |
| --- | --- |
| 本地 GOOD 文件 | 点 **选择 GOOD 文件** → 选中导出好的 JSON（自动复制到 DSH 数据目录并填好路径，**不用手填绝对路径**）→ 自动保存并同步 |
| Enka.Network | 填国际服 UID → 保存并同步；连不上时在「高级设置」里换接口地址 |
| 米游社（国服） | 填国服 UID（服务器按 UID 自动判断）+ 粘贴 Cookie → 保存并同步 |

**高级设置**（折叠）里还有：Enka 接口地址、米游社签名盐与 `app_version`、缓存秒数。

所有字段都是 `volatile`，保存后立即对下一次同步生效，无需重启。配置文件仍然落在 profile 的 `cordis.patch.yml`（`dsh-genshin-account` 行下的 `config:`），也可以直接改那里。

### 怎么拿 GOOD 文件

GOOD 是社区通用的账号数据格式，由第三方扫描工具从游戏界面 OCR 导出。**三个工具导出的内容不一样**，按需要的字段选：

| 工具 | 导出内容 | 下载地址 | 说明 |
| --- | --- | --- | --- |
| **Inventory Kamera**（推荐） | 角色 + 武器 + 圣遗物 + 材料 | <https://github.com/Andrewthe13th/Inventory_Kamera/releases/latest> | 只有它能一次拿到**角色和武器**，本插件吃全套数据用它。Windows 工具，需装 VC++ 运行库 |
| **Amenoma**（天目） | **只有圣遗物** + 材料 | <https://github.com/daydreaming666/Amenoma/releases> | 轻量、中文界面；导出文件名类似 `artifacts.GOOD.json`。中文界面**别下** `Amenoma_EN.exe` |
| **Genshin Optimizer** | 不导出，是分析工具 | <https://frzyc.github.io/genshin-optimizer/> | 网页版，可直接导入上面任一工具产出的 GOOD；也能按 UID 从 Enka 拉数据（仅国际服） |

**Inventory Kamera 使用要点**（官方 README 明确要求，踩了会扫歪）：

1. 游戏分辨率必须是 **16:9 或 16:10**（1920×1080 / 2560×1440 等），否则改成匹配的窗口化分辨率
2. **关闭 HDR**（Windows 设置里的 HDR 会导致识别失败）
3. 键位用默认：背包 `B`、角色 `C`、选角色 `1`；改过就在工具里配对应键
4. 运行工具 → 勾选 **weapons / artifacts / characters** → 开始扫描 → 导出 `.GOOD.json`

拿到文件后，回设置页点 **选择 GOOD 文件** 选中它即可（自动复制到 DSH 数据目录并填入路径）。

> 再次强调：EXE 从 **Releases** 页下载，不要点 GitHub 仓库右上角的 `Code → Download ZIP`（那是源码）。

### 怎么拿米游社 Cookie

浏览器登录 `bbs.mihoyo.com` → 开发者工具 → Application/存储 → Cookies，复制 **`ltuid_v2`、`ltoken_v2`、`ltmid_v2`** 三项，拼成：

```
ltuid_v2=…; ltoken_v2=…; ltmid_v2=…
```

粘进页面里的 Cookie 框。**注意**：Cookie 等同于登录凭据，会以明文存在本机 profile 的 `cordis.patch.yml` 里，且 `/state` 接口永远不会把它回显给页面；只想读数据的话，优先用 `good`。

---

## GUI 用法

点侧边栏「原神账号」图标，五个页签：

- **概览** —— 昵称/冒险等级、角色/武器/圣遗物数量、元素分布、最佳圣遗物、数据来源与同步时间
- **角色** —— 左侧可搜索角色列表，右侧看等级、命座、三段天赋、面板、武器、五件圣遗物（主词条/副词条/CV/效率/评价）与**生效中的套装效果原文**
- **武器** —— 类型/稀有度/等级/精炼/装备角色
- **圣遗物** —— 按暴击值排序，含主副词条、评价、所属角色
- **设置** —— 就是上面的配置向导；想换数据源随时回来

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
- `test/smoke-host.mjs` —— 插件入口注册 5 个工具 + 7 条路由、渲染文本、软错误降级、跨源 POST 拒绝、缓存、`/upload-good` 的接受与拒绝路径、`/state` 契约、Cookie 不回显
- `test/smoke-client.mjs` —— 按 web boot 协议加载浏览器 bundle：注册 `main` + `sidebar.panellist` 且 key 一致、图标渲染 svg、页面渲染不抛错，断言 `configForms.get` 用的是 `include:<包名>` 这个真实 entry id，并**逐个校验页面读取的字段都存在于 Host 返回的 JSON 里**
- `test/render-check.mjs` —— 用**真 React**（server renderer）渲染注册的页面与图标，抓「渲染期抛错 / hook 顺序」这类会把整个外壳打白屏的问题。需要 `react`/`react-dom` 可解析，缺失时自动跳过：
  ```sh
  npm i --prefix /tmp/ga-react react@18 react-dom@18
  REACT_DIR=/tmp/ga-react npm run test:render
  ```

**未能在本机验证**（如实说明）：

- **Enka 真实联网**：本机访问 `enka.network` 超时，解析逻辑用合成响应验证。
- **米游社真实联网**：没有你的 Cookie，签名与响应结构依据公开实现（`genshin.py`）与文档，用合成响应验证。
- **真实浏览器里的外观**：真 React 渲染能证明不会崩，但明暗主题下的实际排版、滚动、点击仍需真的打开页面看。

---

## 许可

MIT。随包游戏数据由 [genshin-db](https://github.com/theBowja/genshin-db)（MIT）与 [EnkaNetwork/API-docs](https://github.com/EnkaNetwork/API-docs) 生成，游戏名称与内容版权归米哈游所有。
