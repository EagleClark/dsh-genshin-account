/**
 * The 养成计算器 (ascension calculator) sync API — the **ungated** path.
 *
 * Why it matters: every `/game_record/app/genshin/api/*` read is behind a
 * geetest challenge (retcode 1034), but `api-takumi.mihoyo.com`'s calculator
 * endpoints are not. `sync/avatar/detail` returns, for one avatar id:
 *
 *   { level, avatar: {name, rarity-ish fields, constellation_num, skill_list,
 *                     weapon, reliquary_list}, skill_list, weapon, reliquary_list }
 *
 * Measured: 124 candidates → 99 owned characters in ~6s, no captcha, with
 * levels, constellations, talent levels, weapon name/level and the equipped
 * artifact pieces (slot + level; the calculator does not expose sub-stats).
 *
 * So this module can always produce a roster. Artifact *stats* (and therefore
 * CV) still need the record API plus one human verification — the snapshot says
 * so in its `note`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildSnapshot, characterRef, makeWeapon } from '../model.js'
import { skillOrderOf } from '../dict.js'
import { callCalc, credentialOf } from './miyoushe.js'
import { fetchExtras } from './miyoushe-extras.js'

const DATA_DIR = new URL('../../data/', import.meta.url)

/**
 * Measured against known characters:
 *   element_attr_id 1..7 → pyro anemo geo dendro electro hydro cryo
 *   weapon_cat_id   1/10/11/12/13 → sword catalyst claymore bow polearm
 * These ids are what the calculator itself returns, so a character the shipped
 * dictionary has never heard of still gets the right element and weapon type.
 */
const ELEMENT_BY_ATTR = { 1: 'pyro', 2: 'anemo', 3: 'geo', 4: 'dendro', 5: 'electro', 6: 'hydro', 7: 'cryo' }
const WEAPON_BY_CAT = { 1: 'sword', 10: 'catalyst', 11: 'claymore', 12: 'bow', 13: 'polearm' }
/** reliquary_cat_id → slot key, in the order the game shows them. */
const SLOT_BY_CAT = { 1: 'flower', 2: 'plume', 3: 'sands', 4: 'goblet', 5: 'circlet' }

/**
 * 要逐个探测的 avatar id。
 *
 * 字典里的 id 是主力；但新角色上线时字典往往还没跟着更新，而计算器只按 id
 * 查询（没有"列出我拥有的角色"这种接口），字典里没有的 id 就永远不会被问到。
 * 所以再从字典最大 id 往后探一小段——没拥有的 id 只回一个空对象，代价很小。
 */
const PROBE_WINDOW = 40

function rosterIds() {
  const raw = JSON.parse(readFileSync(new URL('characters.json', DATA_DIR), 'utf8'))
  const known = Object.keys(raw)
    .map(Number)
    .filter((id) => Number.isFinite(id))
    .sort((a, b) => a - b)
  const max = known.length ? known[known.length - 1] : 0
  const probe = []
  for (let id = max + 1; id <= max + PROBE_WINDOW; id += 1) probe.push(id)
  return [...known, ...probe]
}

const cacheFile = (uid) => {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'data', 'dsh-genshin-account', `calc-${uid}.json`)
}

function readCache(uid, ttlMs) {
  try {
    const stored = JSON.parse(readFileSync(cacheFile(uid), 'utf8'))
    if (stored && typeof stored.at === 'number' && Date.now() - stored.at < ttlMs && Array.isArray(stored.characters)) {
      return stored.characters
    }
  } catch {
    /* no cache yet */
  }
  return null
}

function writeCache(uid, characters) {
  try {
    const target = cacheFile(uid)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, JSON.stringify({ at: Date.now(), characters }), 'utf8')
  } catch {
    /* cache is an optimisation only */
  }
}

