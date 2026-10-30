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
    // 官方 CDN 对没收录的图标会回一张 1200×1200 的占位图（HTTP 200），
    // 客户端识别到尺寸不对就换成 Enka 的同名资源。
    iconAlt: iconName ? `https://enka.network/ui/${iconName}.png` : '',
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
    return { avatarId, level, artifacts, weapon, stats: statsFromFightProp(avatar.fightPropMap) }
  })
  return {
    player: {
      nickname: player.nickname || '',
      level: toNumber(player.level),
      worldLevel: player.worldLevel == null ? undefined : toNumber(player.worldLevel),
      signature: player.signature || '',
      achievements: player.finishAchievementNum == null ? undefined : toNumber(player.finishAchievementNum),
      // Account-level progress the payload reports. All optional.
      abyss: player.towerFloorIndex
        ? {
            floor: toNumber(player.towerFloorIndex),
            chamber: toNumber(player.towerLevelIndex),
            stars: toNumber(player.towerStarIndex),
          }
        : null,
      theater: player.theaterActIndex
        ? { act: toNumber(player.theaterActIndex), stars: toNumber(player.theaterStarIndex), mode: toNumber(player.theaterModeIndex) }
        : null,
      stygian: player.stygianIndex
        ? { difficulty: toNumber(player.stygianIndex), seconds: toNumber(player.stygianSeconds) }
        : null,
      fetterCount: player.fetterCount == null ? undefined : toNumber(player.fetterCount),
    },
    builds,
    // A payload without `avatarInfoList` only proves *which* characters are in
    // the showcase, not what they wear; the caller retries instead of accepting it.
    degraded: list.length === 0 && Array.isArray(data.showAvatarInfoList) && data.showAvatarInfoList.length > 0,
  }
}

/**
 * The character panel, straight from the payload's `fightPropMap`.
 *
 * The game reports 42 computed props per avatar; these are the ones the panel
 * shows. Percent stats come back as fractions (0.5399 = 53.99%), base and final
 * HP/ATK/DEF come back as absolute numbers.
 */
