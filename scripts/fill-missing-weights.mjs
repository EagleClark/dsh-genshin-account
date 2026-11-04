/**
 * 给「字典里有、权重表里没有」的角色补一套估算权重。
 *
 * 为什么需要：`data/character-weights.json` 是逐角色人工/半人工整理的，新版本
 * 上线后总会漏几个。漏掉的角色评分会落到「通用」模板，所有词条一样重要，
 * 排出来的名次没有意义。
 *
 * 估算规则（可复现，不猜具体技能倍率）：
 *   1. 同元素 + 同武器 + 同稀有度，样本 ≥3 → 取平均
 *   2. 否则同武器 + 同稀有度，样本 ≥3 → 取平均
 *   3. 再否则全表平均
 * 平均后四舍五入两位小数，小于 0.1 的噪声归零。
 *
 * 复制进来的是**起点**，不是最终答案：知道具体定位后直接改数字即可，
 * 改完的条目会被本脚本跳过（它只补缺失项）。
 *
 *   node scripts/fill-missing-weights.mjs --dry   # 只看结果
 *   node scripts/fill-missing-weights.mjs         # 写回 JSON
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const KEYS = ['hp', 'atk', 'def', 'critRate', 'critDMG', 'em', 'er', 'heal']
const dry = process.argv.includes('--dry')

const chars = JSON.parse(readFileSync(join(root, 'data', 'characters.json'), 'utf8'))
const weights = JSON.parse(readFileSync(join(root, 'data', 'character-weights.json'), 'utf8'))
const byName = new Map(Object.entries(chars).map(([id, c]) => [c.name, { ...c, id }]))

/**
 * 平均，但对「角色专用」的两条做阈值处理：
 * 治疗加成与防御力只有在明显是这个角色的主属性时才保留（≥0.5），
 * 否则一个全表平均会把治疗权重平白加到输出角色身上。
 */
const average = (list) => {
  const out = {}
  for (const key of KEYS) {
    const value = list.reduce((sum, w) => sum + (Number(w[key]) || 0), 0) / list.length
    const rounded = Math.round(value * 100) / 100
    const roleOnly = key === 'heal' || key === 'def'
    out[key] = rounded < 0.1 ? 0 : roleOnly && rounded < 0.5 ? 0 : rounded
  }
  return out
}

const pool = (predicate) =>
  Object.keys(weights)
    .filter((name) => {
      const c = byName.get(name)
      return c && predicate(c)
    })
    .map((name) => weights[name])

const missing = Object.values(chars).filter((c) => !weights[c.name])
if (!missing.length) {
  console.log('没有缺失的角色')
  process.exit(0)
}

const rows = []
for (const character of missing) {
  let sample = pool((c) => c.element === character.element && c.weapon === character.weapon && c.rarity === character.rarity)
  let basis = '元素+武器+稀有度'
  if (sample.length < 3) {
    sample = pool((c) => c.weapon === character.weapon && c.rarity === character.rarity)
    basis = '武器+稀有度'
  }
  if (sample.length < 3) {
    sample = Object.values(weights)
    basis = '全表'
  }
  rows.push({ name: character.name, element: character.element, weapon: character.weapon, rarity: character.rarity, basis, sample: sample.length, weights: average(sample) })
}

for (const row of rows) {
  const w = row.weights
  console.log(
    `${row.name.padEnd(6)} ${row.element.padEnd(8)} ${row.weapon.padEnd(9)} ${row.rarity}★  ` +
      `[${row.basis} ×${row.sample}]  ` +
      KEYS.map((k) => `${k} ${w[k]}`).join(' '),
  )
}

if (dry) {
  console.log('\n--dry：未写入')
  process.exit(0)
}

for (const row of rows) weights[row.name] = row.weights
writeFileSync(join(root, 'data', 'character-weights.json'), JSON.stringify(weights, null, 2) + '\n', 'utf8')
console.log(`\n已写入 ${rows.length} 条，共 ${Object.keys(weights).length} 条`)