/** Pull every owned avatar, `concurrency` at a time with a small gap. */
async function enumerate(creds, { concurrency = 5, gapMs = 110, ttlMs, onProgress } = {}) {
  const cached = readCache(creds.uid, ttlMs)
  if (cached) return cached
  const ids = rosterIds()
  const owned = []
  let cursor = 0
  let done = 0
  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++]
      try {
        const data = await callCalc('/event/e20200928calculate/v1/sync/avatar/detail', creds, {
          params: { avatar_id: id, uid: creds.uid, region: creds.server },
        })
        const avatar = data && data.avatar
        // An avatar the player does not own comes back as an empty object.
        if (avatar && avatar.name) owned.push({ id, ...data })
      } catch {
        /* one bad id must not sink the whole roster */
      }
      done += 1
      if (onProgress) onProgress(done, ids.length)
      if (gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs))
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  writeCache(creds.uid, owned)
  return owned
}

/** `skill_list` → the canonical `{auto, skill, burst}` triplet. */
function talentsFrom(entry) {
  const skills = Array.isArray(entry.skill_list) ? entry.skill_list : []
  const byId = new Map(skills.map((skill) => [Number(skill.id), Number(skill.level_current)]))
  const order = skillOrderOf(String(entry.avatar && entry.avatar.id)) || null
  if (order && order.length >= 3) {
    const auto = byId.get(Number(order[0]))
    const skill = byId.get(Number(order[1]))
    const burst = byId.get(Number(order[2]))
    if (auto != null || skill != null || burst != null) {
      return { auto: auto == null ? null : auto, skill: skill == null ? null : skill, burst: burst == null ? null : burst }
    }
  }
  // Fall back to the display order the calculator returns (normal attack first).
  const levels = skills.map((skill) => Number(skill.level_current)).filter((n) => Number.isFinite(n))
  return { auto: levels[0] == null ? null : levels[0], skill: levels[1] == null ? null : levels[1], burst: levels[2] == null ? null : levels[2] }
}

/**
 * Read the account through the calculator API.
 * @returns a canonical snapshot (no artifact sub-stats)
 */

/**
 * 官方武器图鉴。
 *
 * 同一个计算器接口还提供全量武器目录（不管玩家有没有），每一条都带官方图标，
 * 所以图鉴页不需要任何第三方数据源：
 *
 *   POST /event/e20200928calculate/v1/weapon/list  { page, size }
 *   → { total, list: [{ id, name, icon, weapon_cat_id, weapon_level, ... }] }
 *
 * 分页参数在 body 里（query 会 405）。结果按 uid 缓存，会话失效时用缓存兜底，
 * 这样断网也能看图鉴，只是刷新不了新武器。
 */
const WEAPON_PAGE_SIZE = 100
const WEAPON_PAGES_MAX = 6

export async function fetchWeaponCatalog(config, { ttlMs = 0, cacheFile = '' } = {}) {
  const creds = credentialOf(config)
  const readCache = () => {
    if (!cacheFile) return null
    try {
      const stored = JSON.parse(readFileSync(cacheFile, 'utf8'))
      if (stored && Array.isArray(stored.weapons) && stored.weapons.length) return stored
    } catch {
      /* no cache yet */
    }
    return null
  }
  const cached = readCache()
  if (cached && ttlMs > 0 && Date.now() - Number(cached.at || 0) < ttlMs) {
    return { ...cached, cached: true }
  }
  if (!creds.cookie) {
    if (cached) return { ...cached, cached: true, note: '没有会话，用缓存的图鉴' }
    throw new Error('还没有登录会话：请先扫码登录米游社。')
  }

  const rows = []
  let total = 0
  try {
    for (let page = 1; page <= WEAPON_PAGES_MAX; page += 1) {
      const data = await callCalc('/event/e20200928calculate/v1/weapon/list', creds, {
        method: 'POST',
        payload: { page, size: WEAPON_PAGE_SIZE },
      })
      const list = Array.isArray(data && data.list) ? data.list : []
      total = Number((data && data.total) || total) || total
      if (!list.length) break
      for (const item of list) {
        const id = Number(item.id)
        if (!Number.isFinite(id)) continue
        rows.push({
          id,
          name: item.name || '',
          icon: item.icon || '',
          type: WEAPON_BY_CAT[Number(item.weapon_cat_id)] || 'other',
          rarity: Number(item.weapon_level) || 0,
        })
      }
      if (rows.length >= total) break
    }
  } catch (error) {
    if (cached) return { ...cached, cached: true, note: '图鉴刷新失败，用缓存的图鉴' }
    throw error
  }
  if (!rows.length) {
    if (cached) return { ...cached, cached: true, note: '图鉴为空，用缓存的图鉴' }
    throw new Error('图鉴接口没有返回武器')
  }

  const seen = new Set()
  const weapons = rows.filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)))
  const payload = { at: Date.now(), total: total || weapons.length, weapons }
  if (cacheFile) {
    try {
      mkdirSync(dirname(cacheFile), { recursive: true })
      writeFileSync(cacheFile, JSON.stringify(payload), 'utf8')
    } catch {
      /* cache is an optimisation only */
    }
  }
  return { ...payload, cached: false }
}


