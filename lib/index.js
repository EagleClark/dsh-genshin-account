/**
 * dsh-genshin-account — host entry.
 *
 * Reads one Genshin Impact account into a single canonical snapshot, then
 * exposes it twice:
 *  - five agent tools (`genshin_*`) so the model can answer questions about a
 *    build in conversation,
 *  - a set of same-origin JSON routes the browser half renders as a page.
 *
 * Three interchangeable sources, chosen by `config.source`:
 *  - `miyoushe` the CN record API behind a QR-login session (+ one geetest)
 *  - `miyoushe` miHoYo record API with the user's own cookie → showcase, 国服
 *
 * Snapshot caching is deliberate: every source is a network or file read that
 * can fail, so a good snapshot is kept in memory and on disk and served even
 * after a later refresh fails.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import * as miyousheSource from './sources/miyoushe.js'
import { readFileSync } from 'node:fs'
import * as miyousheCalc from './sources/miyoushe-calc.js'
import * as miyousheGacha from './sources/miyoushe-gacha.js'
import * as miyousheLogin from './sources/miyoushe-login.js'
import * as microggSource from './sources/microgg.js'
import { renderVerifyPage } from './verify-page.js'
import {
  activeSetEffects,
  carryForwardShowcase,
  rescoreSnapshot,
  characterView,
  getCharacter,
  listArtifacts,
  listCharacters,
  listWeapons,
  overview,
  publicArtifact,
  setSummary,
} from './model.js'

export const name = 'dsh-genshin-account'

/** 插件版本，直接读 package.json，避免两处手改不同步。 */
const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || ''
  } catch {
    return ''
  }
})()

const ROUTE_PREFIX = '/dsh-genshin-account'

/**
 * 图表库 ApexCharts 的浏览器构建。
 *
 * 固定在 4.7.0：这是最后一个 MIT 许可的版本（5.x 起改成社区/商业双许可，
 * 嵌入到给别人用的产品里需要 OEM 授权）。由 host 直接把这个文件喂给页面，
 * 客户端不需要打包步骤。
 */
const APEX_FILE = (() => {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require.resolve('apexcharts/package.json')
    return join(dirname(pkg), 'dist', 'apexcharts.min.js')
  } catch {
    return ''
  }
})()

/** Cap on any JSON body this plugin accepts (login/verify payloads are tiny). */
const MAX_BODY_BYTES = 64 * 1024 * 1024

