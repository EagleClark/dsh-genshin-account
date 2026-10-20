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
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import * as miyousheSource from './sources/miyoushe.js'
import * as miyousheCalc from './sources/miyoushe-calc.js'
import * as miyousheLogin from './sources/miyoushe-login.js'
import { renderVerifyPage } from './verify-page.js'
import {
  activeSetEffects,
  getCharacter,
  listArtifacts,
  listCharacters,
  listWeapons,
  overview,
  publicArtifact,
  setSummary,
} from './model.js'

export const name = 'dsh-genshin-account'

const ROUTE_PREFIX = '/dsh-genshin-account'

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
      ' · 圣遗物副词条与评分需要一次「安全验证」（概览、武器、天赋已经可用）'
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
      return snapshot
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

  function isFresh(snapshot, cacheSeconds) {
    if (!snapshot || !snapshot.fetchedAt) return false
    return Date.now() - snapshot.fetchedAt < cacheSeconds * 1000
  }

  /**
   * Return a snapshot, refreshing from the source when needed.
   * A failed refresh never throws away a usable snapshot: the previous one is
   * returned together with the error, so the page keeps rendering.
   */
  async function ensureSnapshot({ force = false } = {}) {
    const cfg = readConfig()
    const source = sourceOrDefault()
    if (!force && state.snapshot && state.snapshot.source === source && isFresh(state.snapshot, cfg.cacheSeconds)) {
      return state.snapshot
    }
    if (inflight) return inflight

    inflight = (async () => {
      if (!force && cfg.cacheSeconds > 0) {
        const disk = await readDiskSnapshot(source)
        if (isFresh(disk, cfg.cacheSeconds)) {
          state.snapshot = disk
          state.error = ''
          state.at = disk.fetchedAt
          return disk
        }
      }
      try {
        const snapshot = await readSource(cfg)
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

  const characterView = (snapshot, character) => ({
    name: character.name,
    level: character.level,
    rarity: character.rarity,
    element: character.elementZh,
    weaponType: character.weaponTypeZh,
    constellation: character.constellation,
    talents: character.talents,
    stats: character.stats || null,
    weapon: character.equippedWeapon
      ? {
          name: character.equippedWeapon.name,
          rarity: character.equippedWeapon.rarity,
          level: character.equippedWeapon.level,
          refinement: character.equippedWeapon.refinement,
        }
      : null,
    sets: setSummary(character.artifacts),
    setEffects: activeSetEffects(character.artifacts),
    artifacts: (character.artifacts || []).map(publicArtifact),
    source: snapshot.source,
  })

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
        '读取单个角色的完整练度：等级、命座、三段天赋等级、面板（若数据源提供）、武器（精炼/等级）、五件圣遗物（套装、主词条、副词条、暴击值 CV 与词条效率）以及生效的套装效果文本。角色名支持中文、英文或别名。',
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
        '查询圣遗物：按套装、部位（生之花/死之羽/时之沙/空之杯/理之冠）、装备角色、最低暴击值过滤，按 CV / 词条效率 / 等级排序取前 N 件。CV = 暴击率×2 + 暴击伤害（仅副词条）。',
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
      }
    }

    const disposers = [
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/state`,
        handler: (req, res) => json(res, 200, stateOf()),
      }),
      host.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/summary`,
        handler: async (req, res) => {
          const { snapshot, problem } = await snapshotOrProblem({})
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
            'content-security-policy': [
              "default-src 'none'",
              "script-src 'unsafe-inline' https://static.geetest.com https://*.geetest.com",
              "style-src 'unsafe-inline' https://*.geetest.com",
              "font-src https://*.geetest.com data:",
              "img-src https://*.geetest.com data:",
              "connect-src 'self' https://*.geetest.com",
              "frame-src https://*.geetest.com",
              "base-uri 'none'",
              "form-action 'none'",
            ].join('; '),
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
          let purpose = 'index'
          try {
            const body = JSON.parse((await readBodyText(req, 32 * 1024)) || '{}')
            challenge = String((body && body.challenge) || '')
            validate = String((body && body.validate) || '')
            if (body && body.purpose === 'characters') purpose = 'characters'
          } catch {
            /* reported below */
          }
          if (!challenge || !validate) {
            return json(res, 200, { ok: false, error: '缺少 challenge / validate（滑块还没完成）' })
          }
          try {
            await miyousheSource.verifyVerification(readConfig(), challenge, validate, purpose)
          } catch (error) {
            return json(res, 200, { ok: false, error: (error && error.message) || String(error) })
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
  if (c.weapon) lines.push(`武器：${c.weapon.name} Lv.${c.weapon.level} 精${c.weapon.refinement ?? '?'} ${c.weapon.rarity}★`)
  if (c.sets && c.sets.length) lines.push('套装：' + c.sets.map((s) => `${s.setName}×${s.count}`).join(' + '))
  if (c.artifacts && c.artifacts.length) {
    lines.push('圣遗物：')
    for (const a of c.artifacts) {
      lines.push(`  ${a.slotZh} ${a.setName}${a.rarity ? ' ' + a.rarity + '★' : ''} +${a.level}  [${a.main}]  ${a.subs.join(' / ')}  → CV ${a.cv} · 效率 ${a.efficiency}% · ${a.grade}`)
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
    (a) => `${a.slotZh} ${a.setName} ${a.rarity}★ +${a.level}  [${a.main}]  CV ${a.cv} · 效率 ${a.efficiency}% · ${a.grade}${a.owner ? '  (' + a.owner + ')' : ''}`,
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
