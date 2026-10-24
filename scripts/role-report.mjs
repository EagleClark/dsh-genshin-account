/**
 * 生成「角色 → 定位」核对表，并用当前拟定权重算一遍分数。
 *
 * Dev-only：
 *   node scripts/role-report.mjs
 * 输出写到 data/role-proposal.md，同时打印到 stdout。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROLES, hasTableWeights, roleOf, roleLabel, scorePiece, scoreBuildForRole, weightsFor } from '../lib/roles.js'

const API = process.env.DSH_HOST_URL || 'http://127.0.0.1:43129'
const storageDir = join(
  process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
  'dsh-desktop', 'harness', 'data', 'dsh-genshin-account',
)

const summary = await (await fetch(API + '/dsh-genshin-account/summary')).json()
const characters = summary.characters || []
const snapshot = JSON.parse(readFileSync(join(storageDir, 'snapshot-miyoushe.json'), 'utf8'))

const order = ['crit', 'reaction', 'burst', 'support', 'hp', 'def', 'heal', 'generic']
const lines = []

lines.push('# 角色定位（收益权重）核对表')
lines.push('')
lines.push('## 一、八个模板的权重')
lines.push('')
lines.push('| 定位 | 生命 | 攻击 | 防御 | 暴击 | 暴伤 | 精通 | 充能 | 说明 |')
lines.push('|---|---|---|---|---|---|---|---|---|')
for (const key of order) {
  const role = ROLES[key]
  const w = role.weights
  lines.push(`| ${role.label} | ${w.hp} | ${w.atk} | ${w.def} | ${w.critRate} | ${w.critDMG} | ${w.em} | ${w.er} | ${role.hint} |`)
}

lines.push('')
lines.push('## 二、角色权重（来自官方表）')
lines.push('')
const missing = characters.filter((c) => !hasTableWeights(c.name)).map((c) => c.name)
lines.push(`覆盖 ${characters.length - missing.length} / ${characters.length} 个角色；表里没有的（回落通用）${missing.length} 个：${missing.join('、') || '无'}`)
lines.push('')
lines.push('| 角色 | 生命 | 攻击 | 防御 | 暴击 | 暴伤 | 精通 | 充能 |')
lines.push('|---|---|---|---|---|---|---|---|')
for (const c of characters.slice().sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name, 'zh'))) {
  const w = weightsFor(c.name)
  const pct = (value) => (value ? Math.round(value * 100) + '%' : '-')
  lines.push(`| ${c.name}${hasTableWeights(c.name) ? '' : ' *'} | ${pct(w.hp)} | ${pct(w.atk)} | ${pct(w.def)} | ${pct(w.critRate)} | ${pct(w.critDMG)} | ${pct(w.em)} | ${pct(w.er)} |`)
}

lines.push('## 三、按当前定位算出的分数')
lines.push('')
lines.push('| 角色 | 生之花 | 死之羽 | 时之沙 | 空之杯 | 理之冠 | 合计 |')
lines.push('|---|---|---|---|---|---|---|')
const showcase = (snapshot.characters || []).filter((c) => (c.artifacts || []).length)
showcase.sort((a, b) => scoreBuildForRole(b.artifacts, roleOf(b.name)).total - scoreBuildForRole(a.artifacts, roleOf(a.name)).total)
for (const character of showcase) {
  const role = roleOf(character.name)
  const bySlot = {}
  for (const piece of character.artifacts || []) bySlot[piece.slot] = scorePiece(piece, role)
  const total = scoreBuildForRole(character.artifacts, role)
  const mark = hasTableWeights(character.name) ? '' : ' *'
  lines.push(
    `| ${character.name}${mark} | ${bySlot.flower ?? '-'} | ${bySlot.plume ?? '-'} | ${bySlot.sands ?? '-'} | ${bySlot.goblet ?? '-'} | ${bySlot.circlet ?? '-'} | ${total.total} |`,
  )
}

const text = lines.join('\n') + '\n'
writeFileSync(join(process.cwd(), 'data', 'role-proposal.md'), text, 'utf8')
console.log(text)
