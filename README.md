# dsh-genshin-account

DeepSeek Harness 插件：把**你的原神账号**读进来 —— 角色练度、命座、天赋、面板、武器、圣遗物 —— 然后在**对话里直接问**（agent 调用工具查），也能在 **GUI 里看**（侧边栏「原神账号」页面）。

A DeepSeek Harness plugin that reads your Genshin Impact account (characters, talents, weapons, artifacts) into one canonical snapshot and exposes it both as **agent tools** and as a **GUI page**.

---

## 数据从哪来

国服没有"填个 UID 就能查"的公开接口：`api-takumi-record.mihoyo.com` 上的每个读取接口都要求登录态，并且在返回数据前要求一次人机验证。插件把这两步都做完了，只有一条数据链路：

| 步骤 | 接口 / 机制 |
| --- | --- |
| 1. 扫码登录 | `passport-api.miyoushe.com/account/ma-cn-passport/web/createQRLogin` → `queryQRLoginStatus`，确认后从 `Set-Cookie` 得到 `ltoken_v2` / `ltmid_v2` —— 会话归插件自己所有 |
| 2. 申请验证任务 | `GET /game_record/app/card/wapi/createVerification?is_high=true` → geetest 的 `gt` + `challenge` |
| 3. 拖滑块 | 页面内加载 geetest v3 控件，产出 `geetest_challenge` + `geetest_validate`；`x-rpc-challenge_path` 决定这次验证解锁哪个接口（`/index` 与 `/character/list` 分别验证） |
| 4. 兑换通行证 | `POST /game_record/app/card/wapi/verifyVerification` → `x-rpc-challenge` |
| 5. 读取数据 | `GET /game_record/app/genshin/api/index`、`POST /character/detail`，带上 `x-rpc-challenge` |

能读到：账号概览（昵称/等级/区服/成就/活跃天数）、全部角色（等级、命座、三段天赋、武器、五件圣遗物含每条副词条与强化值）。

> 这套流程与 Snap.Hutao 的 `CardClient` + `GeetestService` 一致（它的 `RetryIf1034Async` 就是"遇 1034 → 验证 → 带 `x-rpc-challenge` 重发"）。人机验证是官方要求，插件只把这一步搬到自己界面上，不绕过任何风控。

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

点侧边栏「原神账号」图标，第一次打开会直接落在 **设置** 页签。三步：

1. **填国服 UID** —— 服务器按 UID 自动判断（1/2 → 天空岛 `cn_gf01`，5 → 世界树 `cn_qd01`）。
2. **扫码登录** —— 点「生成二维码」，用**手机米游社 App** 扫码并在手机上确认。确认后插件从 `Set-Cookie` 拿到会话，不需要你复制任何 Cookie。
3. **安全验证** —— 点「开始验证」，在弹出的 geetest 滑块上拖一次。通过后插件自动换取 `x-rpc-challenge` 并立刻读取账号，成功即跳到概览。

   > 验证是**按接口**发放的：`/index`（账号概览）与 `/character/list`（角色详情）各要一次。所以可能连续弹两次滑块——第一次通过后如果角色详情仍被拦，页面会自动再弹第二次，不需要重新配置。

页面上还有 **接口诊断**：用当前会话依次打 `/index`、`/character/list`、`/character/detail`，逐个报告返回码——排查时比猜有用。

「高级设置」里可以改签名盐与 `app_version`（官方改版导致 `-10001` 时才需要）和缓存秒数。所有字段都是 `volatile`，保存后对下一次同步立即生效，无需重启。

配置文件仍落在 profile 的 `cordis.patch.yml`（`dsh-genshin-account` 行下的 `config:`），也可以直接改那里。会话 Cookie 只会存在本机，`/state` 接口从不回显它（只回 `hasCookie: true/false`）。

---

## GUI 用法

点侧边栏「原神账号」图标，五个页签：

- **概览** —— 昵称/冒险等级、角色/武器/圣遗物数量、元素分布、最佳圣遗物、数据来源与同步时间
- **角色** —— 左侧可搜索角色列表，右侧看等级、命座、三段天赋、面板、武器、五件圣遗物（主词条/副词条/CV/效率/评价）与**生效中的套装效果原文**
- **武器** —— 类型/稀有度/等级/精炼/装备角色
- **圣遗物** —— 按暴击值排序，含主副词条、评价、所属角色
- **设置** —— 上面的三步配置与接口诊断

右上角「同步」强制重新读取。会话或 `x-rpc-challenge` 过期时会重新要求扫码/验证，页面会直接说明。

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
| `genshin_character` | 单个角色完整练度（支持 中文名 / 英文名 / 别名 / 数字 id） |
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

`data/` 里是精简过的中文字典（离线可用，不依赖运行时网络）：

| 文件 | 内容 |
| --- | --- |
| `characters.json` | 124 个角色：中文名/英文名/元素/武器类型/稀有度/别名 |
| `weapons.json` | 255 把武器：中文名/类型/稀有度 |
| `artifact-sets.json` | 63 套圣遗物：中文名 + 2 件套 / 4 件套效果原文 |
| `aliases.json` | `"HuTao"` → `10000046` 这类 key 索引（大小写与标点无关） |
| `names-zh.json` | 接口返回的 hash/id → 中文名（含词条名） |
| `skill-orders.json` | 每个角色的「普攻/战技/爆发」技能 id 顺序 |

