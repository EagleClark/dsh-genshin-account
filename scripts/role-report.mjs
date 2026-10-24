/**
 * 生成「角色 → 定位」核对表，并用当前拟定权重算一遍分数。
 *
 * Dev-only：
 *   node scripts/role-report.mjs
 * 输出写到 data/role-proposal.md，同时打印到 stdout。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROLES, roleOf, roleLabel, scorePiece, scoreBuildForRole } from '../lib/roles.js'

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
lines.push('| 定位 | 双暴 | 精通 | 攻击% | 生命% | 防御% | 充能 | 说明 |')
lines.push('|---|---|---|---|---|---|---|---|')
for (const key of order) {
  const role = ROLES[key]
  const w = role.weights
  lines.push(`| ${role.label} | ${w.crit} | ${w.em} | ${w.atk} | ${w.hp} | ${w.def} | ${w.er} | ${role.hint} |`)
}

lines.push('')
lines.push('## 二、角色 → 定位')
lines.push('')
for (const key of order) {
  const group = characters
    .filter((c) => roleOf(c.name) === key)
    .sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name, 'zh'))
  if (!group.length) continue
  lines.push(`**${ROLES[key].label}**（${group.length}）`)
  lines.push('')
  lines.push(group.map((c) => `${c.name}(${c.rarity}★${c.elementZh}/${c.weaponTypeZh})`).join('、'))
  lines.push('')
}

lines.push('## 三、按当前定位算出的分数')
lines.push('')
lines.push('| 角色 | 定位 | 生之花 | 死之羽 | 时之沙 | 空之杯 | 理之冠 | 合计 |')
lines.push('|---|---|---|---|---|---|---|---|')
const showcase = (snapshot.characters || []).filter((c) => (c.artifacts || []).length)
showcase.sort((a, b) => scoreBuildForRole(b.artifacts, roleOf(b.name)).total - scoreBuildForRole(a.artifacts, roleOf(a.name)).total)
for (const character of showcase) {
  const role = roleOf(character.name)
  const bySlot = {}
  for (const piece of character.artifacts || []) bySlot[piece.slot] = scorePiece(piece, role)
  const total = scoreBuildForRole(character.artifacts, role)
  lines.push(
    `| ${character.name} | ${roleLabel(role)} | ${bySlot.flower ?? '-'} | ${bySlot.plume ?? '-'} | ${bySlot.sands ?? '-'} | ${bySlot.goblet ?? '-'} | ${bySlot.circlet ?? '-'} | ${total.total} |`,
  )
}

const text = lines.join('\n') + '\n'
writeFileSync(join(process.cwd(), 'data', 'role-proposal.md'), text, 'utf8')
console.log(text)
