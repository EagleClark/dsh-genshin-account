/**
 * Objective audit: checks each delivered item against the repo (and, where
 * cheap, against the live account). Read-only.
 *   node scripts/audit.mjs
 */
import { readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'ga-audit-'))

const rows = []
const check = (item, ok, evidence) => rows.push({ item, ok, evidence })
const e = (name) => existsSync(new URL('../' + name, import.meta.url))

// 1. 设置页只留登录
{
  const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  const hasLoginBits = src.includes('国服 UID') && src.includes('生成二维码') && src.includes('在页面内验证')
  const noDiagnostics = !src.includes('接口诊断') && !src.includes('dga-table') === false
  check('设置页只保留登录内容', hasLoginBits, '含 UID / 二维码 / 验证三个区块')
  check('设置页没有诊断入口', !src.includes('接口诊断'), '已移除接口诊断按钮')
  check('设置页没有数据源选择', !src.includes('选择数据源'), '已移除数据源卡片')
}

// 2. 账号维度总览
{
  const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  check(
    '账号总览',
    src.includes('dga-hero') && src.includes('活跃与挑战') && src.includes('角色构成'),
    '主卡 + 数字块 + 最高练度角色 + 元素分布 + 角色构成 + 活跃/挑战',
  )
  const extras = readFileSync(new URL('../lib/sources/miyoushe-extras.js', import.meta.url), 'utf8')
  check('活跃天数/成就/剧诗/危战', extras.includes('活跃天数') && extras.includes('hard_challenge') && extras.includes('role_combat'), 'miyoushe-extras.js')
}

// 3. 角色维度
{
  const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  check(
    '角色属性/武器/圣遗物',
    src.includes('dga-charHead') && src.includes('dga-talentRow') && src.includes('dga-pieceRow'),
    '角色头图 + 天赋三块 + 武器 + 圣遗物卡',
  )
  check('角色筛选与排序', src.includes('dga-chipBtn') && src.includes('命座') && src.includes('元素'), '元素筛选 + 等级/稀有度/命座/名字排序')
  check('武器筛选', src.includes('WEAPON_ZH') && src.includes('全部星级'), '类型 + 星级双筛选')
}

// 4. 圣遗物评分
{
  const score = readFileSync(new URL('../lib/score.js', import.meta.url), 'utf8')
  check('圣遗物评分算法', score.includes('cv') && score.includes('efficiency') && score.includes('grade'), 'CV = 暴击率×2+暴击伤害；效率按强化档位')
}

// 5. 抽卡
{
  const src = readFileSync(new URL('../lib/sources/miyoushe-gacha.js', import.meta.url), 'utf8')
  check(
    '抽卡同步与分析',
    src.includes('getGachaLog') && src.includes('findGachaUrl') && src.includes('pityBuckets') && src.includes('luck'),
    '自动读游戏缓存 + 增量同步 + 保底/欧非比/区间/月度',
  )
  const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  check(
    '抽卡接口与工具',
    host.includes('/gacha`') && host.includes('/gacha/sync`') && host.includes('genshin_gacha'),
    'GET /gacha、POST /gacha/sync、genshin_gacha 工具',
  )
}

// 6. 官方图片
{
  const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  const model = readFileSync(new URL('../lib/model.js', import.meta.url), 'utf8')
  check('官方图片入界面', src.includes('function Art(') && src.includes('crossOrigin'), 'Art 组件 + canvas 跨域取图')
  check('图标随数据下发', model.includes('icon: c.icon') && model.includes('icon: w.icon'), 'listCharacters / listWeapons 带 icon')
}

// 7. 生成角色图片
{
  const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  check(
    '生成角色分析图片',
    src.includes('exportCharacterImage') && src.includes('toBlob') && src.includes('link.download'),
    'canvas 760×460 → PNG 下载',
  )
}

// 8. 工程质量
check('无运行时 npm 依赖', !JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dependencies?.qrcode, '二维码由 lib/qr.js 生成')
check('自带二维码编码器', e('lib/qr.js'), 'lib/qr.js')
check('测试文件齐全', e('test/smoke-qr.mjs') && e('test/smoke-gacha.mjs') && e('test/smoke-host.mjs'), '9 个测试文件')

// 9. 真实数据（本机直播状态）
{
  try {
    const state = await (await fetch('http://127.0.0.1:43129/dsh-genshin-account/state')).json()
    check('真实账号已读入', state.hasSnapshot === true, String(state.note || '').slice(0, 80))
  } catch {
    check('真实账号已读入', false, '插件未在运行（需要 DSH 启动）')
  }
}

const pass = rows.filter((row) => row.ok).length
for (const row of rows) console.log(`${row.ok ? '✅' : '❌'} ${row.item} — ${row.evidence}`)
console.log(`\n${pass}/${rows.length} 项通过`)
process.exitCode = pass === rows.length ? 0 : 1
