/**
 * GOOD-format file source.
 *
 * The GOOD ("Genshin Open Object Description") JSON is what
 * Genshin Optimizer, Amenoma, Inventory Kamera and friends export. It is the
 * only source that carries the **whole inventory** — every character, every
 * weapon, every artifact with all substats — and it works for 国服 and 国际服
 * alike because it never talks to a server.
 *
 * Mapping notes (GOOD → this plugin):
 * - `characters[].key` is a GOOD key such as `"HuTao"`; it resolves through the
 *   shipped alias index, so an unknown/new key still displays something.
 * - `talent` may be `{ auto, skill, burst }` or a single number.
 * - artifacts carry `location` = the GOOD key of the wearing character, which
 *   is what re-attaches them to a build.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { characterRef, makeArtifact, makeWeapon, statLine, buildSnapshot } from '../model.js'
import { SLOT_ORDER, slotOfEquip } from '../stats.js'

export const id = 'good'
export const label = '本地 GOOD 文件'

export function expandPath(raw) {
  const value = String(raw || '').trim()
  if (value === '') return ''
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

function talentsOf(character) {
  const talent = character.talent ?? character.talents
  if (typeof talent === 'number') return { auto: talent, skill: talent, burst: talent }
  if (talent && typeof talent === 'object') {
    return {
      auto: Number(talent.auto ?? talent.normal ?? 0),
      skill: Number(talent.skill ?? talent.e ?? 0),
      burst: Number(talent.burst ?? talent.q ?? 0),
    }
  }
  return { auto: 0, skill: 0, burst: 0 }
}

function substatsOf(artifact) {
  const raw = artifact.substats ?? artifact.subStats ?? []
  return raw
    .filter((sub) => sub && typeof sub.key === 'string')
    .map((sub) => statLine(sub.key, sub.value))
}

function mainStatOf(artifact) {
  const key = artifact.mainStatKey
  if (!key) return null
  const value = artifact.mainStatValue
  // A GOOD file stores only the main *key*; the +20 value comes from the game's
  // fixed main-stat table, so it is filled in by the table below.
  return statLine(key, value == null ? MAIN_STAT_VALUE[key] : value)
}

/**
 * The main-stat value of a +20 5★ artifact is fixed per slot, so a file that
 * omits `mainStatValue` still renders a correct number.
 */
const MAIN_STAT_VALUE = {
  hp: 4780,
  atk: 311,
  hp_: 46.6,
  atk_: 46.6,
  def_: 58.3,
  eleMas: 187,
  enerRech_: 51.8,
  critRate_: 31.1,
  critDMG_: 62.2,
  heal_: 35.9,
  physical_dmg_: 58.3,
  pyro_dmg_: 46.6,
  electro_dmg_: 46.6,
  hydro_dmg_: 46.6,
  dendro_dmg_: 46.6,
  anemo_dmg_: 46.6,
  geo_dmg_: 46.6,
  cryo_dmg_: 46.6,
}

export async function fetchSnapshot(config) {
  const started = Date.now()
  const path = expandPath(config && config.goodPath)
  if (path === '') {
    throw new Error('还没有配置 GOOD 文件路径。请在插件设置里填写导出的 GOOD JSON 文件（用 Amenoma / Genshin Optimizer / Inventory Kamera 导出）。')
  }
  if (!isAbsolute(path) && !/^[a-zA-Z]:[\\/]/.test(path)) {
    throw new Error(`GOOD 文件路径必须是绝对路径：${path}`)
  }
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error(`找不到 GOOD 文件：${path}`)
    throw new Error(`读取 GOOD 文件失败：${error && error.message ? error.message : String(error)}`)
  }
  let data
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new Error(`GOOD 文件不是合法 JSON：${error && error.message ? error.message : String(error)}`)
  }
  if (!data || (data.format !== 'GOOD' && !Array.isArray(data.characters))) {
    throw new Error('这个 JSON 看起来不是 GOOD 格式（缺少 format: "GOOD"）。请确认导出时选的是 GOOD。')
  }

  const weapons = (data.weapons || [])
    .filter((w) => w && typeof w.key === 'string')
    .map((w) =>
      makeWeapon(w.key, {
        level: w.level,
        refinement: w.refinement ?? w.refine,
        location: w.location == null ? '' : w.location,
      }),
    )

  const artifacts = (data.artifacts || [])
    .filter((a) => a && typeof a.setKey === 'string')
    .map((a) =>
      makeArtifact({
        setKey: a.setKey,
        slot: a.slotKey || slotOfEquip(a.slotKey),
        rarity: a.rarity,
        level: a.level,
        main: mainStatOf(a),
        subs: substatsOf(a),
        location: a.location == null ? '' : a.location,
      }),
    )
    .filter((a) => SLOT_ORDER.includes(a.slot))

  const characters = (data.characters || [])
    .filter((c) => c && typeof c.key === 'string')
    .map((c) => {
      const ref = characterRef(c.key)
      return {
        id: ref.id,
        key: c.key,
        name: ref.name,
        en: ref.en || '',
        element: ref.element,
        weaponType: ref.weapon,
        rarity: ref.rarity,
        level: Number(c.level ?? 0),
        ascension: Number(c.ascension ?? 0),
        constellation: Number(c.constellation ?? 0),
        talents: talentsOf(c),
        stats: null,
      }
    })

  const snapshot = buildSnapshot({
    source: id,
    player: { nickname: '', level: 0 },
    characters,
    weapons,
    artifacts,
    note: `GOOD v${data.version ?? '?'}${data.source ? ' · ' + data.source : ''} · ${path}`,
    elapsedMs: Date.now() - started,
  })
  return snapshot
}