/**
 * 官方角色图鉴（全量角色，含未拥有）。
 *
 *   POST /event/e20200928calculate/v1/avatar/list  { page, size }
 *   → { total, list: [{ id, name, icon, weapon_cat_id, avatar_level, element_attr_id }] }
 *
 * 和武器图鉴同一套做法：按 uid 缓存，会话失效时用缓存兜底。
 */
export async function fetchAvatarCatalog(config, { ttlMs = 0, cacheFile = '' } = {}) {
  const creds = credentialOf(config)
  const readCache = () => {
    if (!cacheFile) return null
    try {
      const stored = JSON.parse(readFileSync(cacheFile, 'utf8'))
      if (stored && Array.isArray(stored.characters) && stored.characters.length) return stored
    } catch {
      /* no cache yet */
    }
    return null
  }
  const cached = readCache()
  if (cached && ttlMs > 0 && Date.now() - Number(cached.at || 0) < ttlMs) return { ...cached, cached: true }
  if (!creds.cookie) {
    if (cached) return { ...cached, cached: true, note: '没有会话，用缓存的图鉴' }
    throw new Error('还没有登录会话：请先扫码登录米游社。')
  }

  const rows = []
  let total = 0
  try {
    const data = await callCalc('/event/e20200928calculate/v1/avatar/list', creds, {
      method: 'POST',
      payload: { page: 1, size: 300 },
    })
    total = Number((data && data.total) || 0) || 0
    for (const item of Array.isArray(data && data.list) ? data.list : []) {
      const id = Number(item.id)
      if (!Number.isFinite(id)) continue
      rows.push({
        id,
        name: item.name || '',
        icon: item.icon || '',
        type: WEAPON_BY_CAT[Number(item.weapon_cat_id)] || 'other',
        rarity: Number(item.avatar_level) || 0,
        element: ELEMENT_BY_ATTR[Number(item.element_attr_id)] || 'none',
      })
    }
  } catch (error) {
    if (cached) return { ...cached, cached: true, note: '图鉴刷新失败，用缓存的图鉴' }
    throw error
  }
  if (!rows.length) {
    if (cached) return { ...cached, cached: true, note: '图鉴为空，用缓存的图鉴' }
    throw new Error('图鉴接口没有返回角色')
  }
  const payload = { at: Date.now(), total: total || rows.length, characters: rows }
  if (cacheFile) {
    try {
      mkdirSync(dirname(cacheFile), { recursive: true })
      writeFileSync(cacheFile, JSON.stringify(payload), 'utf8')
    } catch {
      /* cache is an optimisation only */
    }
  }
  return { ...payload, cached: false }
}

