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
  weaponDetailById,
  weaponIdOfAlias,
  weaponName,
  findCharacters,
} from './dict.js'
import { SLOTS, SLOT_ORDER, STATS, elementZh, formatStat, slotOfEquip, statKeyOfProp, weaponTypeZh } from './stats.js'
import { cvGradeOf, scoreArtifact, scoreBuild, totalCvGradeOf } from './score.js'
import { solveRolls } from './rolls.js'
import { hasTableWeights, pieceGradeOf, scorePiece, totalGradeOf, weightsFor } from './roles.js'

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

/**
 * 官方 CDN 对没收录的图标会回 1200×1200 占位图（HTTP 200），
 * 用同名文件在 Enka 上的地址兜底。旧快照里没有 iconAlt，这里按 URL 现推。
 */
export function iconAltOf(icon) {
  if (!icon) return ''
  const name = String(icon).split('/').pop()
  return name ? `https://enka.network/ui/${name}` : ''
}

export function makeArtifact({ setKey, slot, rarity, level, main, subs, location, icon, iconAlt, pieceName } = {}) {
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
    iconAlt: iconAlt || iconAltOf(icon),
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
      // Progress the showcase payload reports per account (see microgg.js):
      // 深境螺旋 / 幻想真境剧诗 / 幽境危战 / 好感角色数.
      abyss: player.abyss || null,
      theater: player.theater || null,
      stygian: player.stygian || null,
      fetterCount: player.fetterCount == null ? undefined : num(player.fetterCount),
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


/**
 * Rebuild a snapshot that keeps the previous round's showcase-derived data.
 *
 * The calculator path knows the roster but nothing about artifacts, panel stats
 * or account progress (achievements / abyss / theater / stygian) — those only
 * come from the in-game showcase. When the community mirror times out or answers
 * 424, rebuilding from the calculator alone silently deleted all of it. Carrying
 * the previous values forward keeps the panel honest (the note says so) and lets
 * the next successful read refresh them.
 */

/**
 * Recompute every artifact's CV / efficiency on an already-built snapshot.
 *
 * Artifacts persist their `score` with the snapshot, so a change to the scoring
 * rules would otherwise only apply after the next successful sync — and the sync
 * needs the community mirror. Recomputing on read keeps the rules and the numbers
 * in step without a network round-trip.
 */
export function rescoreSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  const seen = new Set()
  const rescore = (artifact) => {
    if (!artifact || seen.has(artifact) || !Array.isArray(artifact.subs)) return
    seen.add(artifact)
    // The circlet main stat participates, so it has to be passed in.
    artifact.score = scoreArtifact(artifact)
  }
  for (const artifact of snapshot.artifacts || []) rescore(artifact)
  // A JSON round-trip duplicates the equipped pieces into each character, so the
  // snapshot list alone would leave the character page reading stale scores.
  for (const character of snapshot.characters || []) {
    for (const artifact of character.artifacts || []) rescore(artifact)
  }
  return snapshot
}

/**
 * 展柜报过的真实等级。
 *
 * 养成计算器的 sync 接口把角色等级封顶在 90，游戏内已经能超过；展柜 payload
 * 带的是真实等级。角色一旦移出展柜，计算器又会把它报回 90，等级就"掉"了。
 * 所以把展柜报过的等级记下来，逐次取大值复用——等级只会涨，不会降。
 */
export function levelHintsOf(snapshot) {
  const hints = {}
  for (const character of (snapshot && snapshot.characters) || []) {
    if (character && character.levelFromShowcase && character.level) {
      hints[String(character.id)] = Number(character.level)
    }
  }
  return hints
}

/** 把历史展柜等级套回计算结果；只在比计算器报的高时生效。 */
export function applyLevelHints(snapshot, hints) {
  if (!snapshot || !hints) return snapshot
  for (const character of snapshot.characters || []) {
    const hint = Number(hints[String(character.id)] || 0)
    if (!hint || Number(character.level) >= hint) continue
    character.level = hint
    character.levelFromShowcase = true
    // 当前展柜里没有这个角色：等级来自历史记录，界面要能说明这一点。
    character.levelHintOnly = true
  }
  return snapshot
}

