#!/usr/bin/env node
/**
 * Emit `data/skill-orders.json`: avatarId -> [normalAttackId, skillId, burstId].
 *
 * Needed because a showcase response only carries `skillLevelMap`
 * (`{ skillId: level }`), and the skill ids are NOT assigned in A/E/Q order
 * (Ayaka's normal attack 10024 is larger than her burst 10019). Sorting the map
 * by id would silently swap talent levels, so the authoritative order is taken
 * from Enka's game-data store, which states it per avatar.
 *
 * Source: https://github.com/EnkaNetwork/API-docs (`store/characters.json`),
 * field `SkillOrder` — [normal attack, elemental skill, elemental burst].
 *
 * Usage: node scripts/build-skill-orders.mjs
 */
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const URL_CHARACTERS = 'https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/characters.json'

const response = await fetch(URL_CHARACTERS)
if (!response.ok) {
  console.error('fetch failed:', response.status, URL_CHARACTERS)
  process.exitCode = 1
  process.exit()
}
const store = await response.json()

const out = {}
let withOrder = 0
for (const [avatarId, character] of Object.entries(store)) {
  const order = Array.isArray(character && character.SkillOrder) ? character.SkillOrder : null
  if (!order || order.length < 3) continue
  out[avatarId] = order.slice(0, 3).map((id) => Number(id))
  withOrder += 1
}

const path = join(here, '..', 'data', 'skill-orders.json')
const text = JSON.stringify(out)
await writeFile(path, text)
console.log('wrote', path, (text.length / 1024).toFixed(1) + 'KB', '| avatars with SkillOrder:', withOrder)
