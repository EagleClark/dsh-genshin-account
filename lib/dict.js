/**
 * Static game dictionary shipped with the plugin (`data/*.json`).
 *
 * Everything is keyed by the numeric game id, plus an `aliases` index whose
 * keys are lowercase alphanumerics of the English name. That is deliberately
 * the same normalisation a GOOD key needs (`"HuTao"` → `hutao`,
 * `"Gladiator's Finale"` → `gladiatorsfinale`), so one lookup serves GOOD
 * files, Enka ids and miHoYo ids, and the user can also just type a Chinese
 * name or the English one.
 */
import { readFileSync } from 'node:fs'

const load = (file) => JSON.parse(readFileSync(new URL('../data/' + file, import.meta.url), 'utf8'))

const characters = load('characters.json')
const weapons = load('weapons.json')
const artifactSets = load('artifact-sets.json')
const aliases = load('aliases.json')
const names = load('names-zh.json')
const skillOrders = load('skill-orders.json')
const weaponDetails = load('weapon-details.json')

/** [normalAttack, elementalSkill, elementalBurst] skill ids for one avatar. */
export function skillOrderOf(avatarId) {
  const order = skillOrders[String(avatarId)]
  return Array.isArray(order) ? order : null
}

/** Lowercase alphanumerics only: the one normalisation used everywhere. */
export function normalize(text) {
  return String(text == null ? '' : text).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Hash → Chinese name table (Enka's `nameTextMapHash`, plus `FIGHT_PROP_*`). */
export function nameOfHash(hash) {
  if (hash == null) return ''
  return names[String(hash)] || ''
}

export function characterById(id) {
  return characters[String(id)] || null
}
export function weaponById(id) {
  return weapons[String(id)] || null
}

/** Max-level stats, passive and lore for a weapon, from the shipped table. */
export function weaponDetailById(id) {
  return weaponDetails[String(id)] || null
}
export function artifactSetById(id) {
  return artifactSets[String(id)] || null
}

export function characterIdOfAlias(key) {
  return aliases.characters[normalize(key)] || null
}
export function weaponIdOfAlias(key) {
  return aliases.weapons[normalize(key)] || null
}
export function artifactSetIdOfAlias(key) {
  return aliases.artifactSets[normalize(key)] || null
}

/** Character display name for an id (falls back to the raw id). */
export function characterName(id) {
  const c = characterById(id)
  return c ? c.name : String(id)
}
export function weaponName(id) {
  const w = weaponById(id)
  return w ? w.name : String(id)
}
export function artifactSetName(id) {
  const s = artifactSetById(id)
  return s ? s.name : String(id)
}

const splitPascal = (text) =>
  String(text || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Resolve a user/model supplied character reference: numeric id, Chinese name,
 * English name, or a GOOD key. Substring matching runs last and only when it is
 * unambiguous, so "胡桃" and "hutao" both work without guessing.
 */
export function findCharacters(query) {
  const raw = String(query == null ? '' : query).trim()
  if (raw === '') return []
  if (/^\d+$/.test(raw) && characters[raw]) return [{ id: raw, ...characters[raw] }]
  const byAlias = characterIdOfAlias(raw)
  if (byAlias && characters[byAlias]) return [{ id: byAlias, ...characters[byAlias] }]
  const exact = Object.entries(characters).filter(([, c]) => c.name === raw || c.en === raw)
  if (exact.length) return exact.map(([id, c]) => ({ id, ...c }))
  const needle = normalize(raw) || raw.toLowerCase()
  const fuzzy = Object.entries(characters).filter(([, c]) => {
    const zh = String(c.name || '')
    const en = normalize(c.en)
    return (needle !== '' && (normalize(en).includes(needle) || zh.includes(raw))) || (en && en.includes(needle))
  })
  return fuzzy.map(([id, c]) => ({ id, ...c }))
}

export function findWeapons(query) {
  const raw = String(query == null ? '' : query).trim()
  if (raw === '') return []
  if (/^\d+$/.test(raw) && weapons[raw]) return [{ id: raw, ...weapons[raw] }]
  const byAlias = weaponIdOfAlias(raw)
  if (byAlias && weapons[byAlias]) return [{ id: byAlias, ...weapons[byAlias] }]
  const needle = normalize(raw)
  return Object.entries(weapons)
    .filter(([, w]) => w.name === raw || w.en === raw || (needle !== '' && normalize(w.en).includes(needle)) || String(w.name).includes(raw))
    .map(([id, w]) => ({ id, ...w }))
}

export function findArtifactSets(query) {
  const raw = String(query == null ? '' : query).trim()
  if (raw === '') return []
  if (/^\d+$/.test(raw) && artifactSets[raw]) return [{ id: raw, ...artifactSets[raw] }]
  const byAlias = artifactSetIdOfAlias(raw)
  if (byAlias && artifactSets[byAlias]) return [{ id: byAlias, ...artifactSets[byAlias] }]
  const needle = normalize(raw)
  return Object.entries(artifactSets)
    .filter(([, s]) => s.name === raw || s.en === raw || (needle !== '' && normalize(s.en).includes(needle)) || String(s.name).includes(raw))
    .map(([id, s]) => ({ id, ...s }))
}

/** Display name for an id we could not resolve, e.g. a brand new character. */
export function displayFallback(name, id) {
  return name || '#' + String(id)
}

export const dictionary = {
  characters,
  weapons,
  artifactSets,
  splitPascal,
}
