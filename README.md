# dsh-genshin-account

DeepSeek Harness 插件：把**你的原神账号**读进来 —— 角色练度、命座、天赋、面板、武器、圣遗物 —— 然后在**对话里直接问**（agent 调用工具查），也能在 **GUI 里看**（侧边栏「原神账号」页面）。

A DeepSeek Harness plugin that reads your Genshin Impact account (characters, talents, weapons, artifacts) into one canonical snapshot and exposes it both as **agent tools** and as a **GUI page**.

---

## 数据从哪来

插件有四路数据，自动选用，**不需要你做选择**：

| 数据 | 来源 | 要不要验证 |
| --- | --- | --- |
| 全部角色、等级、命座、三段天赋、武器名与等级、圣遗物部位与等级 | 养成计算器 `api-takumi.mihoyo.com/.../sync/avatar/detail` | **不需要** |
| 成就达成、深境螺旋、幻想真境剧诗、幽境危战、好感角色 | 展柜 payload 的 `playerInfo`（名片只在不匹配时被忽略） | **不需要** |
| 剧诗/危战的期次与难度明细 | `role_combat`（剧诗）/ `hard_challenge`（危战） | **不需要** |
| 圣遗物**主副词条**（进而算出 CV / 词条效率） | 游戏内「角色展柜」→ `profile.microgg.cn/api/uid/<uid>` | **不需要**（只要展柜里放了角色并开了「显示详情」） |
| 祈愿（抽卡）记录 | `public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog` | 不需要滑块，但 authkey 约 24 小时过期，需游戏内打开一次祈愿历史 |

前三条默认就会跑；第四条会自动补上展柜里那些角色的副词条；祈愿是独立的一路。

角色与武器要**登录态**（扫码即可，插件自己完成登录）；**展柜不需要登录**——它按 UID 公开可见，这也是圣遗物副词条唯一能拿到的通路。

圣遗物副词条的链路现在是这样的：

| 步骤 | 做什么 |
| --- | --- |
| 1. 游戏内设置 | 资料 → 角色展柜，放上想看的角色（最多 8 个），点开「显示详情」 |
| 2. 等 5 分钟 | 服务器把展柜数据写好 |
| 3. 插件读取 | `GET http://profile.microgg.cn/api/uid/<uid>`（国服镜像，国际服回落到 `enka.network`），返回的就是 Enka 结构：`equipList[].flat.reliquaryMainstat` / `reliquarySubstats` |
| 4. 合并 | 计算器给的全账号 + 展柜给的 5 件圣遗物，按角色 id 合并成一份快照，CV 与词条效率随之算出 |

> 为什么不用米游社战绩接口：它对本插件的每一个请求都返回 `retcode 1034`，要求一次 geetest 滑块；滑块在本机拖出来的结果被服务端判为 `10306`（验证无效）。实测记录见文末。展柜是官方公开数据，按 UID 可读，不需要任何验证。

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

## 生成角色海报

角色页右上角「生成图片」会画一张 1000px 宽的长图（随内容高度，约 1100–1400px），内容：

- 立绘位置的头像 + 元素色描边、昵称、等级、命座 / 元素 / 武器类型 / 星级胶囊、UID
- 三段天赋等级 + 圣遗物整体评级（S/A/B/C）与 CV 合计 / 平均效率 / 平均 CV
- 武器卡（图标、名称、等级、精炼、星级）与套装件数
- 五件圣遗物卡：套装、部位与强化等级、主词条、逐条副词条（双暴金色）、CV 与评级
- 生效套装效果原文、数据来源与生成时间

全部在本机 canvas 上绘制，不上传任何数据；缺图时会退回自绘的部位图标。

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
| `weapon-details.json` | 255 把武器的 90 级基础攻击力、副属性、被动（精炼 1–5 原文）与故事 |

**为什么需要 `skill-orders.json`**：技能 id **不是**按 普攻→战技→爆发 递增的（神里绫华的普攻 id 比爆发 id 大），按 id 排序会把天赋等级张冠李戴。

界面预览（需要 `react` + `react-dom` 与 Edge，仅开发时）：

```sh
REACT_DIR=%TEMP%\ga-react node scripts/ui-preview.mjs        # 用运行中宿主的数据
PREVIEW_LOCAL=1 REACT_DIR=%TEMP%\ga-react node scripts/ui-preview.mjs   # 用仓库代码现算快照
```

它会把四个 Tab 分别渲染成 PNG 并打印目录。面板要等 effect 填数据才有内容，
所以不能只靠静态渲染检查——这是唯一能看到真实排版的途径。

重新生成（需要网络，仅开发时）：

