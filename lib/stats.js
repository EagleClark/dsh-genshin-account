/**
 * Canonical stat vocabulary.
 *
 * Three id spaces have to meet here:
 * - GOOD files (`@genshin-optimizer` export) use keys like `critRate_`, `hp_`.
 * - Enka returns `FIGHT_PROP_*` prop ids on main stats and substats.
 * - The miHoYo record API returns the same `FIGHT_PROP_*` ids as strings.
 *
 * `maxRoll` is the highest single substat roll at 5★ (used for the
 * "efficiency" score, i.e. how many perfect rolls an artifact carries).
 */
export const STATS = {
  hp: { zh: '生命值', percent: false, prop: 'FIGHT_PROP_HP', maxRoll: 298.75 },
  hp_: { zh: '生命值', percent: true, prop: 'FIGHT_PROP_HP_PERCENT', maxRoll: 5.83 },
  atk: { zh: '攻击力', percent: false, prop: 'FIGHT_PROP_ATTACK', maxRoll: 19.45 },
  atk_: { zh: '攻击力', percent: true, prop: 'FIGHT_PROP_ATTACK_PERCENT', maxRoll: 5.83 },
  def: { zh: '防御力', percent: false, prop: 'FIGHT_PROP_DEFENSE', maxRoll: 23.15 },
  def_: { zh: '防御力', percent: true, prop: 'FIGHT_PROP_DEFENSE_PERCENT', maxRoll: 7.29 },
  eleMas: { zh: '元素精通', percent: false, prop: 'FIGHT_PROP_ELEMENT_MASTERY', maxRoll: 23.31 },
  enerRech_: { zh: '元素充能效率', percent: true, prop: 'FIGHT_PROP_CHARGE_EFFICIENCY', maxRoll: 6.48 },
  critRate_: { zh: '暴击率', percent: true, prop: 'FIGHT_PROP_CRITICAL', maxRoll: 3.89 },
  critDMG_: { zh: '暴击伤害', percent: true, prop: 'FIGHT_PROP_CRITICAL_HURT', maxRoll: 7.77 },
  heal_: { zh: '治疗加成', percent: true, prop: 'FIGHT_PROP_HEAL_ADD', maxRoll: 5.83 },
  physical_dmg_: { zh: '物理伤害加成', percent: true, prop: 'FIGHT_PROP_PHYSICAL_ADD_HURT', maxRoll: 5.83 },
  pyro_dmg_: { zh: '火元素伤害加成', percent: true, prop: 'FIGHT_PROP_FIRE_ADD_HURT', maxRoll: 5.83 },
  electro_dmg_: { zh: '雷元素伤害加成', percent: true, prop: 'FIGHT_PROP_ELEC_ADD_HURT', maxRoll: 5.83 },
  hydro_dmg_: { zh: '水元素伤害加成', percent: true, prop: 'FIGHT_PROP_WATER_ADD_HURT', maxRoll: 5.83 },
  dendro_dmg_: { zh: '草元素伤害加成', percent: true, prop: 'FIGHT_PROP_GRASS_ADD_HURT', maxRoll: 5.83 },
  anemo_dmg_: { zh: '风元素伤害加成', percent: true, prop: 'FIGHT_PROP_WIND_ADD_HURT', maxRoll: 5.83 },
  geo_dmg_: { zh: '岩元素伤害加成', percent: true, prop: 'FIGHT_PROP_ROCK_ADD_HURT', maxRoll: 5.83 },
  cryo_dmg_: { zh: '冰元素伤害加成', percent: true, prop: 'FIGHT_PROP_ICE_ADD_HURT', maxRoll: 5.83 },
}

const BY_PROP = new Map()
for (const [key, stat] of Object.entries(STATS)) BY_PROP.set(stat.prop, key)

/** `FIGHT_PROP_CRITICAL` -> `critRate_`; unknown props pass through as-is. */
export function statKeyOfProp(prop) {
  if (typeof prop !== 'string') return ''
  return BY_PROP.get(prop) || prop
}

export function stat(key) {
  return STATS[key] || null
}

/** Six slot names, GOOD keys first because they are the neutral id. */
export const SLOTS = {
  flower: { zh: '生之花', main: 'hp' },
  plume: { zh: '死之羽', main: 'atk' },
  sands: { zh: '时之沙', main: null },
  goblet: { zh: '空之杯', main: null },
  circlet: { zh: '理之冠', main: null },
}
export const SLOT_ORDER = ['flower', 'plume', 'sands', 'goblet', 'circlet']

/** miHoYo equip-type ids used by the record API (`EQUIP_BRACER` …). */
const SLOT_BY_EQUIP = {
  EQUIP_BRACER: 'flower',
  EQUIP_NECKLACE: 'plume',
  EQUIP_SHOES: 'sands',
  EQUIP_RING: 'goblet',
  EQUIP_DRESS: 'circlet',
}
export function slotOfEquip(equip) {
  return SLOT_BY_EQUIP[equip] || ''
}

/** Render one stat value the way the game does (percents keep 1 decimal). */
export function formatStat(key, value) {
  const meta = STATS[key]
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  if (meta && meta.percent) return n.toFixed(1) + '%'
  return String(Math.round(n))
}

export const ELEMENTS = {
  pyro: { zh: '火', color: '#ef7938' },
  hydro: { zh: '水', color: '#4cc2f1' },
  anemo: { zh: '风', color: '#74c2a8' },
  electro: { zh: '雷', color: '#af8ec1' },
  dendro: { zh: '草', color: '#a5c83b' },
  cryo: { zh: '冰', color: '#9fd6e3' },
  geo: { zh: '岩', color: '#fab632' },
  none: { zh: '无', color: '#9aa0a6' },
}

export const WEAPON_TYPES = {
  sword: { zh: '单手剑' },
  claymore: { zh: '双手剑' },
  polearm: { zh: '长柄武器' },
  bow: { zh: '弓' },
  catalyst: { zh: '法器' },
  other: { zh: '其他' },
}

export function elementZh(element) {
  return (ELEMENTS[element] || ELEMENTS.none).zh
}

export function weaponTypeZh(type) {
  return (WEAPON_TYPES[type] || WEAPON_TYPES.other).zh
}
