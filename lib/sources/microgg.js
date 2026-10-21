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
import { nameOfHash } from '../dict.js'
import { buildSnapshot, makeArtifact, makeWeapon, statLine } from '../model.js'
import { statKeyOfProp } from '../stats.js'

/**
 * CN first, then the international host as a fallback (a 5-开头 UID on 世界树
 * occasionally serves from Enka directly).
 */
const HOSTS = [
  { key: 'microgg', base: 'http://profile.microgg.cn' },
  { key: 'enka', base: 'https://enka.network' },
]

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
function artifactFrom(item, { location, base }) {
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
    icon: iconName ? `${base}/ui/${iconName}.png` : '',
    // Enka has no piece name; the set + slot is what the UI shows anyway.
    pieceName: '',
  })
}

function weaponFrom(item, { location, base }) {
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
    icon: iconName ? `${base}/ui/${iconName}.png` : '',
  })
  if (name && built && built.name === String(flat.nameTextMapHash)) built.name = name
  return built
}

/**
 * Read one account's showcase. Never throws: a missing showcase is a normal
 * state, so the caller gets `ok: false` plus a human-readable reason.
 */
export async function fetchShowcase(uid, { timeoutMs = 15000 } = {}) {
  const target = String(uid || '').trim()
  if (!/^\d{9}$/.test(target)) {
    return { ok: false, uid: target, builds: [], note: 'UID 不是 9 位数字，无法查询展柜' }
  }

  let lastError = ''
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host.base}/api/uid/${target}`, {
        headers: { referer: 'https://enka.network/', 'user-agent': 'dsh-genshin-account' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        lastError = `${host.key} HTTP ${res.status}`
        continue
      }
      const data = await res.json()
      const player = data.playerInfo || {}
      const list = Array.isArray(data.avatarInfoList) ? data.avatarInfoList : []

      const builds = list.map((avatar) => {
        const avatarId = String(avatar.avatarId || '')
        const level = toNumber(avatar.propMap && avatar.propMap[PROP_LEVEL] && avatar.propMap[PROP_LEVEL].val)
        const artifacts = []
        let weapon = null
        for (const item of Array.isArray(avatar.equipList) ? avatar.equipList : []) {
          if (item.reliquary) artifacts.push(artifactFrom(item, { location: avatarId, base: host.base }))
          else if (item.weapon) weapon = weaponFrom(item, { location: avatarId, base: host.base })
        }
        return { avatarId, level, artifacts, weapon }
      })

      return {
        ok: true,
        uid: target,
        host: host.key,
        player: {
          nickname: player.nickname || '',
          level: toNumber(player.level),
          worldLevel: player.worldLevel == null ? undefined : toNumber(player.worldLevel),
          signature: player.signature || '',
          achievements: player.finishAchievementNum == null ? undefined : toNumber(player.finishAchievementNum),
        },
        builds,
        note: builds.length
          ? `展柜 ${builds.length} 个角色来自 ${host.key}（含圣遗物主副词条）`
          : '展柜是空的：游戏内 资料 → 角色展柜，放上角色并开启「显示详情」，等 5 分钟再同步',
      }
    } catch (error) {
      lastError = `${host.key} ${(error && error.message) || error}`
    }
  }
  return { ok: false, uid: target, builds: [], note: `展柜读取失败：${lastError}` }
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