export function carryForwardShowcase(previous, next) {
  if (!previous || !next) return null
  if (String(previous.uid || '') !== String(next.uid || '')) return null
  const prevArtifacts = (previous.artifacts || []).filter((artifact) => artifact && artifact.location)
  const progressKeys = ['achievements', 'abyss', 'theater', 'stygian', 'fetterCount', 'activeDays']
  const prevPlayer = previous.player || {}
  const nextPlayer = next.player || {}
  // 回退是为了扛住一次网络抖动，不是为了让旧数据永久生效。
  // 超过一天就不再沿用：宁可空着，也不显示过期的展柜数据。
  const prevAge = Number(next.fetchedAt || Date.now()) - Number(previous.fetchedAt || 0)
  if (!(prevAge >= 0 && prevAge < 24 * 60 * 60 * 1000)) return null
  const carriedProgress = progressKeys.some((key) => nextPlayer[key] == null && prevPlayer[key] != null)
  const carriedArtifacts = (next.artifacts || []).length === 0 && prevArtifacts.length > 0
  if (!carriedProgress && !carriedArtifacts) return null

  const player = { ...nextPlayer }
  for (const key of progressKeys) {
    if (player[key] == null && prevPlayer[key] != null) player[key] = prevPlayer[key]
  }
  const prevById = new Map((previous.characters || []).map((character) => [String(character.id), character]))
  const characters = (next.characters || []).map((character) => {
    const old = prevById.get(String(character.id))
    if (!old) return character
    const merged = { ...character }
    if (old.showcase) merged.showcase = true
    if (old.artifactCount) merged.artifactCount = old.artifactCount
    if (old.stats && !merged.stats) merged.stats = old.stats
    if (old.levelFromShowcase && old.level) {
      merged.level = old.level
      merged.levelFromShowcase = true
    }
    if (old.talents && !merged.talents) merged.talents = old.talents
    return merged
  })
  const artifacts = [...(next.artifacts || []), ...(carriedArtifacts ? prevArtifacts : [])]
  const rebuilt = buildSnapshot({
    source: next.source,
    uid: next.uid,
    player,
    characters,
    weapons: next.weapons || [],
    artifacts,
  })
  rebuilt.fetchedAt = next.fetchedAt
  rebuilt.note = (next.note || '') + ' · 展柜这次没读到，进度与圣遗物沿用上次数据'
  return rebuilt
}

