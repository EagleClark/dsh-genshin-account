/**
 * The canonical snapshot every data source produces, plus the query layer that
 * both the agent tools and the HTTP routes read.
 *
 * A source only has to emit *ids* and *numbers*; this module resolves names,
 * elements, slots and scores from the shipped dictionary, so a GOOD file, an
 * Enka response and a miHoYo response all end up as the same shape:
 *
 *   { source, uid, fetchedAt, player, characters[], weapons[], artifacts[] }
 *
 * `characters[].weapon` and `characters[].artifacts` are the equipped build;
 * `snapshot.weapons` / `snapshot.artifacts` are everything the source knows
 * about (a GOOD file has the whole inventory, a showcase API only has the
 * equipped pieces of the showcased characters).
 */
import {
  artifactSetById,
  artifactSetIdOfAlias,
  artifactSetName,
  characterById,
  characterIdOfAlias,
  dictionary,
  normalize,
  weaponById,
  weaponIdOfAlias,
  weaponName,
  findCharacters,
} from './dict.js'
import { SLOTS, SLOT_ORDER, STATS, elementZh, formatStat, slotOfEquip, statKeyOfProp, weaponTypeZh } from './stats.js'
import { scoreArtifact } from './score.js'

const num = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Resolve a character id or GOOD key into `{ id, key, name, element, ... }`. */
export function characterRef(idOrKey, nameHint) {
  const byId = characterById(idOrKey)
  if (byId) return { id: String(idOrKey), key: idOrKey, ...byId }
  const resolved = characterIdOfAlias(idOrKey)
  if (resolved) return { id: resolved, key: String(idOrKey), ...characterById(resolved) }
  return {
    id: String(idOrKey || ''),
    key: String(idOrKey || ''),
    name: nameHint || String(idOrKey || '未知角色'),
    en: '',
    element: 'none',
    weapon: 'other',
    rarity: 0,
  }
}

export function weaponRef(idOrKey) {
  const byId = weaponById(idOrKey)
  if (byId) return { id: String(idOrKey), key: idOrKey, ...byId }
  const resolved = weaponIdOfAlias(idOrKey)
  if (resolved) return { id: resolved, key: String(idOrKey), ...weaponById(resolved) }
  return { id: String(idOrKey || ''), key: String(idOrKey || ''), name: String(idOrKey || '未知武器'), en: '', type: 'other', rarity: 0 }
}

export function setRef(idOrKey) {
  const byId = artifactSetById(idOrKey)
  if (byId) return { id: String(idOrKey), key: idOrKey, ...byId }
  const resolved = artifactSetIdOfAlias(idOrKey)
  if (resolved) return { id: resolved, key: String(idOrKey), ...artifactSetById(resolved) }
  // Last resort: a Chinese display name (e.g. recovered from a name hash).
  for (const [id, set] of Object.entries(dictionary.artifactSets)) {
    if (set.name === idOrKey) return { id, key: id, ...set }
  }
  return { id: String(idOrKey || ''), key: String(idOrKey || ''), name: String(idOrKey || '未知套装'), en: '', two: '', four: '' }
}

/** One stat line in display form. `value` stays numeric for further maths. */
export function statLine(key, value) {
  const meta = STATS[key]
  const n = num(value)
  return {
    key,
    label: meta ? meta.zh : key,
    value: n,
    percent: meta ? meta.percent : false,
    text: formatStat(key, n),
  }
}

export function makeWeapon(idOrKey, { level, refinement, location, icon } = {}) {
  const base = weaponRef(idOrKey)
  return {
    id: base.id,
    key: base.key,
    name: base.name,
    en: base.en || '',
    rarity: base.rarity || 0,
    type: base.type || 'other',
    typeZh: weaponTypeZh(base.type),
    level: num(level),
    refinement: refinement == null ? null : num(refinement),
    location: location || '',
    // Official art on the miHoYo CDN, when the source hands one over.
    icon: icon || '',
  }
}

