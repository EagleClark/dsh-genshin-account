# dsh-genshin-account

DeepSeek Harness 插件：把**你的原神账号**读进来 —— 角色练度、命座、天赋、面板、武器、圣遗物 —— 然后在**对话里直接问**（agent 调用工具查），也能在 **GUI 里看**（侧边栏「原神账号」页面）。

A DeepSeek Harness plugin that reads your Genshin Impact account (characters, talents, weapons, artifacts) into one canonical snapshot and exposes it both as **agent tools** and as a **GUI page**.

---

## 数据从哪来

插件有四路数据，自动选用，**不需要你做选择**：

| 数据 | 来源 | 要不要验证 |
| --- | --- | --- |
| 全部角色、等级、命座、三段天赋、武器名与等级、圣遗物部位与等级 | 养成计算器 `api-takumi.mihoyo.com/.../sync/avatar/detail` | **不需要** |
| 活跃天数、成就达成、深境螺旋、幻想剧诗 | 名片 `card/wapi/getGameRecordCard` | **不需要** |
| 幻想真境剧诗 / 幽境危战本期进度 | `hard_challenge` / `role_combat` | **不需要** |
| 圣遗物**副词条**（进而算出 CV / 词条效率） | 战绩接口 `/game_record/app/genshin/api/*` | 需要一次 geetest 滑块 |
| 祈愿（抽卡）记录 | `public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog` | 不需要滑块，但 authkey 约 24 小时过期，需游戏内打开一次祈愿历史 |

前三条默认就会跑；第四条只有当你完成过一次验证才启用；祈愿是独立的一路。

所有通道都要**登录态**：国服没有"填个 UID 就能查"的公开接口。登录由插件自己完成，扫码即可。

战绩接口那条链路完整长这样（只有在算圣遗物评分时才会走）：

| 步骤 | 接口 / 机制 |
| --- | --- |
| 1. 扫码登录 | `passport-api.miyoushe.com/account/ma-cn-passport/web/createQRLogin` → `queryQRLoginStatus`，确认后从 `Set-Cookie` 得到 `ltoken_v2` / `ltmid_v2` —— 会话归插件自己所有 |
| 2. 申请验证任务 | `GET /game_record/app/card/wapi/createVerification?is_high=true` → geetest 的 `gt` + `challenge` |
| 3. 拖滑块 | 验证页加载 geetest v3 控件，产出 `geetest_challenge` + `geetest_validate`；`x-rpc-challenge_path` 决定这次验证解锁哪个接口（`/index` 与 `/character/list` 分别验证） |
| 4. 兑换通行证 | `POST /game_record/app/card/wapi/verifyVerification` → `x-rpc-challenge` |
| 5. 读取数据 | `GET /game_record/app/genshin/api/index`、`POST /character/detail`，带上 `x-rpc-challenge` |

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

侧边栏「原神账号」共五页：

- **概览** —— 账号主卡（昵称 / UID / 冒险等级 / 区服）、角色·武器·圣遗物·五星数字块、练度最高的角色（点头像直接进角色页）、元素分布、角色构成（等级段）、活跃天数 / 成就 / 幻想真境剧诗 / 幽境危战、最佳圣遗物
- **角色** —— 左侧列表带官方头像与元素色描边，可按元素筛选、按等级/稀有度/命座/名字排序；右侧大图、命座、三段天赋、武器（图标/等级/精炼）、圣遗物；右上角 **生成图片** 导出 760×460 PNG
- **抽卡** —— 总抽数 / 五星 / 四星 / 平均出金 / 欧非比、各池抽数与保底进度、五星出货区间、每月抽卡量、五星记录
- **武器** —— 卡片网格（官方图标 + 稀有度描边），按类型/星级筛选
- **圣遗物** —— 有副词条时按 CV 评分排序；没有时说明差这一步并给验证入口

所有图标都来自官方 CDN（`act-webstatic.mihoyo.com`），明暗主题自适应。

---


## Agent 工具

装好后 agent 自动获得 6 个工具，可以直接问：

> 「我胡桃的圣遗物怎么样，哪件该换？」
> 「我这个号有多少五星武器？」
> 「列出所有火系角色」
> 「我最近抽卡怎么样，离保底还有多少？」

| 工具 | 作用 |
| --- | --- |
| `genshin_account_overview` | 账号总览（数量、元素分布、活跃天数、成就、剧诗/危战、最佳圣遗物） |
| `genshin_characters` | 角色列表，按元素/武器类型/最低等级过滤与排序 |
| `genshin_character` | 单个角色的完整练度（中文名 / 英文名 / 别名 / 数字 id） |
| `genshin_artifacts` | 圣遗物筛选与排序（套装、部位、角色、最低 CV） |
| `genshin_weapons` | 武器筛选（类型、最低稀有度、是否已装备） |
| `genshin_gacha` | 祈愿分析：抽数、平均出金、欧非比、各池保底、五星记录；可按池过滤 |

工具返回结构化 JSON，同时渲染成给人看的文本；数据不可用时返回**可读的错误**而不是抛异常。

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