export function overview(snapshot) {
  const counts = snapshot.counts || { characters: 0, weapons: 0, artifacts: 0, byElement: {} }
  const player = snapshot.player || {}
  const challenges = snapshot.challenges || {}
  const card = challenges.card || null
  const matchedCard = card && card.matched ? card : null

  // Element counts keyed by id: the UI maps them to the official element glyphs.
  const elements = Object.entries(counts.byElement || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, zh: elementZh(key), count }))

  // 深境螺旋 / 幻想真境剧诗 come from the showcase payload when it is available;
  // the record card is only trusted when it actually describes this UID.
  const abyss = player.abyss || (matchedCard && matchedCard.abyss ? { text: matchedCard.abyss } : null)
  const theater = player.theater || null
  const stygian = player.stygian || null
  const roleCombat = challenges.roleCombat || null
  const hardChallenge = challenges.hardChallenge || null

  const showcaseCount = (snapshot.characters || []).filter((character) => character.showcase).length

  return {
    source: snapshot.source,
    uid: snapshot.uid,
    player,
    challenges,
    // Normalised progress: one object per activity, with the label the UI shows.
    progress: {
      abyss: abyss
        ? {
            label: '深境螺旋',
            text: abyss.text || (player.abyss && player.abyss.floor ? `${player.abyss.floor}-${player.abyss.chamber || 1}` : ''),
            stars: player.abyss && player.abyss.stars ? player.abyss.stars : null,
          }
        : null,
      theater: {
        label: '幻想真境剧诗',
        act: theater && theater.act ? theater.act : null,
        stars: theater && theater.stars ? theater.stars : roleCombat && roleCombat.medals ? roleCombat.medals : null,
        difficulty: roleCombat && roleCombat.difficulty ? roleCombat.difficulty : null,
        maxRound: roleCombat && roleCombat.maxRound ? roleCombat.maxRound : null,
        end: roleCombat && roleCombat.end ? roleCombat.end : 0,
      },
      stygian: {
        label: '幽境危战',
        name: hardChallenge && hardChallenge.name ? hardChallenge.name : '',
        difficulty: stygian && stygian.difficulty ? stygian.difficulty : hardChallenge && hardChallenge.difficulty ? hardChallenge.difficulty : null,
        seconds: stygian && stygian.seconds ? stygian.seconds : hardChallenge && hardChallenge.seconds ? hardChallenge.seconds : null,
        end: hardChallenge && hardChallenge.end ? hardChallenge.end : 0,
      },
      achievements: player.achievements || (matchedCard && matchedCard.achievements) || '',
      activeDays: player.activeDays || (matchedCard && matchedCard.activeDays) || '',
      fetterCount: player.fetterCount || '',
    },
    fetchedAt: snapshot.fetchedAt,
    note: snapshot.note || '',
    // One line for the panel footer; the long note stays in the agent output.
    noteShort:
      `${snapshot.source === 'miyoushe' ? '米游社' : snapshot.source} · ${counts.characters} 个角色` +
      (showcaseCount ? ` · 展柜 ${showcaseCount} 个（有副词条）` : ''),
    counts: {
      characters: counts.characters,
      weapons: counts.weapons,
      artifacts: counts.artifacts,
      fiveStarArtifacts: (snapshot.artifacts || []).filter((a) => a.rarity >= 5).length,
      showcase: showcaseCount,
      byElement: counts.byElement,
    },
    // Kept as a keyed object for backwards compatibility with the agent tools.
    elements: Object.fromEntries(elements.map((entry) => [entry.zh, entry.count])),
    elementList: elements,
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
    levelHintOnly: Boolean(c.levelHintOnly),
    constellation: c.constellation,
    talents: c.talents,
    weaponName: c.equippedWeapon ? c.equippedWeapon.name : '',
    weaponIcon: c.equippedWeapon ? c.equippedWeapon.icon || '' : '',
    artifactCount: (c.artifacts || []).length || (c.equippedPieces || []).length,
    // Showcase characters carry the only artifact stats we can see, so the UI
    // floats them to the top instead of mixing them into the plain roster.
    showcase: c.showcase === true,
    cv: artifactCv(c),
    // 概览与列表都要用它给展柜角色标个评级，省得前端再算一遍
    cvGrade: c.showcase ? totalCvGradeOf(artifactCv(c)) : '',
    eff: effectiveBuild(c) ? effectiveBuild(c).total : 0,
    effGrade: effectiveBuild(c) ? effectiveBuild(c).grade : '',
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


/**
 * 武器图鉴：官方目录（253 把，含未拥有）+ 本地详情 + 快照里的拥有情况。
 *
 * 三份数据各管一段：
 *  - catalog：有哪些武器、图标、星级、类型（官方接口，会随版本更新）
 *  - weapon-details：90 级基础攻击、副属性、被动精炼原文、故事（随包）
 *  - snapshot.weapons：我拥有哪些、多少级、精炼几、装在谁身上
 */
/** 官方角色图鉴拿不到时，用随包字典拼一份（没有图标）。 */
export function charactersFromDict() {
  return Object.entries(dictionary.characters || {}).map(([id, character]) => ({
    id: Number(id),
    name: character.name,
    icon: '',
    element: character.element,
    type: character.weapon,
    rarity: character.rarity,
  }))
}

/** 官方图鉴拿不到时，用随包字典拼一份（没有图标，只有名字/类型/星级）。 */
export function catalogFromDict() {
  return {
    at: 0,
    cached: false,
    weapons: Object.entries(dictionary.weapons || {}).map(([id, weapon]) => ({
      id: Number(id),
      name: weapon.name,
      icon: '',
      type: weapon.type,
      rarity: weapon.rarity,
    })),
  }
}

export function weaponCodex(snapshot, catalog, { sort = 'rarity' } = {}) {
  const owned = new Map()
  for (const weapon of (snapshot && snapshot.weapons) || []) {
    owned.set(String(weapon.id), weapon)
  }
  const seen = new Set()
  const rows = []
  for (const item of (catalog && catalog.weapons) || []) {
    const id = String(item.id)
    if (seen.has(id)) continue
    seen.add(id)
    const mine = owned.get(id) || null
    const detail = weaponDetailById(id) || null
    rows.push({
      id,
      name: item.name || (detail && detail.name) || id,
      icon: item.icon || '',
      type: normalizeWeapon(item.type),
      typeZh: weaponTypeZh(item.type),
      rarity: Number(item.rarity) || 0,
      // 只在图鉴里、账号没抽到的武器没有等级与精炼，界面据此显示「未拥有」。
      owned: Boolean(mine),
      level: mine ? mine.level : null,
      refinement: mine ? mine.refinement : null,
      owner: mine && mine.location ? characterNameOf(mine.location) : '',
      detail: detail
        ? {
            baseAtk: detail.baseAtk,
            subLabel: detail.subLabel,
            subValue: detail.subValue,
            passive: detail.passive,
            refines: detail.refines,
            lore: detail.lore,
          }
        : null,
    })
  }
  // 拥有的武器如果不在官方目录里（例如活动限定），也要列出来，不能凭空消失。
  for (const [id, mine] of owned) {
    if (seen.has(id)) continue
    seen.add(id)
    const detail = weaponDetailById(id) || null
    rows.push({
      id,
      name: mine.name || id,
      icon: mine.icon || '',
      type: normalizeWeapon(mine.type),
      typeZh: mine.typeZh || weaponTypeZh(mine.type),
      rarity: Number(mine.rarity) || 0,
      owned: true,
      level: mine.level,
      refinement: mine.refinement,
      owner: mine.location ? characterNameOf(mine.location) : '',
      detail: detail ? { baseAtk: detail.baseAtk, subLabel: detail.subLabel, subValue: detail.subValue, passive: detail.passive, refines: detail.refines, lore: detail.lore } : null,
      offCatalog: true,
    })
  }
  const by = {
    rarity: (a, b) => b.rarity - a.rarity || a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'zh'),
    owned: (a, b) => Number(b.owned) - Number(a.owned) || b.rarity - a.rarity || a.name.localeCompare(b.name, 'zh'),
    name: (a, b) => a.name.localeCompare(b.name, 'zh'),
  }
  rows.sort(by[sort] || by.rarity)
  return {
    total: rows.length,
    owned: rows.filter((row) => row.owned).length,
    equipped: rows.filter((row) => row.owner).length,
    fetchedAt: (catalog && catalog.at) || null,
    cached: Boolean(catalog && catalog.cached),
    weapons: rows,
  }
}