export function makeArtifact({ setKey, slot, rarity, level, main, subs, location, icon, pieceName } = {}) {
  const base = setRef(setKey)
  const slotKey = SLOT_ORDER.includes(slot) ? slot : slotOfEquip(slot) || SLOT_ORDER[0]
  const item = {
    setKey: base.key,
    setId: base.id,
    setName: base.name,
    setEn: base.en || '',
    slot: slotKey,
    slotZh: SLOTS[slotKey].zh,
    rarity: num(rarity, 5),
    level: num(level),
    main: main || null,
    subs: Array.isArray(subs) ? subs.filter(Boolean) : [],
    location: location || '',
    icon: icon || '',
    // The calculator path knows a piece's own name but not which set it is from.
    pieceName: pieceName || '',
  }
  item.score = scoreArtifact(item)
  return item
}

/** Assemble the final snapshot: attach the equipped build to each character. */
export function buildSnapshot({ source, uid = '', player = {}, characters = [], weapons = [], artifacts = [], challenges = null, note = '', elapsedMs = 0 }) {
  // `location` is whatever the source uses to say "this belongs to X": GOOD uses
  // a character key (`HuTao`), the record API uses the character name, and the
  // calculator path uses the numeric id. So each character is registered under
  // all three, and a location matches whichever alias it happens to hit.
  const artifactsByLocation = new Map()
  for (const artifact of artifacts) {
    const key = normalize(artifact.location)
    if (!key) continue
    if (!artifactsByLocation.has(key)) artifactsByLocation.set(key, [])
    artifactsByLocation.get(key).push(artifact)
  }
  const weaponsByLocation = new Map()
  for (const weapon of weapons) {
    const key = normalize(weapon.location)
    if (key) weaponsByLocation.set(key, weapon)
  }

  // Deduplicated: a character whose key IS its id would otherwise match the same
  // location twice and duplicate every equipped item.
  const aliasesOf = (character) => [
    ...new Set([character.key, character.id, character.name].map((value) => normalize(value)).filter(Boolean)),
  ]

  const full = characters.map((character) => {
    const aliases = aliasesOf(character)
    const key = aliases[0] || ''
    const equipped = aliases
      .flatMap((alias) => artifactsByLocation.get(alias) || [])
      .slice()
      .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
    // `weaponType` is the dictionary's type id; `equipped` is the weapon object.
    const equippedWeapon = aliases.map((alias) => weaponsByLocation.get(alias)).find(Boolean) || character.equippedWeapon || null
    return {
      ...character,
      element: character.element || 'none',
      elementZh: elementZh(character.element),
      weaponType: character.weaponType || 'other',
      weaponTypeZh: weaponTypeZh(character.weaponType),
      equippedWeapon,
      artifacts: equipped,
    }
  })

  const byElement = {}
  for (const character of full) byElement[character.element] = (byElement[character.element] || 0) + 1

  return {
    source,
    uid: String(uid || ''),
    fetchedAt: Date.now(),
    elapsedMs,
    note,
    player: {
      nickname: player.nickname || '',
      level: num(player.level),
      worldLevel: player.worldLevel == null ? null : num(player.worldLevel),
      signature: player.signature || '',
      region: player.region || '',
      // Not every source knows these; keep them undefined when absent.
      activeDays: player.activeDays == null ? undefined : String(player.activeDays),
      achievements: player.achievements == null ? undefined : String(player.achievements),
    },
    // Challenge progress (幻想真境剧诗 / 幽境危战 / 深境螺旋) lives beside the
    // player rather than inside it: it is per-schedule, not per-account.
    challenges: challenges || null,
    characters: full,
    weapons,
    artifacts,
    counts: {
      characters: full.length,
      weapons: weapons.length,
      artifacts: artifacts.length,
      byElement,
    },
  }
}

// --- queries -------------------------------------------------------------

export function overview(snapshot) {
  const counts = snapshot.counts || { characters: 0, weapons: 0, artifacts: 0, byElement: {} }
  const fiveStarArtifacts = (snapshot.artifacts || []).filter((a) => a.rarity >= 5).length
  const bestArtifact = (snapshot.artifacts || []).slice().sort((a, b) => b.score.cv - a.score.cv)[0] || null
  return {
    source: snapshot.source,
    uid: snapshot.uid,
    player: snapshot.player,
    challenges: snapshot.challenges || null,
    fetchedAt: snapshot.fetchedAt,
    note: snapshot.note || '',
    counts: {
      characters: counts.characters,
      weapons: counts.weapons,
      artifacts: counts.artifacts,
      fiveStarArtifacts,
      byElement: counts.byElement,
    },
    elements: Object.fromEntries(Object.entries(counts.byElement || {}).map(([k, v]) => [elementZh(k), v])),
    bestArtifact: bestArtifact ? artifactRef(bestArtifact) : null,
  }
}

