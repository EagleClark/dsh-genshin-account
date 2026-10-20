#!/usr/bin/env node
/**
 * Regenerate data/*.json from a local `genshin-db` install.
 *
 * The plugin ships a trimmed, Chinese-first snapshot of the parts of the game
 * data it actually needs: character names/element/weapon type, weapon
 * names/type/rarity, artifact set names and 2pc/4pc effects. Everything is
 * keyed by the numeric game id, with an `alias` (lowercase alphanumerics of the
 * English name) so a GOOD-format key such as `"HuTao"` or
 * `"GladiatorsFinale"` resolves by normalisation instead of an exact-key table.
 *
 * Usage:
 *   node scripts/build-dict.mjs <path-to-genshin-db>
 *   node scripts/build-dict.mjs            # looks for ../../gdb/node_modules/genshin-db
 *
 * Source data: genshin-db (MIT) — https://github.com/theBowja/genshin-db
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'data')

const ELEMENTS = {
  element_pyro: 'pyro',
  element_cryo: 'cryo',
  element_hydro: 'hydro',
  element_electro: 'electro',
  element_dendro: 'dendro',
  element_anemo: 'anemo',
  element_geo: 'geo',
  element_none: 'none',
  // Enka spells the same seven elements as plain words.
  fire: 'pyro',
  ice: 'cryo',
  water: 'hydro',
  electric: 'electro',
  grass: 'dendro',
  wind: 'anemo',
  rock: 'geo',
}
const ELEMENT_ZH = {
  pyro: '火',
  cryo: '冰',
  hydro: '水',
  electro: '雷',
  dendro: '草',
  anemo: '风',
  geo: '岩',
  none: '无',
}
const WEAPON_TYPES = {
  WEAPON_SWORD_ONE_HAND: 'sword',
  WEAPON_CLAYMORE: 'claymore',
  WEAPON_POLE: 'polearm',
  WEAPON_BOW: 'bow',
  WEAPON_CATALYST: 'catalyst',
}
const WEAPON_TYPE_ZH = {
  sword: '单手剑',
  claymore: '双手剑',
  polearm: '长柄武器',
  bow: '弓',
  catalyst: '法器',
}

/** Lowercase alphanumerics — the join key between good keys and English names. */
const alias = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '')

async function main() {
  const root = resolve(process.argv[2] || join(here, '..', '..', 'gdb', 'node_modules', 'genshin-db'))
  const dataPath = join(root, 'src', 'min', 'data.min.json')
  console.log('reading', dataPath)
  const all = JSON.parse(await readFile(dataPath, 'utf8')).data
  const zh = all.ChineseSimplified
  const en = all.English

  const pick = (category, key) => zh[category]?.[key]

  // ---- characters ---------------------------------------------------------
  const characters = {}
  const charAliases = {}
  for (const key of Object.keys(zh.characters || {})) {
    const c = zh.characters[key]
    const e = en.characters?.[key]
    if (!c || typeof c.id !== 'number') continue
    if (/\(test\)|测试|alyosha/i.test(c.name || '')) continue
    const element = ELEMENTS[String(c.elementType || '').toLowerCase()] || 'none'
    const weapon = WEAPON_TYPES[c.weaponType] || 'other'
    const entry = {
      name: c.name,
      en: e?.name || '',
      element,
      weapon,
      rarity: c.rarity || 4,
      alias: alias(e?.name || key),
    }
    characters[String(c.id)] = entry
    if (entry.alias) charAliases[entry.alias] = String(c.id)
    // The genshin-db key itself normalises to the same thing, but keep it as a
    // second alias in case the English display name differs from the file key.
    if (key !== entry.alias) charAliases[key] = String(c.id)
  }

  // The two Traveler bodies are not modelled per element by genshin-db; relabel
  // them so "旅行者" matches both, and let every `Traveler*` GOOD key resolve.
  const travelers = [
    { id: '10000005', name: '旅行者（空）', en: 'Traveler', alias: 'traveler' },
    { id: '10000007', name: '旅行者（荧）', en: 'Traveler', alias: 'traveler' },
  ]
  for (const t of travelers) {
    characters[t.id] = {
      ...(characters[t.id] || { rarity: 5 }),
      name: t.name,
      en: t.en,
      alias: t.alias,
      weapon: 'sword',
      rarity: 5,
    }
    charAliases[t.alias] = t.id
  }
  for (const element of ['anemo', 'geo', 'electro', 'dendro', 'hydro', 'pyro', 'cryo']) {
    charAliases['traveler' + element] = characters['10000005'] ? '10000005' : '10000007'
  }

  // ---- weapons ------------------------------------------------------------
  const weapons = {}
  const weaponAliases = {}
  for (const key of Object.keys(zh.weapons || {})) {
    const w = zh.weapons[key]
    const e = en.weapons?.[key]
    if (!w || typeof w.id !== 'number') continue
    const type = WEAPON_TYPES[w.weaponType] || 'other'
    const entry = {
      name: w.name,
      en: e?.name || '',
      type,
      rarity: w.rarity || 4,
      alias: alias(e?.name || key),
    }
    if (!entry.alias) delete entry.alias
    weapons[String(w.id)] = entry
    if (entry.alias) weaponAliases[entry.alias] = String(w.id)
    if (key !== entry.alias) weaponAliases[key] = String(w.id)
  }

  // ---- artifact sets ------------------------------------------------------
  const artifactSets = {}
  const setAliases = {}
  for (const key of Object.keys(zh.artifacts || {})) {
    const a = zh.artifacts[key]
    const e = en.artifacts?.[key]
    if (!a || typeof a.id !== 'number') continue
    const entry = {
      name: a.name,
      en: e?.name || '',
      rarity: Math.max(...(a.rarityList || [5])),
      two: a.effect2Pc || '',
      four: a.effect4Pc || '',
      alias: alias(e?.name || key),
    }
    if (!entry.alias) delete entry.alias
    artifactSets[String(a.id)] = entry
    if (entry.alias) setAliases[entry.alias] = String(a.id)
    if (key !== entry.alias) setAliases[key] = String(a.id)
  }

  await mkdir(outDir, { recursive: true })
  const write = async (name, value) => {
    const path = join(outDir, name)
    await writeFile(path, JSON.stringify(value))
    console.log('wrote', name, (JSON.stringify(value).length / 1024).toFixed(1) + 'KB')
  }
  await write('characters.json', characters)
  await write('weapons.json', weapons)
  await write('artifact-sets.json', artifactSets)
  await write('aliases.json', { characters: charAliases, weapons: weaponAliases, artifactSets: setAliases })
  await write('elements.json', ELEMENT_ZH)
  await write('weapon-types.json', WEAPON_TYPE_ZH)

  console.log(
    'characters', Object.keys(characters).length,
    'weapons', Object.keys(weapons).length,
    'sets', Object.keys(artifactSets).length,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
