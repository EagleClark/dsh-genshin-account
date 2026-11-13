/**
 * 角色标签（体型 / 地区 / 性别）→ data/character-tags.json
 *
 * 计算器接口只给 id / 名字 / 图标 / 星级 / 元素 / 武器类型，没有体型这类
 * "玩家视角"的分类；官方 wiki 的角色筛选表里每一行都带 data-param10="少女"
 * 这样的属性，正好可以直接抓。
 *
 *   node scripts/build-character-tags.mjs
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = 'https://wiki.biligame.com/ys/' + encodeURIComponent('角色筛选')

// wiki 把萝莉叫「幼女」，对外统一显示成「萝莉」
const BODY_ALIAS = { 幼女: '萝莉', 萝莉: '萝莉', 少女: '少女', 成女: '成女', 成男: '成男', 少年: '少年' }

const html = await (await fetch(PAGE, { headers: { 'user-agent': 'Mozilla/5.0' } })).text()

// 每个角色是一行 <tr data-param1="5星" data-param2="长柄武器" ... data-param10="少女">
// 名字在行内第一个 title="角色名" 的链接上。
const rows = [...html.matchAll(/<tr\s+([^>]*data-param1="[^"]*"[^>]*)>([\s\S]*?)<\/tr>/g)]
const tags = {}
let parsed = 0
for (const [, attrs, cell] of rows) {
  const params = {}
  for (const m of attrs.matchAll(/data-param(\d+)="([^"]*)"/g)) params[Number(m[1])] = m[2]
  const name = (cell.match(/title="([^"\/]+)"/) || [])[1]
  if (!name) continue
  const bodyType = params[10] || ''
  const region = params[5] || ''
  const sex = params[4] || ''
  if (!bodyType && !region) continue
  const body = BODY_ALIAS[bodyType] || ''
  tags[name] = {
    ...(body ? { body } : {}),
    ...(region ? { region } : {}),
    ...(sex === '男' || sex === '女' ? { sex } : {}),
  }
  parsed += 1
}

const countBy = (key) => {
  const out = {}
  for (const value of Object.values(tags)) {
    if (!value[key]) continue
    out[value[key]] = (out[value[key]] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}

console.log('解析到角色:', parsed)
console.log('体型分布:', JSON.stringify(countBy('body')))
console.log('地区分布:', JSON.stringify(countBy('region')))
writeFileSync(join(root, 'data', 'character-tags.json'), JSON.stringify(tags, null, 2) + '\n', 'utf8')
console.log('已写入 data/character-tags.json')