export async function fetchSnapshot(config, { onProgress } = {}) {
  const creds = credentialOf(config)
  if (!creds.cookie) throw new Error('还没有登录会话：请先扫码登录米游社。')
  const started = Date.now()

  // The player summary is on the record host but is not gated.
  let player = {}
  try {
    const basic = await callCalc(
      '/roleBasicInfo',
      creds,
      { host: 'record', params: { role_id: creds.uid, server: creds.server } },
    )
    player = {
      nickname: basic.nickname || '',
      level: basic.level == null ? null : Number(basic.level),
      region: basic.region || creds.server,
      signature: basic.signature || '',
    }
  } catch {
    player = { region: creds.server }
  }

  const ttlMs = Math.max(60_000, (Number(config && config.cacheSeconds) || 600) * 1000)
  // Active days / achievements / the two challenge modes are not gated either.
  const extras = await fetchExtras(creds)
  // The card lists every role bound to the miHoYo account; its metrics only
  // describe *this* UID when the card entry matched. Using an unmatched card's
  // numbers showed another character's achievements, so an unmatched card only
  // contributes the challenge text it reports per account.
  if (extras.card && extras.card.matched) {
    player = {
      ...player,
      activeDays: extras.card.activeDays || undefined,
      achievements: extras.card.achievements || undefined,
    }
  }
  const owned = await enumerate(creds, { ttlMs, onProgress })

  const characters = []
  const weapons = []
  for (const entry of owned) {
    const avatar = entry.avatar || {}
    const id = Number(avatar.id || entry.id)
    const ref = characterRef(id)
    const key = ref.key || String(id)
    const weaponRaw = entry.weapon || null
    const weapon = weaponRaw && weaponRaw.id
      ? makeWeapon(Number(weaponRaw.id), {
          level: weaponRaw.level_current == null ? null : Number(weaponRaw.level_current),
          location: key,
          icon: weaponRaw.icon || '',
        })
      : null
    if (weapon) weapons.push(weapon)
    // The calculator lists the equipped pieces (slot + name + level + icon) but
    // no main/sub stats. They stay out of `artifacts` — those must carry stats so
    // CV ranking is honest — and travel as a display-only build preview instead.
    const pieces = (Array.isArray(entry.reliquary_list) ? entry.reliquary_list : [])
      .map((relic) => ({
        slot: SLOT_BY_CAT[Number(relic.reliquary_cat_id)] || '',
        name: relic.name || '',
        icon: relic.icon || '',
        level: relic.level_current == null ? null : Number(relic.level_current),
        rarity: relic.reliquary_level == null ? null : Number(relic.reliquary_level),
      }))
      .filter((piece) => piece.slot)
    characters.push({
      id: String(id),
      key,
      name: avatar.name || ref.name || String(id),
      icon: avatar.icon || '',
      // Dictionary first (it is curated), then the ids the API just gave us.
      element: ref.element || ELEMENT_BY_ATTR[Number(avatar.element_attr_id)] || 'none',
      weaponType: ref.weaponType || ref.weapon || WEAPON_BY_CAT[Number(avatar.weapon_cat_id)] || 'other',
      // 字典优先（人工校对过）；新角色字典里还没有时，用计算器给的
      // avatar_level —— 实测它等于星级（4★ 角色都是 4，5★ 都是 5）。
      rarity: ref.rarity || Number(avatar.avatar_level) || 0,
      level: entry.level == null ? Number(avatar.level_current) || 0 : Number(entry.level),
      constellation: Number(avatar.constellation_num) || 0,
      talents: talentsFrom(entry),
      stats: null,
      equippedWeapon: weapon,
      equippedPieces: pieces,
      artifactCount: pieces.length,
    })
  }

  return buildSnapshot({
    source: 'miyoushe',
    uid: creds.uid,
    player,
    characters,
    weapons,
    artifacts: [],
    challenges: {
      card: extras.card,
      hardChallenge: extras.hardChallenge,
      roleCombat: extras.roleCombat,
    },
    note: `米游社 · 国服 · 养成计算器同步（${characters.length} 个角色，${Math.round((Date.now() - started) / 100) / 10}s）`,
    elapsedMs: Date.now() - started,
  })
}
