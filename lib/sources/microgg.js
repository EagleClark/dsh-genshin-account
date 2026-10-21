/**
 * MicroGG — the CN-compatible Enka mirror.
 *
 * The miHoYo record API is a dead end for artifact sub-stats: every hand-made
 * request answers `1034`, and even a fully logged-in browser on the official
 * domain gets the same code. The showcase route is different: a player puts up
 * to eight characters in the in-game「角色展柜」and enables「显示详情」, after
 * which the build is public and readable **by UID alone** — no cookie, no
 * captcha.
 *
 * `profile.microgg.cn` serves that data for the CN servers in the same shape
 * `enka.network` uses for the international ones, so one mapper covers both.
 *
 * The trade-off is scope: only the showcased characters are visible, and only
 * after the account has been refreshed once the game writes the change (a few
 * minutes). Everything else — the other ~90 characters, talents, constellations
 * — still comes from the ungated calculator sync.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { nameOfHash } from '../dict.js'
import { buildSnapshot, makeArtifact, makeWeapon, statLine } from '../model.js'
import { statKeyOfProp } from '../stats.js'

/**
 * CN first, then the international host as a fallback (a 5-开头 UID on 世界树
 * occasionally serves from Enka directly).
 */
const HOSTS = [{ key: 'microgg', base: 'http://profile.microgg.cn' }]

/** Enka only serves the international servers; a CN UID there is a 403 or a 404. */
const INTL_HOST = { key: 'enka', base: 'https://enka.network' }

function isInternationalUid(uid) {
  return /^[6-9]\d{8}$/.test(String(uid || ''))
}

/** Enka's `propMap` keys we care about (see Enka's prop id table). */
const PROP_LEVEL = '4001'

function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Build one artifact from an `equipList` entry.
 *
 * Enka gives both the raw ids (`reliquary.mainPropId` / `appendPropIdList`) and
 * a resolved view under `flat` (`reliquaryMainstat` / `reliquarySubstats`). The
 * resolved view is what we want: it already carries the numbers, so no stat
 * table has to be applied twice.
 */
function artifactFrom(item, { location }) {
  const flat = item.flat || {}
  const relic = item.reliquary || {}
  const mainProp = (flat.reliquaryMainstat && flat.reliquaryMainstat.mainPropId) || relic.mainPropId
  const mainValue = flat.reliquaryMainstat ? flat.reliquaryMainstat.statValue : null
  const subs = (Array.isArray(flat.reliquarySubstats) ? flat.reliquarySubstats : [])
    .map((sub) => {
      const key = statKeyOfProp(sub.appendPropId)
      return key ? statLine(key, sub.statValue) : null
    })
    .filter(Boolean)

  // `setId` is the numeric game id the shipped dictionary is keyed by; the text
  // hash is only a fallback because the dictionary's hash table covers names,
  // not every artifact set.
  const setId = flat.setId == null ? '' : String(flat.setId)
  const setName = nameOfHash(flat.setNameTextMapHash) || ''
  const iconName = flat.icon || ''

  return makeArtifact({
    setKey: setId || setName || item.itemId,
    slot: flat.equipType || relic.slot,
    rarity: toNumber(flat.rankLevel || relic.rankLevel, 5),
    level: toNumber(relic.level),
    main: mainValue == null ? null : statLine(statKeyOfProp(mainProp), mainValue),
    subs,
    location,
    // MicroGG's own /ui/ path 404s; the official record CDN carries the same
    // sprite under game_record/genshin/equip, which is also what the record API
    // links to.
    icon: iconName ? `https://upload-bbs.mihoyo.com/game_record/genshin/equip/${iconName}.png` : '',
    // Enka has no piece name; the set + slot is what the UI shows anyway.
    pieceName: '',
  })
}

function weaponFrom(item, { location }) {
  const flat = item.flat || {}
  const weapon = item.weapon || {}
  const affix = weapon.affixMap ? Object.values(weapon.affixMap)[0] : null
  const name = nameOfHash(flat.nameTextMapHash) || ''
  const iconName = flat.icon || ''
  const built = makeWeapon(item.itemId || flat.nameTextMapHash, {
    level: toNumber(weapon.level),
    // Enka's affixMap stores 0-based refinement.
    refinement: affix == null ? null : toNumber(affix) + 1,
    location,
    icon: iconName ? `https://upload-bbs.mihoyo.com/game_record/genshin/equip/${iconName}.png` : '',
  })
  if (name && built && built.name === String(flat.nameTextMapHash)) built.name = name
  return built
}

/**
 * Map one raw MicroGG/Enka payload to the shape the rest of the plugin uses.
 *
 * Shared by the live fetch and the cached copy, so a stale cache goes through
 * exactly the same code and cannot drift from a fresh response.
 */
export function mapPayload(data) {
  const player = (data && data.playerInfo) || {}
  const list = Array.isArray(data && data.avatarInfoList) ? data.avatarInfoList : []
  const builds = list.map((avatar) => {
    const avatarId = String(avatar.avatarId || '')
    const level = toNumber(avatar.propMap && avatar.propMap[PROP_LEVEL] && avatar.propMap[PROP_LEVEL].val)
    const artifacts = []
    let weapon = null
    for (const item of Array.isArray(avatar.equipList) ? avatar.equipList : []) {
      if (item.reliquary) artifacts.push(artifactFrom(item, { location: avatarId }))
      else if (item.weapon) weapon = weaponFrom(item, { location: avatarId })
    }
    return { avatarId, level, artifacts, weapon }
  })
  return {
    player: {
      nickname: player.nickname || '',
      level: toNumber(player.level),
      worldLevel: player.worldLevel == null ? undefined : toNumber(player.worldLevel),
      signature: player.signature || '',
      achievements: player.finishAchievementNum == null ? undefined : toNumber(player.finishAchievementNum),
    },
    builds,
  }
}

