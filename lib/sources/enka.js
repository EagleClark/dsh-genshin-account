/**
 * Enka.Network source — a public UID lookup of the in-game **character
 * showcase** (角色展柜).
 *
 * Endpoint: `GET {base}/api/uid/{uid}`
 *  - `playerInfo` carries nickname / level / world level / achievements.
 *  - `avatarInfoList` carries every showcased character with its equipped
 *    weapon and five artifacts, already joined against Enka's own game-data
 *    store, so `flat.nameTextMapHash` resolves through `data/names-zh.json`.
 *
 * Limits that matter to the user:
 * - Only 国际服 UIDs work (Asia / America / Europe / TW-HK-MO). A 国服 UID
 *   starting with 1/2/5 is not served by Enka.
 * - Only the characters placed on the showcase are visible.
 * - The endpoint is cached server-side and answers HTTP 424/429 when asked too
 *   often, so the snapshot is cached here too.
 *
 * `enkaBase` exists because enka.network is not reachable from every network
 * (mainland China in particular); it can point at a mirror or a self-hosted
 * reverse proxy instead.
 */
import { nameOfHash, skillOrderOf } from '../dict.js'
import { buildSnapshot, characterRef, makeArtifact, makeWeapon, setRef, statLine, weaponRef } from '../model.js'
import { slotOfEquip, statKeyOfProp } from '../stats.js'

export const id = 'enka'
export const label = 'Enka.Network 展柜'

const DEFAULT_BASE = 'https://enka.network'

/** FightPropType ids Enka returns in `fightPropMap` → canonical stat keys. */
const FIGHT_PROPS = {
  1: 'hp', // base
  4: 'atk',
  7: 'def',
  20: 'critRate_',
  22: 'critDMG_',
  23: 'enerRech_',
  28: 'eleMas',
  2000: 'hp',
  2001: 'atk',
  2002: 'def',
}
/** FightProp ids that are values, not percentages (`critRate_` = 0.59 means 59%). */
const FRACTION_PROPS = new Set(['20', '22', '23', '30'])

function percentize(key, raw) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  // Enka reports fraction-style bonuses; guard so a 0-100 value is not scaled twice.
  if (FRACTION_PROPS.has(String(key)) || (n > 0 && n <= 1.5)) return n * 100
  return n
}

function lookupByIcon(icon) {
  // `UI_RelicIcon_15006_4` → set id 15006 (relic icon, not the goblet's 5th slot).
  const match = /UI_RelicIcon_(\d+)_/.exec(String(icon || ''))
  return match ? match[1] : ''
}

function talentMap(skillLevelMap, avatarId) {
  const levels = skillLevelMap || {}
  // The authoritative A/E/Q order per avatar; skill ids are not assigned in
  // order (Ayaka's normal attack id is larger than her burst id).
  const order = skillOrderOf(avatarId)
  if (order) {
    const [auto = 0, skill = 0, burst = 0] = order.map((skillId) => Number(levels[skillId]) || 0)
    return { auto, skill, burst }
  }
  // Unknown avatar (newer than the shipped table): fall back to ascending ids.
  const entries = Object.entries(levels)
    .map(([skillId, level]) => [Number(skillId), Number(level)])
    .filter(([skillId, level]) => Number.isFinite(skillId) && Number.isFinite(level))
    .sort((a, b) => a[0] - b[0])
  const [auto = 0, skill = 0, burst = 0] = entries.map(([, level]) => level)
  return { auto, skill, burst }
}

function readStats(fightPropMap) {
  const out = {}
  for (const [rawId, rawValue] of Object.entries(fightPropMap || {})) {
    const statKey = FIGHT_PROPS[rawId]
    if (!statKey) continue
    const value = percentize(rawId, rawValue)
    if (value == null) continue
    out[statKey] = Math.round(value * 10) / 10
  }
  return Object.keys(out).length ? out : null
}

function flattenEquip(equipList, location) {
  const weapons = []
  const artifacts = []
  for (const equip of equipList || []) {
    if (!equip || typeof equip !== 'object') continue
    const flat = equip.flat || {}
    if (equip.weapon) {
      const resolved = weaponRef(equip.itemId)
      const name = flat.nameTextMapHash ? nameOfHash(flat.nameTextMapHash) : ''
      weapons.push(
        makeWeapon(resolved.id || equip.itemId, {
          level: equip.weapon.level,
          refinement: refinementOf(equip.weapon, equip.itemId),
          location,
        }),
      )
      if (name) weapons[weapons.length - 1].name = name
      continue
    }
    if (equip.reliquary) {
      const setId = lookupByIcon(flat.icon)
      const set = setId ? setRef(setId) : null
      const mainProp = flat.reliquaryMainstat
      const mainKey = mainProp ? statKeyOfProp(mainProp.mainPropId) : ''
      const subs = (flat.reliquarySubstats || [])
        .map((sub) => statLine(statKeyOfProp(sub.appendPropId), sub.statValue))
        .filter((line) => line.key)
      artifacts.push(
        makeArtifact({
          setKey: set ? set.id : flat.setNameTextMapHash ? nameOfHash(flat.setNameTextMapHash) : '',
          slot: slotOfEquip(flat.equipType) || slotFromIcon(flat.icon),
          rarity: flat.rankLevel || equip.reliquary.rankLevel,
          level: equip.reliquary.level,
          main: mainKey ? statLine(mainKey, mainProp.statValue) : null,
          subs,
          location,
        }),
      )
    }
  }
  return { weapons, artifacts }
}