/** Collect a request body with a hard size ceiling (413 past it). */
async function readBodyText(req, limit) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limit) throw new Error(`上传内容超过 ${Math.round(limit / 1024 / 1024)}MB 上限`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const SOURCES = {
  miyoushe: miyousheSource,
}

/**
 * Every field is `volatile()`: a settings write is committed into the running
 * references instead of remounting the entry, so the next sync picks it up and
 * the browser page can render the same values through `ctx.configForms`.
 */
export const Config = z.object({
  miyousheUid: z
    .string()
    .description('国服 UID（1/2 开头天空岛，5 开头世界树）')
    .default('')
    .volatile(),
  miyousheServer: z
    .union([z.const('cn_gf01'), z.const('cn_qd01')])
    .description('国服服务器：cn_gf01 = 天空岛，cn_qd01 = 世界树')
    .default('cn_gf01')
    .volatile(),
  miyousheCookie: z
    .string()
    .description('扫码登录写入的会话 Cookie（ltuid_v2 / ltoken_v2 / ltmid_v2）。敏感凭据，只保存在本机 profile 配置里')
    .default('')
    .volatile(),
  gamePath: z
    .string()
    .description('原神安装目录（含 YuanShen_Data）。留空则自动在常见路径里找，用于读取祈愿记录链接')
    .default('')
    .volatile(),
  gachaUrl: z
    .string()
    .description('祈愿历史链接（可选）。一般不用填：插件会自己从游戏缓存里取')
    .default('')
    .volatile(),
  miyousheDsSalt: z
    .string()
    .description('米游社接口签名盐；官方改版后如果报签名错误，可在此更新')
    .default('')
    .volatile(),
  miyousheAppVersion: z
    .string()
    .description('米游社接口要求的 app_version；与签名盐配套')
    .default('')
    .volatile(),
  cacheSeconds: z
    .number()
    .description('快照缓存时间（秒）：这段时间内重复查询直接用缓存')
    .default(600)
    .volatile(),
})

/** Volatile refs arrive as live handles; read at use time. */
const readRef = (ref, fallback) => {
  try {
    const value = ref !== null && typeof ref === 'object' && typeof ref.get === 'function' ? ref.get() : ref
    return value === undefined || value === null ? fallback : value
  } catch {
    return fallback
  }
}
const readString = (ref, fallback) => {
  const value = readRef(ref, fallback)
  return typeof value === 'string' ? value : fallback
}
const readNumber = (ref, fallback) => {
  const value = readRef(ref, fallback)
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function apply(ctx, config) {
  const readConfig = () => ({
    source: 'miyoushe',
    miyousheUid: readString(config && config.miyousheUid, ''),
    miyousheServer: readString(config && config.miyousheServer, 'cn_gf01'),
    miyousheCookie: readString(config && config.miyousheCookie, ''),
    miyousheDsSalt: readString(config && config.miyousheDsSalt, ''),
    miyousheAppVersion: readString(config && config.miyousheAppVersion, ''),
    cacheSeconds: Math.max(0, readNumber(config && config.cacheSeconds, 600)),
  })

  const storageDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'data', 'dsh-genshin-account')

  /**
   * Read the account.
   *
   * Two paths, and the order matters:
   *  - the **record API** carries artifact sub-stats (and so CV/efficiency) but
   *    answers `retcode 1034` until a geetest is solved, so it is only worth
   *    calling once a challenge token is held;
   *  - the **calculator API** is ungated and returns the roster with levels,
   *    constellations, talents and weapons, but no sub-stats.
   *
   * So: use the record path when a token exists, otherwise go straight to the
   * calculator (calling the gated one first would just burn 600ms to learn what
   * we already know). Whatever ran is recorded in the snapshot's note.
   */
  async function readSource(cfg) {

    if (miyousheSource.getXrpcChallenge('index')) {
      try {
        return await miyousheSource.fetchSnapshot(cfg)
      } catch (error) {
        if (!(error && error.needsVerification)) throw error
        miyousheSource.clearXrpcChallenge()
      }
    }
    const fallback = await miyousheCalc.fetchSnapshot(cfg)
    fallback.note =
      (fallback.note || '') +
      ' · 完整账号来自养成计算器（不需要验证）；圣遗物副词条只看游戏内角色展柜'

    // The showcase is the one route to sub-stats that needs no verification:
    // a player puts up to eight characters in the in-game showcase and the
    // build becomes public by UID. Merging it upgrades those characters from
    // "piece names" to full main/sub stats, which is what scoring needs.
    try {
      const showcaseUid = fallback.uid || cfg.miyousheUid
      const showcase = await microggSource.fetchShowcase(showcaseUid, {
        // Keep the last good raw payload: the community mirror answers 424 or
        // times out now and then, and losing every artifact to one hiccup is
        // worse than showing yesterday's numbers.
        cacheFile: showcaseUid ? join(storageDir(), `showcase-${showcaseUid}.json`) : '',
      })
      if (showcase && showcase.builds && showcase.builds.length) {
        const merged = microggSource.mergeShowcase(fallback, showcase, {
          elapsedMs: Date.now() - (fallback.fetchedAt || Date.now()),
        })
        if (merged && merged !== fallback) return merged
      }
      if (showcase && showcase.note) fallback.note = `${fallback.note} · ${showcase.note}`
      const carried = carryForwardShowcase(state.snapshot, fallback)
      if (carried) return carried
    } catch (error) {
      // A showcase problem must never break the sync that already succeeded.
      fallback.note = `${fallback.note} · 展柜读取跳过：${(error && error.message) || error}`
    }
    return fallback
  }

  /** @type {{ snapshot: any, error: string, at: number }} */
  const state = { snapshot: null, error: '', at: 0 }
  let inflight = null

  const sourceOrDefault = () => 'miyoushe'

  async function readDiskSnapshot(source) {
    try {
      const text = await readFile(join(storageDir(), `snapshot-${source}.json`), 'utf8')
      const snapshot = JSON.parse(text)
      if (!snapshot || typeof snapshot !== 'object' || !snapshot.fetchedAt) return null
      // Scores live inside the stored artifacts; recompute them under the current
      // rules so a scoring change does not require a new network sync.
      return rescoreSnapshot(snapshot)
    } catch {
      return null
    }
  }

  async function writeDiskSnapshot(source, snapshot) {
    try {
      await mkdir(storageDir(), { recursive: true })
      await writeFile(join(storageDir(), `snapshot-${source}.json`), JSON.stringify(snapshot))
    } catch (error) {
      console.error('[dsh-genshin-account] could not persist snapshot:', error)
    }
  }

  /** Shape version of a stored snapshot; see SNAPSHOT_VERSION below. */
  const SNAPSHOT_VERSION = 2

  function isFresh(snapshot, cacheSeconds) {
    if (!snapshot || !snapshot.fetchedAt) return false
    if (snapshot.version !== SNAPSHOT_VERSION) return false
    return Date.now() - snapshot.fetchedAt < cacheSeconds * 1000
  }

  /**
   * The panel's auto-refresh threshold.
   *
   * Opening the panel must not kick off a 15-second sync every time: an account
   * snapshot (levels, talents, artifacts) simply does not change that fast. One
   * hour is the agreed window — inside it the cached snapshot is served and only
   * the header's 同步 button refreshes.
   */
  const AUTO_SYNC_MS = 60 * 60 * 1000

  function isFreshForAuto(snapshot) {
    if (!snapshot || !snapshot.fetchedAt) return false
    if (snapshot.version !== SNAPSHOT_VERSION) return false
    return Date.now() - snapshot.fetchedAt < AUTO_SYNC_MS
  }

  /**
   * Return a snapshot, refreshing from the source when needed.
   * A failed refresh never throws away a usable snapshot: the previous one is
   * returned together with the error, so the page keeps rendering.
   */
  async function ensureSnapshot({ force = false, auto = false } = {}) {
    const cfg = readConfig()
    const source = sourceOrDefault()
    const fresh = (snapshot) => (auto ? isFreshForAuto(snapshot) : isFresh(snapshot, cfg.cacheSeconds))
    if (!force && state.snapshot && state.snapshot.source === source && fresh(state.snapshot)) {
      return state.snapshot
    }
    if (inflight) return inflight

    inflight = (async () => {
      if (!force) {
        const disk = await readDiskSnapshot(source)
        if (fresh(disk)) {
          state.snapshot = disk
          state.error = ''
          state.at = disk.fetchedAt
          return disk
        }
      }
      try {
        const snapshot = await readSource(cfg)
        snapshot.version = SNAPSHOT_VERSION
        state.snapshot = snapshot
        state.error = ''
        state.at = snapshot.fetchedAt
        await writeDiskSnapshot(source, snapshot)
        return snapshot
      } catch (error) {
        const message = error && error.message ? error.message : String(error)
        state.error = message
        if (state.snapshot && state.snapshot.source === source) return state.snapshot
        const disk = await readDiskSnapshot(source)
        if (disk) {
          state.snapshot = disk
          state.at = disk.fetchedAt
          return disk
        }
        throw error
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  /** A snapshot or a structured "why not" both travel as data, never a throw. */
  async function snapshotOrProblem(options) {
    try {
      const snapshot = await ensureSnapshot(options)
      return { snapshot }
    } catch (error) {
      return { problem: error && error.message ? error.message : String(error) }
    }
  }

  // --- tools -------------------------------------------------------------

  const text = (value) => [{ type: 'text', text: String(value) }]

  /** One shared tool prologue: turn a failed read into a readable result. */
  const withSnapshot = (run) => async (args) => {
    const { snapshot, problem } = await snapshotOrProblem({ force: args && args.refresh === true })
    if (problem) {
      return {
        ok: false,
        error: problem,
        hint: '在「设置 → 插件 → dsh-genshin-account」里选择数据源并填写查询所需信息，然后重新调用本工具。',
      }
    }
    try {
      return await run(snapshot, args || {})
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) }
    }
  }


  const tools = [
    {
      name: 'genshin_account_overview',
      description:
        '读取并汇总当前配置的原神账号：数据源、UID/昵称、角色数量与各元素人数、武器与圣遗物总数、最佳圣遗物。回答任何账号整体问题前先用它。传 refresh:true 可强制重新同步。',
      parameters: {
        type: 'object',
        properties: { refresh: { type: 'boolean', description: '跳过缓存，强制重新读取数据源' } },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => text(formatOverview(value)),
      },
      execute: withSnapshot(async (snapshot) => ({ ok: true, overview: overview(snapshot) })),
    },
    {
      name: 'genshin_characters',
      description:
        '列出账号里的角色，可按元素（火/水/风/雷/草/冰/岩 或 pyro/hydro…）、武器类型（单手剑/双手剑/长柄武器/弓/法器）与最低等级过滤，并指定排序。',
      parameters: {
        type: 'object',
        properties: {
          element: { type: 'string', description: '元素：火/水/风/雷/草/冰/岩，或 pyro/hydro/anemo/electro/dendro/cryo/geo' },
          weapon: { type: 'string', description: '武器类型：单手剑/双手剑/长柄武器/弓/法器，或 sword/claymore/polearm/bow/catalyst' },
          minLevel: { type: 'number', description: '最低等级' },
          sort: { type: 'string', enum: ['level', 'rarity', 'name', 'cv'], description: '排序方式，默认 level' },
          limit: { type: 'number', description: '最多返回几个角色，默认 40' },
          refresh: { type: 'boolean', description: '强制重新同步' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => text(formatCharacters(value)),
      },
      execute: withSnapshot(async (snapshot, args) => {
        const rows = listCharacters(snapshot, args)
        const limit = Number(args.limit) > 0 ? Number(args.limit) : 40
        return { ok: true, total: rows.length, characters: rows.slice(0, limit), source: snapshot.source }
      }),
    },
    {
      name: 'genshin_character',
      description:
        '读取单个角色的完整练度：等级、命座、三段天赋等级、面板（若数据源提供）、武器（精炼/等级）、五件圣遗物（套装、主词条、副词条、暴击值 CV 与词条效率）以及生效的套装效果文本。圣遗物的主副词条只对该角色在游戏内「角色展柜」里时才可得。角色名支持中文、英文或别名。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '角色名：胡桃 / HuTao / hutao / 10000046' },
          refresh: { type: 'boolean', description: '强制重新同步' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => text(formatCharacter(value)),
      },
      execute: withSnapshot(async (snapshot, args) => {
        const found = getCharacter(snapshot, args.name)
        if (found.error) return { ok: false, error: found.error }
        return { ok: true, character: characterView(snapshot, found) }
      }),
    },
    {
      name: 'genshin_artifacts',
      description:
        '查询圣遗物：按套装、部位（生之花/死之羽/时之沙/空之杯/理之冠）、装备角色、最低暴击值过滤，按 CV / 词条效率 / 等级排序取前 N 件。CV = 暴击率×2 + 暴击伤害（仅副词条）。数据来自游戏内「角色展柜」，因此只包含展柜中的角色（最多 8 个）。',
      parameters: {
        type: 'object',
        properties: {
          set: { type: 'string', description: '套装名，如 炽烈的炎之魔女 / CrimsonWitchOfFlames' },
          slot: { type: 'string', description: '部位：flower/plume/sands/goblet/circlet 或 生之花/死之羽/时之沙/空之杯/理之冠' },
          owner: { type: 'string', description: '只查某个角色装备的圣遗物' },
          minCv: { type: 'number', description: '最低暴击值，默认 0' },
          sort: { type: 'string', enum: ['cv', 'efficiency', 'level', 'set'], description: '默认 cv' },
          limit: { type: 'number', description: '最多返回几件，默认 20' },
          refresh: { type: 'boolean', description: '强制重新同步' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => text(formatArtifacts(value)),
      },
      execute: withSnapshot(async (snapshot, args) => {
        const rows = listArtifacts(snapshot, args)
        if (rows && rows.error) return { ok: false, error: rows.error }
        return { ok: true, total: rows.length, artifacts: rows, source: snapshot.source }
      }),
    },
    {
      name: 'genshin_gacha',
      description:
        '祈愿（抽卡）记录分析：总抽数、五星/四星数量、平均出金、欧非比、各祈愿池的抽数与保底进度、五星出货区间、每月抽卡量、五星记录。数据来自本机已同步的祈愿历史。',
      parameters: {
        type: 'object',
        properties: {
          banner: {
            type: 'string',
            description: '只看某个祈愿池：新手/常驻/角色活动/武器活动/集录，或 100/200/301/302/500',
          },
          limit: { type: 'number', description: '五星记录最多返回几条，默认 20' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => text(formatGacha(value)),
      },
      async execute(args) {
        const cfg = readConfig()
        const records = miyousheGacha.readRecords(cfg.miyousheUid)
        const analysis = miyousheGacha.analyze(records)
        if (!analysis.total) {
          return {
            ok: false,
            total: 0,
            error:
              '还没有祈愿记录。请先在游戏里打开一次「祈愿 → 历史记录」（让游戏把带 authkey 的链接写进本地缓存），' +
              '然后在插件的「抽卡」页点一次「同步抽卡」。',
          }
        }
        const wanted = String((args && args.banner) || '').trim()
        const limit = Number(args && args.limit) > 0 ? Number(args.limit) : 20
        if (!wanted) {
          return { ok: true, ...analysis, fiveStars: analysis.fiveStars.slice(0, limit) }
        }
        // Narrow to one banner: recompute from the stored records so pity and
        // averages describe that banner only.
        const match = miyousheGacha.BANNERS.find((banner) => banner.label === wanted || banner.type === wanted)
        const type = match ? match.type : wanted
        const scoped = {
          uid: records.uid,
          updatedAt: records.updatedAt,
          items: (records.items || []).filter((item) => String(item.gacha_type) === String(type)),
        }
        const scopedAnalysis = miyousheGacha.analyze(scoped)
        return {
          ok: true,
          banner: miyousheGacha.bannerLabel(type),
          ...scopedAnalysis,
          fiveStars: scopedAnalysis.fiveStars.slice(0, limit),
        }
      },
    },
    {
      name: 'genshin_weapons',
      description:
        '查询武器：按类型、最低稀有度过滤，可只看已装备的，按稀有度/等级排序。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: '武器类型：单手剑/双手剑/长柄武器/弓/法器' },
          rarity: { type: 'number', description: '最低稀有度，如 5' },
          sort: { type: 'string', enum: ['rarity', 'level', 'name'], description: '默认 rarity' },
          limit: { type: 'number', description: '最多返回几把，默认 30' },
          equippedOnly: { type: 'boolean', description: '只看被角色装备的武器' },
          refresh: { type: 'boolean', description: '强制重新同步' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => text(formatWeapons(value)),
      },
      execute: withSnapshot(async (snapshot, args) => {
        const rows = listWeapons(snapshot, args)
        return { ok: true, total: rows.length, weapons: rows.slice(0, Number(args.limit) > 0 ? Number(args.limit) : 30), source: snapshot.source }
      }),
    },
  ]

  ctx.inject(['tools'], (host) => {
    const disposers = tools.map((tool) =>
      host.tools.register({
        ...tool,
        isConcurrencySafe: () => true,
      }),
    )
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  // --- HTTP routes for the browser half ----------------------------------

  ctx.inject(['webServer'], (host) => {
    const json = (res, status, value) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    const sameOrigin = (req) => {
      const origin = req.headers.origin
      if (typeof origin !== 'string' || origin === '') return true
      try {
        return new URL(origin).host === req.headers.host
      } catch {
        return false
      }
    }

    // Everything the setup wizard needs to prefill its form. The cookie is
    // never echoed back — only whether one is stored.
    const configView = () => {
      const cfg = readConfig()
      return {
        source: 'miyoushe',
        miyousheUid: cfg.miyousheUid,
        miyousheServer: cfg.miyousheServer || '',
        hasCookie: cfg.miyousheCookie.trim() !== '',
        miyousheAppVersion: cfg.miyousheAppVersion || '',
        miyousheDsSalt: cfg.miyousheDsSalt || '',
        cacheSeconds: cfg.cacheSeconds,
        // 只暴露「有没有存过」，不把带 authkey 的链接送到界面上
        hasGachaUrl: Boolean(cfg.gachaUrl && String(cfg.gachaUrl).trim()),
      }
    }

    const sourceStates = () => {
      const cfg = readConfig()
      return {
        miyoushe: {
          configured: /^\d{5,12}$/.test(cfg.miyousheUid.trim()) && cfg.miyousheCookie.trim() !== '',
          detail:
            cfg.miyousheUid.trim() !== ''
              ? 'UID ' + cfg.miyousheUid.trim() + (cfg.miyousheCookie.trim() !== '' ? ' · 已扫码登录' : ' · 尚未扫码登录')
              : '还没有填写 UID',
        },
      }
    }

    // Small ring buffer of client-side lifecycle events. The browser half cannot
    // be attached to a debugger on the user's machine, so it reports `apply` /
    // `register` / `heal` events here and they are visible through /state.
    // Bounded and in-memory: nothing is persisted and nothing is personal.
    const diagnostics = []

    const recordDiagnostic = (entry) => {
      if (!entry || typeof entry !== 'object') return
      diagnostics.push({
        at: Date.now(),
        instance: typeof entry.instance === 'string' ? entry.instance.slice(0, 16) : '',
        event: typeof entry.event === 'string' ? entry.event.slice(0, 40) : '',
        detail: entry.detail === undefined ? null : entry.detail,
        url: typeof entry.url === 'string' ? entry.url.slice(0, 200) : '',
      })
      if (diagnostics.length > 80) diagnostics.splice(0, diagnostics.length - 80)
    }

    const stateOf = () => {
      const cfg = readConfig()
      const snapshot = state.snapshot
      return {
        source: 'miyoushe',
        configured: configuredEnough(cfg),
        hasSnapshot: Boolean(snapshot),
        fetchedAt: snapshot ? snapshot.fetchedAt : 0,
        error: state.error,
        stale: snapshot ? !isFresh(snapshot, cfg.cacheSeconds) : true,
        cacheSeconds: cfg.cacheSeconds,
        note: snapshot ? snapshot.note || '' : '',
        uid: snapshot ? snapshot.uid : '',
        config: configView(),
        sources: sourceStates(),
        diagnostics,
        version: PLUGIN_VERSION,
        repo: 'https://github.com/EagleClark/dsh-genshin-account',
        blog: 'https://eagle90.com',
      }
    }

    let apexCache = null

    const disposers = [
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/asset/apexcharts.js`,
        handler: async (req, res) => {
          if (!APEX_FILE || !existsSync(APEX_FILE)) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('apexcharts not installed')
            return
          }
          if (!apexCache) apexCache = await readFile(APEX_FILE)
          res.writeHead(200, {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': 'public, max-age=86400',
          })
          res.end(apexCache)
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/state`,
        handler: (req, res) => json(res, 200, stateOf()),
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/summary`,
        handler: async (req, res) => {
          const { snapshot, problem } = await snapshotOrProblem({ auto: true })
          if (!snapshot) return json(res, 200, { ok: false, error: problem, state: stateOf() })
          json(res, 200, {
            ok: true,
            state: stateOf(),
            overview: overview(snapshot),
            characters: listCharacters(snapshot, {}),
          })
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/character`,
        handler: async (req, res) => {
          const url = new URL(req.url, 'http://localhost')
          const wanted = url.searchParams.get('name') || url.searchParams.get('id') || ''
          const { snapshot, problem } = await snapshotOrProblem({})
          if (!snapshot) return json(res, 200, { ok: false, error: problem })
          const found = getCharacter(snapshot, wanted)
          if (found.error) return json(res, 200, { ok: false, error: found.error })
          json(res, 200, { ok: true, character: characterView(snapshot, found) })
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/artifacts`,
        handler: async (req, res) => {
          const url = new URL(req.url, 'http://localhost')
          const { snapshot, problem } = await snapshotOrProblem({})
          if (!snapshot) return json(res, 200, { ok: false, error: problem })
          const rows = listArtifacts(snapshot, {
            set: url.searchParams.get('set') || undefined,
            slot: url.searchParams.get('slot') || undefined,
            owner: url.searchParams.get('owner') || undefined,
            minCv: Number(url.searchParams.get('minCv') || 0),
            sort: url.searchParams.get('sort') || 'cv',
            limit: Number(url.searchParams.get('limit') || 60),
          })
          if (rows && rows.error) return json(res, 200, { ok: false, error: rows.error })
          json(res, 200, { ok: true, artifacts: rows })
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/weapons`,
        handler: async (req, res) => {
          const url = new URL(req.url, 'http://localhost')
          const { snapshot, problem } = await snapshotOrProblem({})
          if (!snapshot) return json(res, 200, { ok: false, error: problem })
          json(res, 200, {
            ok: true,
            weapons: listWeapons(snapshot, {
              type: url.searchParams.get('type') || undefined,
              rarity: Number(url.searchParams.get('rarity') || 0) || undefined,
              sort: url.searchParams.get('sort') || 'rarity',
              limit: Number(url.searchParams.get('limit') || 100),
            }),
          })
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/login/qr`,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          if (!sameOrigin(req)) return json(res, 403, { ok: false, error: 'untrusted origin' })
          try {
            const qr = await miyousheLogin.createQr()
            return json(res, 200, { ok: true, ticket: qr.ticket, svg: qr.svg, url: qr.url })
          } catch (error) {
            return json(res, 200, { ok: false, error: (error && error.message) || String(error) })
          }
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/login/poll`,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          if (!sameOrigin(req)) return json(res, 403, { ok: false, error: 'untrusted origin' })
          let ticket = ''
          try {
            const text = await readBodyText(req, 8 * 1024)
            const body = JSON.parse(text || '{}')
            ticket = String((body && body.ticket) || '')
          } catch {
            ticket = ''
          }
          if (!ticket) return json(res, 200, { ok: false, error: '缺少 ticket' })
          try {
            const result = await miyousheLogin.pollQr(ticket)
            // The cookie goes back to the page only so the wizard can write it
            // through the settings document; it is never logged here.
            return json(res, 200, {
              ok: true,
              status: result.status,
              cookie: result.cookie || '',
              uid: result.uid || '',
            })
          } catch (error) {
            return json(res, 200, { ok: false, error: (error && error.message) || String(error) })
          }
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/probe-miyoushe`,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          if (!sameOrigin(req)) return json(res, 403, { ok: false, error: 'untrusted origin' })
          const cfg = readConfig()
          let results
          try {
            results = await miyousheSource.probeEndpoints(cfg)
          } catch (error) {
            results = [{ step: 'probe', ok: false, message: String((error && error.message) || error) }]
          }
          recordDiagnostic({ instance: 'host', event: 'probe', detail: results })
          return json(res, 200, { ok: true, uid: cfg.miyousheUid, server: cfg.miyousheServer, results })
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/diag`,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          if (!sameOrigin(req)) return json(res, 403, { ok: false })
          try {
            const text = await readBodyText(req, 64 * 1024)
            const payload = JSON.parse(text || '{}')
            const events = Array.isArray(payload) ? payload : Array.isArray(payload.events) ? payload.events : [payload]
            for (const event of events.slice(0, 20)) recordDiagnostic(event)
          } catch (error) {
            /* diagnostics must never fail the page */
          }
          return json(res, 200, { ok: true })
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/verify/widget`,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET' })
            res.end()
            return
          }
          let purpose = 'index'
          try {
            const url = new URL(req.url, 'http://localhost')
            purpose = url.searchParams.get('purpose') || 'index'
          } catch {
            /* default purpose */
          }
          const html = renderVerifyPage(purpose)
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            // Deliberately no CSP here: this page only embeds the geetest
            // widget, and a strict policy can break it silently.
            'x-content-type-options': 'nosniff',
          })
          res.end(html)
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/verify/start`,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          if (!sameOrigin(req)) return json(res, 403, { ok: false, error: 'untrusted origin' })
          let purpose = 'index'
          try {
            const body = JSON.parse((await readBodyText(req, 8 * 1024)) || '{}')
            if (body && body.purpose === 'characters') purpose = 'characters'
          } catch {
            /* default purpose */
          }
          try {
            const task = await miyousheSource.createVerification(readConfig(), purpose)
            return json(res, 200, {
              ok: true,
              purpose: task.purpose,
              gt: task.gt,
              challenge: task.challenge,
              newCaptcha: task.newCaptcha,
            })
          } catch (error) {
            return json(res, 200, { ok: false, error: (error && error.message) || String(error) })
          }
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/verify/finish`,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          if (!sameOrigin(req)) return json(res, 403, { ok: false, error: 'untrusted origin' })
          let challenge = ''
          let validate = ''
          let seccode = ''
          let original = ''
          let shapeIndex = 0
          let useSeccode = false
          let omitCookie = false
          let headerMode = false
          let purpose = 'index'
          try {
            const body = JSON.parse((await readBodyText(req, 32 * 1024)) || '{}')
            challenge = String((body && body.challenge) || '')
            validate = String((body && body.validate) || '')
            seccode = String((body && body.seccode) || '')
            original = String((body && body.originalChallenge) || '')
            shapeIndex = Number.isFinite(Number(body && body.shapeIndex)) ? Number(body.shapeIndex) : 0
            useSeccode = body && body.useSeccode === true
            omitCookie = body && body.omitCookie === true
            headerMode = body && body.headerMode === true
            if (body && body.purpose === 'characters') purpose = 'characters'
          } catch {
            /* reported below */
          }
          if (!validate) {
            return json(res, 200, { ok: false, error: '缺少 validate（滑块还没完成）' })
          }

          // miHoYo does not document which challenge/seccode combination it wants,
          // and a wrong guess answers retcode 10306. Try the plausible shapes in
          // order and keep the first token that comes back.
          const candidates = []
          const pushCandidate = (label, payload) => {
            const key = JSON.stringify(payload)
            if (candidates.some((item) => item.key === key)) return
            candidates.push({ label, key, payload })
          }
          // The challenge pair is settled (geetest returns the same challenge we
          // asked with), so the only remaining variable is whether miHoYo wants
          // the seccode alongside the validate.
          const target = original || challenge
          if (!target) {
            return json(res, 200, { ok: false, error: '缺少 challenge（滑块结果不完整）' })
          }
          if (useSeccode) {
            pushCandidate('challenge + validate + seccode', { challenge: target, validate, seccode: seccode || validate + '|jordan' })
          } else {
            pushCandidate('challenge + validate', { challenge: target, validate })
          }
          if (!candidates.length) {
            return json(res, 200, { ok: false, error: '缺少 challenge（滑块结果不完整）' })
          }

          // A solved geetest validate is single-use, so trying several shapes with
          // one drag would burn it. The page therefore sends a shapeIndex and this
          // endpoint tests exactly one shape per drag.
          const wanted = Number(shapeIndex) >= 0 && Number(shapeIndex) < candidates.length ? Number(shapeIndex) : 0
          const candidate = candidates[wanted]
          const cfg = readConfig()
          let lastError = ''
          if (headerMode) {
            // The reference client's other shape: no verifyVerification call at
            // all, the triple rides on the record request.
            try {
              await miyousheSource.tryHeaderChallenge(cfg, { challenge: candidates[0].payload.challenge, validate })
              recordDiagnostic({ instance: 'host', event: 'verify-accepted', detail: { shape: 'headers', index: wanted } })
            } catch (error) {
              lastError = (error && error.message) || String(error)
              recordDiagnostic({ instance: 'host', event: 'verify-rejected', detail: { shape: 'headers', index: wanted, message: String(lastError).split('\n')[0].slice(0, 90) } })
              return json(res, 200, { ok: false, shape: 'headers', shapeIndex: wanted, shapesTotal: 6, error: lastError })
            }
          }
          try {
            const token = await miyousheSource.verifyVerificationRaw(cfg, candidate.payload, purpose, { omitCookie })
            if (token) {
              recordDiagnostic({ instance: 'host', event: 'verify-accepted', detail: { shape: candidate.label, index: wanted } })
            } else {
              lastError = '验证提交后没有返回 token'
            }
          } catch (error) {
            lastError = (error && error.message) || String(error)
            recordDiagnostic({
              instance: 'host',
              event: 'verify-rejected',
              detail: { shape: candidate.label, index: wanted, message: String(lastError).split('\n')[0].slice(0, 90) },
            })
          }
          if (!miyousheSource.getXrpcChallenge(purpose)) {
            return json(res, 200, {
              ok: false,
              shape: candidate.label,
              shapeIndex: wanted,
              shapesTotal: candidates.length,
              error: lastError || '验证没有通过，请重新拖一次滑块。',
            })
          }
          // The token is purpose-specific and now held in memory: read straight
          // away so the user sees the point of passing it.
          try {
            const snapshot = await ensureSnapshot({ force: true })
            return json(res, 200, {
              ok: true,
              purpose,
              state: stateOf(),
              overview: overview(snapshot),
              characters: listCharacters(snapshot, {}),
            })
          } catch (error) {
            const message = (error && error.message) || String(error)
            // Still gated on the *other* purpose: ask for that verification
            // instead of showing a dead end.
            if (error && error.needsVerification) {
              const next = miyousheSource.purposeOf(error.step || '')
              if (next && next !== purpose) {
                return json(res, 200, { ok: true, purpose, needNext: next, error: message, state: stateOf() })
              }
            }
            return json(res, 200, { ok: false, error: message, state: stateOf() })
          }
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/gacha`,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET' })
            res.end()
            return
          }
          const cfg = readConfig()
          const records = miyousheGacha.readRecords(cfg.miyousheUid)
          return json(res, 200, { ok: true, analysis: miyousheGacha.analyze(records) })
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/gacha/sync`,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          if (!sameOrigin(req)) return json(res, 403, { ok: false, error: 'untrusted origin' })
          const cfg = readConfig()
          let url = cfg.gachaUrl
          let full = false
          try {
            const body = JSON.parse((await readBodyText(req, 64 * 1024)) || '{}')
            if (body && typeof body.url === 'string' && body.url.trim()) url = body.url.trim()
            if (body && body.full === true) full = true
          } catch {
            /* fall back to the stored url */
          }
          try {
            const result = await miyousheGacha.syncGacha({
              url: url || undefined,
              uid: cfg.miyousheUid,
              full,
            })
            const records = miyousheGacha.readRecords(cfg.miyousheUid)
            return json(res, 200, { ok: true, ...result, analysis: miyousheGacha.analyze(records) })
          } catch (error) {
            return json(res, 200, {
              ok: false,
              error: (error && error.message) || String(error),
              analysis: miyousheGacha.analyze(miyousheGacha.readRecords(cfg.miyousheUid)),
            })
          }
        },
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/sync`,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          if (!sameOrigin(req)) return json(res, 403, { ok: false, error: 'untrusted origin' })
          const { snapshot, problem } = await snapshotOrProblem({ force: true })
          if (!snapshot) return json(res, 200, { ok: false, error: problem, state: stateOf() })
          json(res, 200, { ok: true, state: stateOf(), overview: overview(snapshot), characters: listCharacters(snapshot, {}) })
        },
      }),
    ]
    host.effect(() => () => {
      for (const dispose of disposers) dispose()
    }, 'dsh-genshin-account: http routes')
  })

  // Warm the cache once at startup so the first question is fast, but never
  // let a cold source break plugin activation.
  ctx.effect(() => {
    const timer = setTimeout(() => {
      ensureSnapshot({}).catch(() => {})
    }, 3000)
    return () => clearTimeout(timer)
  }, 'dsh-genshin-account: warm-up')
}

/** The only source left is the miHoYo record API behind a QR-login session. */
function configuredEnough(cfg) {
  return /^\d{5,12}$/.test(cfg.miyousheUid.trim()) && cfg.miyousheCookie.trim() !== ''
}

// --- text rendering ------------------------------------------------------

/** Wish-history analysis as a readable block. */
function formatGacha(value) {
  if (!value || value.ok === false) return '读取失败：' + String((value && value.error) || '未知原因')
  const lines = []
  lines.push(
    (value.banner ? '祈愿池：' + value.banner + ' · ' : '') +
      '共 ' + value.total + ' 抽 · 五星 ' + value.five + ' · 四星 ' + value.four,
  )
  if (value.averageFive != null) {
    lines.push('平均出金：' + value.averageFive + ' 抽/五星' + (value.luck == null ? '' : ' · 欧非比 ×' + value.luck))
  }
  if (value.lastPullAt) lines.push('最近一抽：' + value.lastPullAt)
  if (value.banners && value.banners.length) {
    lines.push('')
    lines.push('各池进度：')
    for (const bucket of value.banners) {
      lines.push(
        '· ' + bucket.label + '：' + bucket.pulls + ' 抽 · 五星 ' + bucket.five +
          ' · 四星 ' + bucket.four + ' · 距上次五星 ' + bucket.sinceFive,
      )
    }
  }
  if (value.pityBuckets && value.five) {
    lines.push('')
    lines.push('五星出货区间：' + value.pityBuckets.map((bucket) => bucket.label + ' ' + bucket.count).join(' · '))
  }
  if (value.monthly && value.monthly.length) {
    lines.push('每月抽卡量：' + value.monthly.map((row) => row.month + ' ' + row.pulls).join(' · '))
  }
  if (value.fiveStars && value.fiveStars.length) {
    lines.push('')
    lines.push('五星记录（最新在前）：')
    for (const item of value.fiveStars) {
      lines.push('· ' + item.name + ' · ' + (item.banner || item.gacha_type) + ' · 第 ' + item.pity + ' 抽 · ' + item.time)
    }
  }
  return lines.join('\n')
}


const elementLine = (elements) =>
  Object.entries(elements || {})
    .map(([zh, count]) => `${zh}${count}`)
    .join(' · ')

function formatOverview(value) {
  if (!value || value.ok === false) return `读取失败：${(value && value.error) || '未知错误'}${value && value.hint ? '\n' + value.hint : ''}`
  const o = value.overview
  const lines = []
  lines.push(`数据源：${o.source}${o.uid ? ' · UID ' + o.uid : ''}`)
  if (o.player.nickname) lines.push(`账号：${o.player.nickname}` + (o.player.level ? ` · 冒险等级 ${o.player.level}` : '') + (o.player.worldLevel ? ` · 世界等级 ${o.player.worldLevel}` : ''))
  if (o.player.region) lines.push(`服务器：${o.player.region}`)
  lines.push(`角色 ${o.counts.characters} · 武器 ${o.counts.weapons} · 圣遗物 ${o.counts.artifacts}（其中五星 ${o.counts.fiveStarArtifacts}）`)
  if (elementLine(o.elements)) lines.push(`元素分布：${elementLine(o.elements)}`)
  if (o.bestArtifact) lines.push(`最佳圣遗物：${o.bestArtifact.setName} ${o.bestArtifact.slotZh} · CV ${o.bestArtifact.cv} · 效率 ${o.bestArtifact.efficiency}%` + (o.bestArtifact.owner ? ` · ${o.bestArtifact.owner}` : ''))
  if (o.note) lines.push(`说明：${o.note}`)
  lines.push(`同步时间：${new Date(o.fetchedAt).toLocaleString('zh-CN')}`)
  return lines.join('\n')
}

function formatCharacters(value) {
  if (!value || value.ok === false) return `读取失败：${(value && value.error) || '未知错误'}${value && value.hint ? '\n' + value.hint : ''}`
  if (!value.total) return '没有符合条件的角色。'
  const lines = value.characters.map(
    (c) =>
      `${c.name} Lv.${c.level}  ${c.elementZh}  ${c.weaponTypeZh}  ${c.rarity}★  命${c.constellation}` +
      (c.talents ? `  天赋 ${c.talents.auto}/${c.talents.skill}/${c.talents.burst}` : '') +
      (c.weaponName ? `  ${c.weaponName}` : '') +
      (c.artifactCount ? `  圣遗物×${c.artifactCount} CV${c.cv}` : ''),
  )
  return [`共 ${value.total} 个角色：`, ...lines].join('\n')
}

function formatCharacter(value) {
  if (!value || value.ok === false) return `读取失败：${(value && value.error) || '未知错误'}${value && value.hint ? '\n' + value.hint : ''}`
  const c = value.character
  const lines = []
  lines.push(`${c.name}  Lv.${c.level}  ${c.rarity}★  ${c.element}  ${c.weaponType}  命之座 ${c.constellation}`)
  if (c.talents) lines.push(`天赋：普通攻击 ${c.talents.auto} / 元素战技 ${c.talents.skill} / 元素爆发 ${c.talents.burst}`)
  if (c.stats) {
    const parts = []
    if (c.stats.hp) parts.push(`生命 ${c.stats.hp}`)
    if (c.stats.atk) parts.push(`攻击 ${c.stats.atk}`)
    if (c.stats.def) parts.push(`防御 ${c.stats.def}`)
    if (c.stats.critRate_ != null) parts.push(`暴击 ${c.stats.critRate_}%`)
    if (c.stats.critDMG_ != null) parts.push(`爆伤 ${c.stats.critDMG_}%`)
    if (c.stats.enerRech_ != null) parts.push(`充能 ${c.stats.enerRech_}%`)
    if (c.stats.eleMas) parts.push(`精通 ${c.stats.eleMas}`)
    if (parts.length) lines.push('面板：' + parts.join('  '))
  }
  if (c.weapon) lines.push(`武器：${c.weapon.name} Lv.${c.weapon.level} ${c.weapon.refinement == null ? '' : ' 精' + c.weapon.refinement} ${c.weapon.rarity}★`)
  if (c.sets && c.sets.length) lines.push('套装：' + c.sets.map((s) => `${s.setName}×${s.count}`).join(' + '))
  if (c.artifacts && c.artifacts.length) {
    lines.push('圣遗物：')
    for (const a of c.artifacts) {
      lines.push(`  ${a.slotZh} ${a.setName}${a.rarity ? ' ' + a.rarity + '★' : ''} +${a.level}  [${a.main}]  ${a.subs.join(' / ')}  → CV ${a.cv}${a.cvGrade ? ' ' + a.cvGrade : ''} · 效率 ${a.efficiency}%`)
    }
  }
  if (c.setEffects && c.setEffects.length) {
    lines.push('生效套装效果：')
    for (const effect of c.setEffects) lines.push('  · ' + effect)
  }
  return lines.join('\n')
}

function formatArtifacts(value) {
  if (!value || value.ok === false) return `读取失败：${(value && value.error) || '未知错误'}${value && value.hint ? '\n' + value.hint : ''}`
  if (!value.total) return '没有符合条件的圣遗物。'
  const lines = value.artifacts.map(
    (a) => `${a.slotZh} ${a.setName} ${a.rarity}★ +${a.level}  [${a.main}]  CV ${a.cv}${a.cvGrade ? ' ' + a.cvGrade : ''} · 效率 ${a.efficiency}%${a.owner ? '  (' + a.owner + ')' : ''}`,
  )
  return [`共 ${value.total} 件，前 ${value.artifacts.length} 件：`, ...lines].join('\n')
}

function formatWeapons(value) {
  if (!value || value.ok === false) return `读取失败：${(value && value.error) || '未知错误'}${value && value.hint ? '\n' + value.hint : ''}`
  if (!value.total) return '没有符合条件的武器。'
  const lines = value.weapons.map(
    (w) => `${w.name} ${w.rarity}★ ${w.typeZh} Lv.${w.level}` + (w.refinement ? ` 精${w.refinement}` : '') + (w.owner ? `  (${w.owner})` : ''),
  )
  return [`共 ${value.total} 把，前 ${value.weapons.length} 把：`, ...lines].join('\n')
}