function statsFromFightProp(props) {
  if (!props || typeof props !== 'object') return null
  const raw = (key) => {
    const value = Number(props[key])
    return Number.isFinite(value) ? value : 0
  }
  const pct = (key) => Math.round(raw(key) * 1000) / 10
  const int = (key) => Math.round(raw(key))
  // 2000/2001/2002 are the final panel values, 1/4/7 the character's own base.
  const has = props[2000] != null || props[20] != null
  if (!has) return null
  return {
    hp: int(2000),
    atk: int(2001),
    def: int(2002),
    base: { hp: int(1), atk: int(4), def: int(7) },
    critRate_: pct(20),
    critDMG_: pct(22),
    enerRech_: pct(23),
    heal_: pct(26),
    eleMas: int(28),
    // Element DMG bonus sits in 40..46 (fire, electro, water, grass, wind, ice, rock).
    dmg: {
      pyro: pct(40), electro: pct(41), hydro: pct(42), dendro: pct(43),
      anemo: pct(44), cryo: pct(45), geo: pct(46),
    },
    physical_: pct(29),
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
        if (cacheFile && Array.isArray(data.avatarInfoList) && data.avatarInfoList.length) {
          try {
            mkdirSync(dirname(cacheFile), { recursive: true })
            writeFileSync(cacheFile, JSON.stringify(data), 'utf8')
          } catch {
            /* a cache write is best effort */
          }
        }
        const mapped = mapPayload(data)
        if (mapped.degraded) {
          // Profile-only answer: the mirror knew the showcase ids but not the
          // builds. Keep whatever cache we already have and try again.
          lastError = `${host.key} 返回了不含装备的精简数据`
          if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1200))
          continue
        }
        if (!mapped.builds.length && cacheFile) {
          // A transient empty answer from the mirror looks exactly like a user
          // clearing the showcase. The cache tells them apart.
          try {
            const cached = mapPayload(JSON.parse(readFileSync(cacheFile, 'utf8')))
            if (cached.builds.length) {
              return {
                ok: true,
                uid: target,
                host: 'cache',
                player: mapped.player,
                builds: cached.builds,
                note: `展柜 ${cached.builds.length} 个角色来自上次缓存（${host.key} 这次返回了空展柜）`,
              }
            }
          } catch {
            /* no usable cache */
          }
        }
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
  const weapons = (snapshot.weapons || []).map((weapon) => ({ ...weapon }))
  const normalize = (value) => String(value == null ? '' : value).trim().toLowerCase()
  const weaponByLocation = new Map()
  for (const weapon of weapons) {
    const key = normalize(weapon.location)
    if (key) weaponByLocation.set(key, weapon)
  }
  // The showcase payload also reports account-level progress; fill in whatever
  // the calculator path could not know (it has no access to these fields).
  const player = { ...(snapshot.player || {}) }
  const account = showcase.player || {}
  if (!player.achievements && account.achievements) player.achievements = String(account.achievements)
  if (account.abyss) player.abyss = account.abyss
  if (account.theater) player.theater = account.theater
  if (account.stygian) player.stygian = account.stygian
  if (account.fetterCount) player.fetterCount = account.fetterCount
  const byId = new Map(characters.map((character) => [String(character.id), character]))
  // 这次没出现在展柜里的角色：摘掉展柜标记与面板数值。
  // 否则移出展柜后统计里的「展柜 N 个」永远降不下来，面板也还是旧的。
  const inShowcase = new Set(showcase.builds.map((build) => String(build.avatarId)))
  for (const character of characters) {
    if (inShowcase.has(String(character.id))) continue
    if (character.showcase) character.showcase = false
    if (character.stats) delete character.stats
  }
  // 展柜给的圣遗物也只保留这次仍在展柜里的角色的。
  const artifacts = (snapshot.artifacts || []).filter((artifact) => {
    const owner = characters.find((character) => character.key === artifact.location)
    return !owner || inShowcase.has(String(owner.id))
  })
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
    // The calculator's sync endpoint still caps characters at 90; the showcase
    // payload carries the real level (the game allows beyond 90 now), so it wins.
    if (build.level && build.level !== character.level) {
      character.level = build.level
      character.levelFromShowcase = true
    }
    // 这个角色此刻就在展柜里，等级是新鲜的，不是历史记录。
    if (build.level) character.levelHintOnly = false
    // Real panel values (HP/ATK/DEF, crit, ER, EM, element bonus) only exist for
    // showcase characters — the calculator API never returns them.
    if (build.stats) character.stats = build.stats
    if (added) {
      character.showcase = true
      character.artifactCount = added
      covered.push(`${character.name}（${added} 件）`)
    }
    // Refinement only exists in the showcase payload: copy it onto the weapon the
    // character actually holds (matched by any of its aliases).
    if (build.weapon) {
      const aliases = [character.key, character.id, character.name]
        .map((value) => normalize(value))
        .filter(Boolean)
      const held = aliases.map((alias) => weaponByLocation.get(alias)).find(Boolean)
      if (held) {
        if (build.weapon.refinement) held.refinement = build.weapon.refinement
        if (build.weapon.level && !held.level) held.level = build.weapon.level
        if (!held.icon && build.weapon.icon) held.icon = build.weapon.icon
      }
      if (!character.equippedWeapon) character.equippedWeapon = build.weapon
    }
  }

  if (!covered.length) return snapshot

  const note =
    `${snapshot.note || ''} · 展柜补充了 ${covered.length} 个角色的圣遗物副词条：${covered.join('、')}` +
    (showcase.host ? `（数据源 ${showcase.host}）` : '')

  return buildSnapshot({
    source: snapshot.source,
    uid: snapshot.uid,
    player,
    characters,
    weapons,
    artifacts,
    challenges: snapshot.challenges || null,
    note,
    elapsedMs,
  })
}