| 模块 | 职责 |
| --- | --- |
| `lib/index.js` | Config、5 个数据工具 + 抽卡工具、同源 JSON 路由、快照内存 + 磁盘双缓存 |
| `lib/sources/miyoushe-calc.js` | 养成计算器通道：枚举角色、解析装备与天赋、附加账号级数据 |
| `lib/sources/miyoushe-extras.js` | 名片 / 幻想真境剧诗 / 幽境危战（均不受验证码管控） |
| `lib/sources/miyoushe.js` | DS2 签名、设备指纹、`x-rpc-challenge` 持有与附加、战绩接口解析 |
| `lib/sources/miyoushe-login.js` | 扫码登录：`createQRLogin` / `queryQRLoginStatus`，从 `Set-Cookie` 取会话 |
| `lib/sources/miyoushe-gacha.js` | 祈愿：从游戏缓存找 authkey、增量同步、分析 |
| `lib/qr.js` | 自带的二维码编码器（无第三方依赖，逐格对齐参考实现） |
| `lib/model.js` / `lib/score.js` | 统一快照、查询、CV 与词条效率 |
| `client/client.js` | `window.__ModuleLoader__.load` 包；`main` + `sidebar.panellist` 两个槽位；样式走 `--dsw-*` 主题变量 |

路由：`/state` `/summary` `/character` `/artifacts` `/weapons` `/sync` `/login/qr` `/login/poll` `/verify/widget` `/verify/start` `/verify/finish` `/gacha` `/gacha/sync` `/probe-miyoushe` `/diag`，除 `/verify/widget`（验证页）与 GET 查询外都是同源 POST。

**没有运行时 npm 依赖**（除 host 提供的 schemastery）：二维码由 `lib/qr.js` 生成，安装不需要拉取任何第三方包。

---


## 圣遗物副词条为什么拿不到（完整实测记录）

圣遗物**副词条**（CV / 词条效率的输入）只在米游社一个需要人机验证的接口里。这条链路我们逐项验证过，结论是**在本机环境里无法通过**。

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 滑块能否渲染 | ✅ | `bind` 产品 + `appendTo`，页面里 26 个节点 |
| 拖动能否完成 | ✅ | `onSuccess` 触发，validate 32 位、带 seccode |
| challenge 是否配对 | ✅ | `sameChallenge = true`（geetest 返回的与申请到的完全一致） |
| 字段组合 ×4 | ❌ | challenge 来源 × 是否带 seccode，四种都 `retcode 10306` |
| `is_high` 开关 | ❌ | true / false 都 `10306` |
| 页面来源 http vs **https**（自签证书） | ❌ | 两种都 `10306` |
| 请求头 / Cookie 是否符合 UIGF 规范 | ✅ | 对照 [鉴权文档](https://uigf.org/zh/mihoyo-api-collection/other/authentication.html) |
| 养成计算器是否有副词条 | ❌ | 原始对象只有 `id/name/icon/reliquary_cat_id/reliquary_level/level_current/max_level` |
| 官方圣遗物字典 `reliquary/list` 是否有套装字段 | ❌ | 614 条，每条只有散件名，没有套装名/套装 id |
| 第三方库 `@genshin-kit/core`（用户建议） | ❌ | 实跑 `getAllCharacters` 得到 `{ code: 1034 }`：它只是包了一层同样的接口、同样 `client_type=5`，没有任何验证处理 |
| 客户端类型 × 盐：`client_type` 5+ X4 / 4+X4 / 6+X6 / 2+K2 | ❌ | 四种都 `1034`：风控与客户端类型、盐无关 |
| 提交验证时不带 Cookie（照抄参考实现） | ❌ | `retcode -1`（参数错误）——说明 Cookie 是必需的 |
| 把验证结果放请求头（`x-rpc-challenge` / `x-rpc-validate` / `x-rpc-seccode`） | ❌ | `10306` |

`10306` 不在 UIGF 的[公共错误码](https://uigf.org/zh/mihoyo-api-collection/other/error_code.html)表里（那里只列了 -10001 / 10001 / 1034 等）。
能读到国服副词条的工具（如胡桃工具箱）是在 WebView2 里跑验证，并要求与 App 一致的设备/签名环境；本插件是本地 Node + 浏览器页面，无法复现。

因此插件**不提供**这条入口：界面如实说明，不再引导用户反复拖滑块。
角色、等级、命座、天赋、武器、圣遗物部位与散件名、账号总览、抽卡都不受影响。

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

`npm test` 覆盖 9 个测试文件，全部通过：

- `smoke-miyoushe` —— DS2 签名、`base` 嵌套、`skill_type`→天赋、`property_map`→词条
- `smoke-login` —— 扫码：`Set-Cookie` 解析、`createQr` 成功/被拒、`pollQr` 全状态（含 -3501/-3505/-3503）
- `smoke-verify` —— 验证链路：申请任务、换取并持有 `x-rpc-challenge`、按接口分别持有、清空后不再附带
- `smoke-gacha` —— 抽卡分析：池子计数、平均出金、欧非比、保底重置、出货区间、月度统计、空数据边界
- `smoke-qr` —— 二维码：与参考实现逐格一致的基准矩阵、版本选择边界、SVG 形状
- `smoke-host` —— 6 个工具 + 15 条路由、`/state` 契约（Cookie 不回显）、缓存与 1034 降级、`/verify/*` 与 `/gacha` 契约
- `smoke-client` —— web boot 协议加载 bundle、槽位注册、登录面板渲染、`configForms` 用 `include:<包名>`
- `render-check` / `mount-check` —— SSR 与 jsdom 挂载两条路径都能出界面

**未覆盖**：真实账号的滑块验证需要人手动拖一次；祈愿同步需要游戏内打开一次历史记录（authkey 约 24 小时过期）。

---


## 许可

MIT。随包游戏数据由 [genshin-db](https://github.com/theBowja/genshin-db)（MIT）与 [EnkaNetwork/API-docs](https://github.com/EnkaNetwork/API-docs) 生成，游戏名称与内容版权归米哈游所有。