function artifactRef(artifact) {
  return {
    setName: artifact.setName,
    slotZh: artifact.slotZh,
    cv: artifact.score.cv,
    efficiency: artifact.score.efficiency,
    owner: artifact.location ? characterNameOf(artifact.location) : '',
  }
}

function characterNameOf(key) {
  const raw = String(key == null ? '' : key)
  // Enka / miHoYo report a numeric avatar id; GOOD reports a `HuTao` style key.
  const direct = characterById(raw)
  if (direct) return direct.name
  const resolved = characterIdOfAlias(raw)
  return resolved ? characterById(resolved).name : raw
}

export function listCharacters(snapshot, { element, weapon, minLevel, sort = 'level' } = {}) {
  let rows = (snapshot.characters || []).slice()
  if (element) rows = rows.filter((c) => c.element === normalizeElement(element))
  if (weapon) rows = rows.filter((c) => c.weaponType === normalizeWeapon(weapon))
  if (minLevel) rows = rows.filter((c) => c.level >= num(minLevel))
  const by = {
    level: (a, b) => b.level - a.level || b.rarity - a.rarity || a.name.localeCompare(b.name, 'zh'),
    rarity: (a, b) => b.rarity - a.rarity || b.level - a.level || a.name.localeCompare(b.name, 'zh'),
    name: (a, b) => a.name.localeCompare(b.name, 'zh'),
    cv: (a, b) => artifactCv(b) - artifactCv(a),
  }
  rows.sort(by[sort] || by.level)
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon || '',
    element: c.element,
    elementZh: c.elementZh,
    weaponType: c.weaponType,
    weaponTypeZh: c.weaponTypeZh,
    rarity: c.rarity,
    level: c.level,
    constellation: c.constellation,
    talents: c.talents,
    weaponName: c.equippedWeapon ? c.equippedWeapon.name : '',
    weaponIcon: c.equippedWeapon ? c.equippedWeapon.icon || '' : '',
    artifactCount: (c.artifacts || []).length || (c.equippedPieces || []).length,
    cv: artifactCv(c),
  }))
}

function artifactCv(character) {
  const sum = (character.artifacts || []).reduce((total, artifact) => total + artifact.score.cv, 0)
  return Math.round(sum * 10) / 10
}

const ELEMENT_ALIASES = {
  fire: 'pyro', 火: 'pyro', pyro: 'pyro',
  water: 'hydro', 水: 'hydro', hydro: 'hydro',
  ice: 'cryo', 冰: 'cryo', cryo: 'cryo',
  thunder: 'electro', electric: 'electro', 雷: 'electro', electro: 'electro',
  grass: 'dendro', 草: 'dendro', dendro: 'dendro',
  wind: 'anemo', 风: 'anemo', anemo: 'anemo',
  rock: 'geo', 岩: 'geo', geo: 'geo',
}
export function normalizeElement(value) {
  return ELEMENT_ALIASES[String(value || '').trim().toLowerCase()] || String(value || '').trim().toLowerCase()
}

const WEAPON_ALIASES = {
  单手剑: 'sword', sword: 'sword',
  双手剑: 'claymore', claymore: 'claymore',
  长柄武器: 'polearm', polearm: 'polearm', 长枪: 'polearm',
  弓: 'bow', bow: 'bow',
  法器: 'catalyst', catalyst: 'catalyst',
}
export function normalizeWeapon(value) {
  return WEAPON_ALIASES[String(value || '').trim().toLowerCase()] || String(value || '').trim().toLowerCase()
}