**为什么需要 `skill-orders.json`**：技能 id **不是**按 普攻→战技→爆发 递增的（神里绫华的普攻 id 比爆发 id 大），按 id 排序会把天赋等级张冠李戴。

重新生成（需要网络，仅开发时）：

```sh
node scripts/build-dict.mjs <genshin-db 路径>
node scripts/build-names.mjs
node scripts/build-skill-orders.mjs
```

游戏更新后角色/武器/圣遗物名字缺失时，重跑上面三条即可；插件本身不需要改代码。

---

## 工作原理

| 端 | 职责 |
| --- | --- |
| Host (`lib/index.js`) | 定义 Config；调度 `lib/sources/miyoushe.js`；把结果统一成一份 snapshot 后**内存 + 磁盘双缓存**（`$DSH_HOME/data/dsh-genshin-account/snapshot-miyoushe.json`），刷新失败时继续用上一份好数据；注册 5 个工具；用 `webServer` 挂同源 JSON 路由（`/state` `/summary` `/character` `/artifacts` `/weapons` `/sync` `/login/qr` `/login/poll` `/verify/start` `/verify/finish` `/probe-miyoushe` `/diag`） |
| `lib/sources/miyoushe.js` | DS2 签名、设备指纹（`x-rpc-device_fp`）、`x-rpc-challenge` 的持有与附加、`/index` + `/character/detail` 的抓取与解析 |
| `lib/sources/miyoushe-login.js` | 扫码登录：`createQRLogin` / `queryQRLoginStatus`，从 `Set-Cookie` 抽出会话 |
| `lib/model.js` | 解析名字/元素/部位、按 `location` 把武器与圣遗物挂回角色、排序与筛选、组装套装效果 |
| `lib/score.js` | CV / 效率 / 评价 |
| Client (`client/client.js`) | `window.__ModuleLoader__.load({ id, factory })` 包；`ctx.slots.inject` + 两次 `ctx.slots.register`（`main` 用 key `genshin`，`sidebar.panellist` 用同 id）——侧边栏按钮由 sidebar 自己渲染，插件只提供图标；样式全部走 `--dsw-*` 主题变量，自动跟随明暗主题 |

---

## 已知限制

- **需要登录态**：不带 Cookie 一律 `retcode 10001`，不存在按 UID 的匿名查询。
- **需要一次人机验证**：未通过时所有读取接口返回 `retcode 1034`；通过后 `x-rpc-challenge` 会持有到过期，届时再拖一次滑块即可。
- **只覆盖「角色详情已公开」的角色**：没公开的角色只有基础信息，读不到圣遗物词条。
- **接口是逆向接口**：签名盐与 `app_version` 会随官方改版失效（`-10001`），此时在高级设置里更新；频繁查询会被限流（`-110`/`1028`/`10101`）。
- CV / 效率是**通用质量指标**，不等于角色收益，更不是伤害计算。
- 4★ 圣遗物的强化位数按 7 位估算，与游戏内实际可能差一位。

---

## 验证状态

`npm test` 覆盖（全部通过）：

- `test/smoke-miyoushe.mjs` —— DS2 签名格式（三段、`t` 为秒、`r` 范围、md5）、`base` 嵌套、`skill_type`→天赋、`property_map`→词条、百分比/固定值区分、套装名解析
- `test/smoke-login.mjs` —— 扫码登录：`Set-Cookie` 解析（只留会话 cookie）、`createQr`（成功/被拒）、`pollQr` 全状态（Created / Scanned / Confirmed 带 Cookie / 无 Cookie 报错 / -3501 过期 / -3505 取消 / -3503 风控）
- `test/smoke-verify.mjs` —— 验证链路：`createVerification` 的参数与请求头、空任务报错、`verifyVerification` 换取并持有 `x-rpc-challenge`、该 token 会附到后续 record 请求、清空后不再附带
- `test/smoke-host.mjs` —— 5 个工具 + 12 条路由、`/state` 契约（含 Cookie 不回显）、缓存与 1034 降级、跨源 POST 拒绝、`/verify/*` 端到端（桩化 transport）
- `test/smoke-client.mjs` —— 按 web boot 协议加载浏览器 bundle：`main` + `sidebar.panellist` 注册、图标渲染、页面渲染不抛错、`configForms.get` 用 `include:<包名>`、页面读取的字段都存在 Host 返回的 JSON 里
- `test/render-check.mjs` / `test/mount-check.mjs` —— SSR 与 jsdom 挂载两条路径都能出界面

**未覆盖**：真实账号的滑块验证需要人手动拖一次，自动化测试里以桩化 transport 代替；`x-rpc-challenge` 的有效期以实际为准。

## 许可

MIT。随包游戏数据由 [genshin-db](https://github.com/theBowja/genshin-db)（MIT）与 [EnkaNetwork/API-docs](https://github.com/EnkaNetwork/API-docs) 生成，游戏名称与内容版权归米哈游所有。