function refinementOf(weaponInfo, itemId) {
  const affixMap = weaponInfo && weaponInfo.affixMap
  if (!affixMap) return null
  const first = Object.values(affixMap)[0]
  const value = Number(first)
  // affixMap stores 0-based refinement (0 = R1).
  return Number.isFinite(value) ? Math.min(5, Math.round(value) + 1) : null
}

function slotFromIcon(icon) {
  // `UI_RelicIcon_15006_4` → the trailing digit is the slot (1..5).
  const match = /_(\d+)$/.exec(String(icon || ''))
  const index = match ? Number(match[1]) : 0
  return ['flower', 'plume', 'sands', 'goblet', 'circlet'][index - 1] || ''
}

export async function fetchSnapshot(config) {
  const uid = String((config && config.enkaUid) || '').trim()
  if (!/^\d{5,12}$/.test(uid)) {
    throw new Error('请在插件设置里填写一个有效的国际服 UID（纯数字）。Enka 不支持国服 UID（1/2/5 开头）。')
  }
  const base = String((config && config.enkaBase) || DEFAULT_BASE).trim().replace(/\/+$/, '') || DEFAULT_BASE
  const url = `${base}/api/uid/${uid}`
  let res
  try {
    res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'dsh-genshin-account/1.0' } })
  } catch (error) {
    throw new Error(
      `连接 Enka 失败：${error && error.message ? error.message : String(error)}。` +
        `如果本机访问不了 enka.network（国内网络常见），可以改用「本地 GOOD 文件」或「米游社」数据源，` +
        `或者把「Enka 接口地址」改成你自建/可达的镜像。`,
    )
  }
  if (!res.ok) {
    const hint =
      res.status === 400
        ? 'UID 格式不正确。'
        : res.status === 404
          ? '这个 UID 不存在，或者角色展柜没有公开。'
          : res.status === 424 || res.status === 429
            ? 'Enka 的每 UID 缓存还没过期，请等 60 秒再同步。'
            : res.status === 500
              ? 'Enka 服务端内部错误。'
              : `HTTP ${res.status}`
    throw new Error(`Enka 返回 ${res.status}：${hint}`)
  }
  return parsePayload(await res.json(), { uid, base })
}

/** Pure half: turn one Enka response body into a snapshot (used by the tests). */
export function parsePayload(payload, { uid = '', base = DEFAULT_BASE } = {}) {
  const started = Date.now()
  const playerInfo = (payload && payload.playerInfo) || {}
  const avatars = Array.isArray(payload && payload.avatarInfoList) ? payload.avatarInfoList : []
  if (avatars.length === 0) {
    throw new Error(
      'Enka 没有返回任何角色详情。通常是「角色展柜」没有公开：在游戏里打开 派蒙菜单 → 角色 → 展柜设置，把想展示的角色放上展柜并设为公开。',
    )
  }

  const weapons = []
  const artifacts = []
  const characters = avatars.map((avatar) => {
    const ref = characterRef(avatar.avatarId)
    const level = avatar.propMap && avatar.propMap['4001'] ? Number(avatar.propMap['4001'].ival) : 0
    const location = ref.id || String(avatar.avatarId)
    const equipped = flattenEquip(avatar.equipList, location)
    weapons.push(...equipped.weapons)
    artifacts.push(...equipped.artifacts)
    return {
      id: String(avatar.avatarId),
      key: ref.key || ref.id,
      name: ref.name,
      element: ref.element,
      weaponType: ref.weapon,
      rarity: ref.rarity,
      level,
      constellation: Array.isArray(avatar.talentIdList) ? avatar.talentIdList.length : 0,
      talents: talentMap(avatar.skillLevelMap, avatar.avatarId),
      stats: readStats(avatar.fightPropMap),
      equippedWeapon: equipped.weapons[0] || null,
    }
  })

  return buildSnapshot({
    source: id,
    uid,
    player: {
      nickname: playerInfo.nickname,
      level: playerInfo.level,
      worldLevel: playerInfo.worldLevel,
      signature: playerInfo.signature,
      region: regionOfUid(uid),
    },
    characters,
    weapons,
    artifacts,
    note: `Enka · ${base} · 仅角色展柜（最多 8 个角色）`,
    elapsedMs: Date.now() - started,
  })
}

/** The first UID digit encodes the shard, which is useful in the UI header. */
export function regionOfUid(uid) {
  const first = String(uid || '')[0]
  return { 1: '国服 · 天空岛', 2: '国服 · 天空岛', 5: '国服 · 世界树', 6: '美服', 7: '欧服', 8: '亚服', 9: '台港澳服' }[first] || ''
}