/** One character, matched by id / Chinese name / English name / GOOD key. */
export function getCharacter(snapshot, query) {
  const candidates = findCharacters(query)
  if (!candidates.length) return { error: `没有找到角色「${query}」。可先用 genshin_characters 列出角色名。` }
  // Try every candidate, not just the first: "旅行者" matches both bodies and a
  // GOOD file only carries the one the player actually picked.
  for (const wanted of candidates) {
    const found = (snapshot.characters || []).find((c) => String(c.id) === String(wanted.id))
    if (found) return found
  }
  const first = candidates[0]
  return {
    error: `「${first.name}」不在读取到的账号数据里。角色详情需要先在游戏里公开，否则只有基础信息。`,
  }
}

export function listWeapons(snapshot, { type, rarity, sort = 'rarity', limit = 0, equippedOnly = false } = {}) {
  let rows = (snapshot.weapons || []).slice()
  if (type) rows = rows.filter((w) => w.type === normalizeWeapon(type))
  if (rarity) rows = rows.filter((w) => w.rarity >= num(rarity))
  if (equippedOnly) rows = rows.filter((w) => w.location)
  const by = {
    rarity: (a, b) => b.rarity - a.rarity || b.level - a.level || a.name.localeCompare(b.name, 'zh'),
    level: (a, b) => b.level - a.level || b.rarity - a.rarity,
    name: (a, b) => a.name.localeCompare(b.name, 'zh'),
  }
  rows.sort(by[sort] || by.rarity)
  if (limit > 0) rows = rows.slice(0, limit)
  return rows.map((w) => ({
    name: w.name,
    icon: w.icon || '',
    rarity: w.rarity,
    type: w.type,
    typeZh: w.typeZh,
    level: w.level,
    refinement: w.refinement,
    owner: w.location ? characterNameOf(w.location) : '',
  }))
}

export function listArtifacts(snapshot, { set, slot, owner, minCv = 0, sort = 'cv', limit = 20 } = {}) {
  let rows = (snapshot.artifacts || []).slice()
  if (set) {
    const wanted = setRef(set)
    rows = rows.filter((a) => a.setId === wanted.id || normalize(a.setKey) === normalize(set))
  }
  if (slot) rows = rows.filter((a) => a.slot === normalize(slot) || a.slotZh === slot)
  if (owner) {
    const character = getCharacter(snapshot, owner)
    if (character.error) return { error: character.error }
    rows = rows.filter((a) => normalize(a.location) === normalize(character.key || character.id))
  }
  rows = rows.filter((a) => a.score.cv >= num(minCv))
  const by = {
    cv: (a, b) => b.score.cv - a.score.cv,
    efficiency: (a, b) => b.score.efficiency - a.score.efficiency,
    level: (a, b) => b.level - a.level,
    set: (a, b) => a.setName.localeCompare(b.setName, 'zh') || a.slot.localeCompare(b.slot),
  }
  rows.sort(by[sort] || by.cv)
  if (limit > 0) rows = rows.slice(0, limit)
  return rows.map(publicArtifact)
}

export function publicArtifact(a) {
  // `icon` and `pieceName` are display-only extras some sources provide.
  return {
    setName: a.setName,
    slotZh: a.slotZh,
    rarity: a.rarity,
    level: a.level,
    main: a.main ? a.main.text + ' ' + a.main.label : '',
    subs: (a.subs || []).map((s) => s.text + ' ' + s.label),
    cv: a.score.cv,
    efficiency: a.score.efficiency,
    grade: a.score.grade,
    icon: a.icon || '',
    pieceName: a.pieceName || '',
    owner: a.location ? characterNameOf(a.location) : '',
  }
}

/** Group a character's five equipped pieces into the set-count summary. */
export function setSummary(artifacts) {
  const counts = new Map()
  for (const artifact of artifacts || []) {
    const key = artifact.setKey
    const entry = counts.get(key) || { setName: artifact.setName, count: 0, setId: artifact.setId }
    entry.count += 1
    counts.set(key, entry)
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)
}

/** Set effects that a build actually activates (2pc at 2, 4pc at 4). */
export function activeSetEffects(artifacts) {
  const out = []
  for (const group of setSummary(artifacts)) {
    const set = artifactSetById(group.setId)
    if (!set) continue
    if (group.count >= 2 && set.two) out.push(`${group.setName} 2件套：${set.two}`)
    if (group.count >= 4 && set.four) out.push(`${group.setName} 4件套：${set.four}`)
  }
  return out
}

export { weaponName, artifactSetName, statKeyOfProp }