```sh
node scripts/build-dict.mjs <genshin-db 路径>
node scripts/build-names.mjs
node scripts/build-skill-orders.mjs
node scripts/build-weapon-details.mjs   # 需要 genshin-db：npm i --prefix %TEMP%\gsdb genshin-db，并设 GENSHIN_DB_DIR
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


## 圣遗物副词条：为什么走展柜，以及米游社那条路为什么不通

**能用的是展柜。** 国服玩家把角色放进游戏内「角色展柜」并开启「显示详情」后，这份数据就按 UID 公开可读，
插件读 `profile.microgg.cn/api/uid/<uid>`（国际服回落到 `enka.network`）即可拿到主副词条，
不需要登录、不需要任何验证。代价是**只覆盖展柜里的角色（最多 8 个）**。

**不通的是米游社战绩接口。** 它对本插件返回 `retcode 1034`（要求人机验证），而滑块的结果被服务端判为 `10306`。
这一层我们逐项排除过：

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 滑块能否渲染 | ✅ | `bind` 产品 + `appendTo`，页面里 26 个节点 |
| 拖动能否完成 | ✅ | `onSuccess` 触发，validate 32 位、带 seccode |
| challenge 是否配对 | ✅ | `sameChallenge = true` |
| 字段组合 ×4 | ❌ | challenge 来源 × 是否带 seccode，四种都 `10306` |
| `is_high` 开关 | ❌ | true / false 都 `10306` |
| 页面来源 http vs https（自签证书） | ❌ | 两种都 `10306` |
| 请求头 / Cookie 是否符合 UIGF 规范 | ✅ | 对照[鉴权文档](https://uigf.org/zh/mihoyo-api-collection/other/authentication.html) |
| 客户端类型 × 盐：5+X4 / 4+X4 / 6+X6 / 2+K2 | ❌ | 四种都 `1034`，风控与客户端类型、盐无关 |
| 提交验证时不带 Cookie | ❌ | `-1`（参数错误），说明 Cookie 必需 |
| 验证结果放请求头 | ❌ | `10306` |
| `@genshin-kit/core` | ❌ | 同一接口同一封装，`1034` |
| 对齐 Yunzai-Bot 极简请求头 | ❌ | 它的 `/character` 已 `-1` 下线，`/index` 仍 `1034`；仓库停在 2023-07 |
| **真实 Edge + 已登录 + 官方域名内发请求** | ❌ | 带全部 `.miyoushe.com` cookie 后 `api-takumi.miyoushe.com` 仍 `1034` |
| 网页版战绩入口 | ❌ | 注入 cookie 后 `#app` 为空，入口已停用 |

结论：`1034` 是服务端闸门，与客户端指纹无关；`10306` 说明本机的滑块结果不被接受。
所以插件**不再引导用户拖滑块**，改为提示去游戏里设置展柜——那条路一次设置、长期可用。

## 已知限制
- **角色与武器需要登录态**：不带 Cookie 一律 `retcode 10001`；展柜是例外，按 UID 公开可读。
- **圣遗物只覆盖展柜角色**：只有放进「角色展柜」并开启「显示详情」的角色才有主副词条，其余角色只有部位、散件名和等级。
- **展柜有 5 分钟延迟**：游戏内改动后要等服务器写好，再同步才看得到。
- **接口是逆向接口**：签名盐与 `app_version` 会随官方改版失效（`-10001`），此时在高级设置里更新；频繁查询会被限流（`-110`/`1028`/`10101`）。
- CV / 效率是**通用质量指标**，不等于角色收益，更不是伤害计算。
- 4★ 圣遗物的强化位数按 7 位估算，与游戏内实际可能差一位。

---

## 验证状态

`npm test` 覆盖 10 个测试文件，全部通过：

- `smoke-miyoushe` —— DS2 签名、`base` 嵌套、`skill_type`→天赋、`property_map`→词条
- `smoke-login` —— 扫码：`Set-Cookie` 解析、`createQr` 成功/被拒、`pollQr` 全状态（含 -3501/-3505/-3503）
- `smoke-verify` —— 验证链路：申请任务、换取并持有 `x-rpc-challenge`、按接口分别持有、清空后不再附带
- `smoke-gacha` —— 抽卡分析：池子计数、平均出金、欧非比、保底重置、出货区间、月度统计、空数据边界
- `smoke-qr` —— 二维码：与参考实现逐格一致的基准矩阵、版本选择边界、SVG 形状
- `smoke-microgg` —— 展柜：`setId`→套装名、`equipType`→部位、主副词条数值、CV 按暴击率×2 计、合并后角色/计数/标注正确、空展柜是正常状态
- `smoke-host` —— 6 个工具 + 15 条路由、`/state` 契约（Cookie 不回显）、缓存与 1034 降级、`/verify/*` 与 `/gacha` 契约
- `smoke-client` —— web boot 协议加载 bundle、槽位注册、登录面板渲染、`configForms` 用 `include:<包名>`
- `render-check` / `mount-check` —— SSR 与 jsdom 挂载两条路径都能出界面

**未覆盖**：真实账号的滑块验证需要人手动拖一次；祈愿同步需要游戏内打开一次历史记录（authkey 约 24 小时过期）。

---


## 许可

MIT。随包游戏数据由 [genshin-db](https://github.com/theBowja/genshin-db)（MIT）与 [EnkaNetwork/API-docs](https://github.com/EnkaNetwork/API-docs) 生成，游戏名称与内容版权归米哈游所有。