/**
 * 角色图鉴 + 收藏统计。
 *
 * tags 来自 data/character-tags.json（wiki 抓的体型 / 地区），collections 是
 * 人工维护的收藏分组（七神、执行官等，见 data/character-collections.json）。
 * 收藏统计只看「已实装角色」，未拥有名字直接列出来，方便玩家补收集。
 */
export function characterCodex(snapshot, catalog, tags, collections, { sort = 'rarity' } = {}) {
  const owned = new Map()
  for (const character of (snapshot && snapshot.characters) || []) owned.set(String(character.id), character)
  const tagOf = (name) => (tags && tags[name]) || {}

  const rows = []
  const seen = new Set()
  for (const item of (catalog && catalog.characters) || []) {
    const id = String(item.id)
    if (seen.has(id)) continue
    seen.add(id)
    const mine = owned.get(id) || null
    const meta = tagOf(item.name)
    rows.push({
      id,
      name: item.name || id,
      icon: item.icon || '',
      element: item.element || 'none',
      elementZh: elementZh(item.element),
      type: normalizeWeapon(item.type),
      typeZh: weaponTypeZh(item.type),
      rarity: Number(item.rarity) || 0,
      body: meta.body || '',
      region: meta.region || '',
      owned: Boolean(mine),
      level: mine ? mine.level : null,
      constellation: mine ? mine.constellation : null,
      showcase: Boolean(mine && mine.showcase),
    })
  }
  // 拥有但不在官方目录里（旅行者形态等），也要出现
  for (const [id, mine] of owned) {
    if (seen.has(id)) continue
    const meta = tagOf(mine.name)
    rows.push({
      id,
      name: mine.name || id,
      icon: mine.icon || '',
      element: mine.element || 'none',
      elementZh: elementZh(mine.element),
      type: normalizeWeapon(mine.weaponType),
      typeZh: weaponTypeZh(mine.weaponType),
      rarity: Number(mine.rarity) || 0,
      body: meta.body || '',
      region: meta.region || '',
      owned: true,
      level: mine.level,
      constellation: mine.constellation,
      showcase: Boolean(mine.showcase),
      offCatalog: true,
    })
  }
  const by = {
    rarity: (a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name, 'zh'),
    level: (a, b) => Number(b.level || 0) - Number(a.level || 0) || b.rarity - a.rarity,
    name: (a, b) => a.name.localeCompare(b.name, 'zh'),
  }
  rows.sort(by[sort] || by.rarity)

  const ownedRows = rows.filter((row) => row.owned)
  const groups = []
  const pushGroup = (key, label, members) => {
    const list = members.map((name) => rows.find((row) => row.name === name)).filter(Boolean)
    const have = list.filter((row) => row.owned)
    groups.push({
      key,
      label,
      total: list.length,
      owned: have.length,
      missing: list.filter((row) => !row.owned).map((row) => row.name),
      names: list.map((row) => row.name),
    })
  }
  const BODY_ORDER = ['萝莉', '少女', '成女', '成男', '少年']
  for (const body of BODY_ORDER) pushGroup('body:' + body, body, rows.filter((row) => row.body === body).map((row) => row.name))
  for (const group of (collections && collections.groups) || []) pushGroup('list:' + group.key, group.label, group.names || [])
  // 地区按游戏开放顺序排，没列到的（新增国家）自动接在后面
  const REGION_ORDER = ['蒙德', '璃月', '稻妻', '须弥', '枫丹', '纳塔', '挪德卡莱', '至冬', '其他']
  const regions = [...new Set(rows.map((row) => row.region).filter(Boolean))]
  regions.sort((a, b) => {
    const ia = REGION_ORDER.indexOf(a)
    const ib = REGION_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b, 'zh')
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
  for (const region of regions) pushGroup('region:' + region, region, rows.filter((row) => row.region === region).map((row) => row.name))

  return {
    total: rows.length,
    owned: ownedRows.length,
    fetchedAt: (catalog && catalog.at) || null,
    cached: Boolean(catalog && catalog.cached),
    warning: (catalog && catalog.note) || '',
    groups,
    characters: rows,
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
    // What the weapon *is* — stats, passive text and lore — for the hover card.
    detail: weaponDetailById(w.id) || null,
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

export function publicArtifact(a, who) {
  // `icon` and `pieceName` are display-only extras some sources provide.
  // `mainStat` / `subStats` are the structured form the card layout needs; the
  // flat `main` / `subs` strings stay for the text renderers and the tools.
  const mainStat = a.main
    ? { key: a.main.key, label: a.main.label, text: a.main.text, value: a.main.value, percent: a.main.percent }
    : null
  // Exact roll counts: the value is decomposed against the legal roll tiers and
  // the four substats are solved together, which also reveals the initial count.
  const solved = solveRolls(a.subs || [], { rarity: a.rarity, level: a.level })
  const subStats = (a.subs || []).map((s, index) => {
    const match = solved.perStat[index]
    return {
      key: s.key,
      label: s.label,
      text: s.text,
      value: s.value,
      percent: s.percent,
      rolls: match ? match.rolls : null,
      rollsExact: match ? match.exact : false,
    }
  })
  return {
    setName: a.setName,
    setKey: a.setKey,
    setId: a.setId,
    slot: a.slot,
    slotZh: a.slotZh,
    rarity: a.rarity,
    level: a.level,
    main: mainStat ? mainStat.text + ' ' + mainStat.label : '',
    mainStat,
    subs: subStats.map((s) => s.text + ' ' + s.label),
    subStats,
    cv: a.score.cv,
    cvGrade: a.score.cvGrade || '',
    // 有效词条权重法的得分与部位评级（权重按角色取，缺省用通用）
    eff: Math.round(scorePiece(a, who) * 10) / 10,
    effGrade: pieceGradeOf(scorePiece(a, who), a.slot),
    efficiency: a.score.efficiency,
    rollsTotal: solved.total || null,
    rollsUpgrades: solved.upgrades,
    initialSubstats: solved.initial,
    grade: a.score.grade,
    icon: a.icon || '',
    iconAlt: a.iconAlt || iconAltOf(a.icon),
    pieceName: a.pieceName || '',
    owner: a.location ? characterNameOf(a.location) : '',
  }
}

/**
 * One character, shaped for display: the record of what the UI reads.
 *
 * `element` stays the Chinese label the text renderer prints, while `elementId`
 * is the id the UI needs for its accent colour. `icon` is display-only.
 */
export function characterView(snapshot, character) {
  return {
    uid: snapshot.uid || '',
    name: character.name,
    icon: character.icon || '',
    level: character.level,
    levelHintOnly: Boolean(character.levelHintOnly),
    rarity: character.rarity,
    element: character.elementZh,
    elementId: character.element,
    weaponType: character.weaponTypeZh,
    constellation: character.constellation,
    talents: character.talents,
    // Panel values come from the showcase payload; `elemDmg` is the bonus that
    // matches this character's element (the payload reports all seven).
    stats: character.stats
      ? Object.assign({}, character.stats, {
          elemDmg: character.stats.dmg ? character.stats.dmg[character.element] || 0 : 0,
        })
      : null,
    weapon: character.equippedWeapon
      ? {
          name: character.equippedWeapon.name,
          rarity: character.equippedWeapon.rarity,
          level: character.equippedWeapon.level,
          refinement: character.equippedWeapon.refinement,
          icon: character.equippedWeapon.icon || '',
          id: character.equippedWeapon.id ? String(character.equippedWeapon.id) : '',
          // Same data the 武器 page's hover card uses (stats / passive / lore).
          detail: character.equippedWeapon.id ? weaponDetailById(character.equippedWeapon.id) : null,
        }
      : null,
    sets: setSummary(character.artifacts),
    setEffects: activeSetEffects(character.artifacts),
    artifacts: (character.artifacts || []).map((artifact) => publicArtifact(artifact, character.name)),
    // Whole-build rating (CV total / average efficiency / letter grade).
    buildScore: scoreBuild(character.artifacts),
    // 有效词条权重法：五件合计与总评级
    effective: effectiveBuild(character),
    // 当前使用的权重（界面要展示），以及它来自官方表还是模板
    weights: weightsFor(character.name),
    weightsSource: hasTableWeights(character.name) ? 'table' : 'template',
    source: snapshot.source,
  }
}
/**
 * 五件套的有效词条总分（权重按角色取）。
 */
export function effectiveBuild(character) {
  const artifacts = (character && character.artifacts) || []
  if (!artifacts.length) return null
  const who = character.name
  let total = 0
  for (const artifact of artifacts) total += scorePiece(artifact, who)
  total = Math.round(total * 10) / 10
  return { total, count: artifacts.length, grade: totalGradeOf(total) }
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
