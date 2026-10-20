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

const DATA_DIR = new URL('../../data/', import.meta.url)

/** Every avatar id the shipped dictionary knows, as numbers. */
function rosterIds() {
  const raw = JSON.parse(readFileSync(new URL('characters.json', DATA_DIR), 'utf8'))
  return Object.keys(raw)
    .map(Number)
    .filter((id) => Number.isFinite(id))
    .sort((a, b) => a - b)
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
        })
      : null
    if (weapon) weapons.push(weapon)
    characters.push({
      id: String(id),
      key,
      name: avatar.name || ref.name || String(id),
      element: ref.element || 'none',
      weaponType: ref.weaponType || 'other',
      rarity: ref.rarity || 0,
      level: entry.level == null ? Number(avatar.level_current) || 0 : Number(entry.level),
      constellation: Number(avatar.constellation_num) || 0,
      talents: talentsFrom(entry),
      stats: null,
      equippedWeapon: weapon,
      // The calculator lists the equipped pieces but not their stats; keep the
      // count so the UI can say "5 件（词条待验证）" instead of pretending.
      artifactCount: Array.isArray(entry.reliquary_list) ? entry.reliquary_list.length : 0,
    })
  }

  return buildSnapshot({
    source: 'miyoushe',
    uid: creds.uid,
    player,
    characters,
    weapons,
    artifacts: [],
    note: `米游社 · 国服 · 养成计算器同步（${characters.length} 个角色，${Math.round((Date.now() - started) / 100) / 10}s）`,
    elapsedMs: Date.now() - started,
  })
}
