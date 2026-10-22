/**
 * Build `data/weapon-details.json` from genshin-db.
 *
 * The hover card on the 武器 page shows what the *weapon* is — max-level stats,
 * the passive with its refinement text, and the one-line lore — none of which the
 * account API returns. genshin-db ships that data, so it is materialised once at
 * build time instead of being fetched at runtime (the plugin has to work
 * offline).
 *
 * Dev-only:
 *   npm i --prefix %TEMP%\gsdb genshin-db
 *   GENSHIN_DB_DIR=%TEMP%\gsdb\node_modules node scripts/build-weapon-details.mjs
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { STATS } from '../lib/stats.js'

const require = createRequire(import.meta.url)
const dbDir = process.env.GENSHIN_DB_DIR || 'node_modules'
let db
try {
  db = createRequire(`${dbDir}/noop.js`)('genshin-db')
} catch (error) {
  console.error('genshin-db 无法加载，请先 npm i genshin-db（可用 GENSHIN_DB_DIR 指向安装目录）')
  process.exit(1)
}
db.setOptions({ queryLanguages: ['ChineseSimplified', 'English'], resultLanguage: 'ChineseSimplified' })

const weapons = JSON.parse(readFileSync(new URL('../data/weapons.json', import.meta.url), 'utf8'))

/** Which stat key a `FIGHT_PROP_*` maps to, so the value is formatted like the rest of the plugin. */
const KEY_BY_PROP = Object.fromEntries(Object.entries(STATS).map(([key, meta]) => [meta.prop, key]))

function formatSpecialized(prop, value) {
  const key = KEY_BY_PROP[prop]
  const percent = key ? STATS[key].percent : /PERCENT|CRITICAL|CHARGE|HEAL_ADD|_ADD_HURT/.test(prop)
  if (!Number.isFinite(value)) return ''
  if (percent) return Math.round(value * 1000) / 10 + '%'
  return String(Math.round(value))
}

const out = {}
let found = 0
let missing = []

for (const [id, meta] of Object.entries(weapons)) {
  const entry = db.weapons(meta.name) || (meta.en ? db.weapons(meta.en) : null) || db.weapons(Number(id))
  if (!entry) {
    missing.push(meta.name + '(' + id + ')')
    continue
  }
  const max = typeof entry.stats === 'function' ? entry.stats(90) : null
  const refines = ['r1', 'r2', 'r3', 'r4', 'r5'].map((key) => {
    const value = entry[key]
    return value && value.description ? value.description : ''
  })
  const subKey = KEY_BY_PROP[entry.mainStatType]
  out[id] = {
    // Max-level numbers; the game shows these on the weapon's own page.
    baseAtk: max ? Math.round(max.attack * 10) / 10 : null,
    subProp: entry.mainStatType || '',
    subKey: subKey || '',
    subLabel: subKey ? STATS[subKey].zh : entry.mainStatText || '',
    subValue: max ? formatSpecialized(entry.mainStatType, max.specialized) : '',
    passive: entry.effectName || '',
    refines,
    lore: entry.description || '',
  }
  found += 1
}

writeFileSync(new URL('../data/weapon-details.json', import.meta.url), JSON.stringify(out), 'utf8')
console.log(`写入 data/weapon-details.json：${found}/${Object.keys(weapons).length} 把武器`)
if (missing.length) console.log('未匹配：' + missing.slice(0, 12).join('、') + (missing.length > 12 ? ` 等 ${missing.length} 把` : ''))