/**
 * Read one account's showcase. Never throws: a missing showcase is a normal
 * state, so the caller gets `ok: false` plus a human-readable reason.
 *
 * The mirror is a shared community service: the first request after a cold spell
 * can take ten seconds or answer 424, while later ones come from its cache in
 * ~50ms. `cacheFile` keeps the last good raw response so a hiccup degrades to
 * slightly stale artifacts instead of losing them entirely.
 */
export async function fetchShowcase(uid, { timeoutMs = 9000, attempts = 4, cacheFile = '' } = {}) {
  const target = String(uid || '').trim()
  if (!/^\d{9}$/.test(target)) {
    return { ok: false, uid: target, builds: [], note: 'UID 不是 9 位数字，无法查询展柜' }
  }

  // A CN account is only worth asking MicroGG; Enka answers 403 behind its
  // Cloudflare challenge, so trying it just spends the sync's time budget.
  const hosts = isInternationalUid(target) ? [...HOSTS, INTL_HOST] : HOSTS
  let lastError = ''

  for (const host of hosts) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        // No Referer: MicroGG's own front end sends none, and the 424 path (their
        // backend could not reach the game service) is intermittent either way.
        const res = await fetch(`${host.base}/api/uid/${target}`, {
          headers: { 'user-agent': 'dsh-genshin-account', accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (res.status === 424 || res.status === 429 || res.status >= 500) {
          // Retryable: the mirror is warming up or rate limiting.
          lastError = `${host.key} HTTP ${res.status}`
          if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1200))
          continue
        }
        if (!res.ok) {
          lastError = `${host.key} HTTP ${res.status}`
          break
        }

        const data = await res.json()
        if (cacheFile) {
          try {
            mkdirSync(dirname(cacheFile), { recursive: true })
            writeFileSync(cacheFile, JSON.stringify(data), 'utf8')
          } catch {
            /* a cache write is best effort */
          }
        }
        const mapped = mapPayload(data)
        return {
          ok: true,
          uid: target,
          host: host.key,
          player: mapped.player,
          builds: mapped.builds,
          note: mapped.builds.length
            ? `展柜 ${mapped.builds.length} 个角色来自 ${host.key}（含圣遗物主副词条）`
            : '展柜是空的：游戏内 资料 → 角色展柜，放上角色并开启「显示详情」，等 5 分钟再同步',
        }
      } catch (error) {
        lastError = `${host.key} ${(error && error.message) || error}`
        if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1200))
      }
    }
  }

  if (cacheFile) {
    try {
      const mapped = mapPayload(JSON.parse(readFileSync(cacheFile, 'utf8')))
      if (mapped.builds.length) {
        return {
          ok: true,
          uid: target,
          host: 'cache',
          player: mapped.player,
          builds: mapped.builds,
          note: `展柜 ${mapped.builds.length} 个角色来自上次缓存（本次读取失败：${lastError || '未知原因'}）`,
        }
      }
    } catch {
      /* no usable cache */
    }
  }
  return { ok: false, uid: target, builds: [], note: `展柜读取失败：${lastError || '未知原因'}` }
}

/**
 * Merge a showcase into a calculator-built snapshot.
 *
 * The calculator knows all ~99 characters but no artifact stats; the showcase
 * knows stats for up to eight. Artifacts are re-keyed to the roster character so
 * `buildSnapshot` attaches them to the right person, then the whole snapshot is
 * rebuilt so counts, per-character `artifacts` and every score stay consistent.
 */
export function mergeShowcase(snapshot, showcase, { elapsedMs = 0 } = {}) {
  if (!snapshot || !showcase || !Array.isArray(showcase.builds) || !showcase.builds.length) {
    return snapshot
  }

  const characters = (snapshot.characters || []).map((character) => ({ ...character }))
  const byId = new Map(characters.map((character) => [String(character.id), character]))
  const artifacts = [...(snapshot.artifacts || [])]
  const covered = []

  for (const build of showcase.builds) {
    const character = byId.get(String(build.avatarId))
    // Showcase characters the calculator did not list are skipped rather than
    // invented: the roster is the authority on who the account owns.
    if (!character) continue
    let added = 0
    for (const artifact of build.artifacts) {
      artifacts.push({ ...artifact, location: character.key })
      added += 1
    }
    if (added) {
      character.showcase = true
      character.artifactCount = added
      covered.push(`${character.name}（${added} 件）`)
    }
    // The calculator's weapon has refinement from the API; only fill a gap.
    if (!character.equippedWeapon && build.weapon) character.equippedWeapon = build.weapon
  }

  if (!covered.length) return snapshot

  const note =
    `${snapshot.note || ''} · 展柜补充了 ${covered.length} 个角色的圣遗物副词条：${covered.join('、')}` +
    (showcase.host ? `（数据源 ${showcase.host}）` : '')

  return buildSnapshot({
    source: snapshot.source,
    uid: snapshot.uid,
    player: snapshot.player,
    characters,
    weapons: snapshot.weapons || [],
    artifacts,
    challenges: snapshot.challenges || null,
    note,
    elapsedMs,
  })
}
