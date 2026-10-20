/**
 * Wish-history analytics test — pure data in, numbers out:
 *   node test/smoke-gacha.mjs
 */
import { analyze, bannerLabel, BANNERS } from '../lib/sources/miyoushe-gacha.js'

const fails = []
const check = (name, condition, detail) => {
  if (!condition) fails.push(name + (detail ? ' :: ' + detail : ''))
}

/** Build synthetic records: one 5★ every \`pity\` pulls, oldest first. */
function build({ type, pulls, pity, startMonth }) {
  const items = []
  for (let i = 0; i < pulls; i += 1) {
    const month = startMonth
    const day = String((i % 28) + 1).padStart(2, '0')
    items.push({
      id: type + '-' + i,
      gacha_type: type,
      rank_type: (i + 1) % pity === 0 ? '5' : i % 10 === 0 ? '4' : '3',
      name: 'item' + i,
      time: month + '-' + day + ' 12:00:00',
    })
  }
  return items
}

check('banner labels', bannerLabel('301') === '角色活动祈愿', bannerLabel('999'))
check('five banners known', BANNERS.length === 5, String(BANNERS.length))

const records = {
  uid: '1',
  updatedAt: 123,
  items: [
    ...build({ type: '301', pulls: 80, pity: 40, startMonth: '2026-01' }),
    ...build({ type: '200', pulls: 20, pity: 10, startMonth: '2026-02' }),
  ],
}

const a = analyze(records)
check('counts every pull', a.total === 100, String(a.total))
check('counts 5★', a.five === 4, String(a.five))
check('average pulls per 5★', a.averageFive === 25, String(a.averageFive))
check('luck ratio uses the 1.6% expectation', a.luck === 2.5, String(a.luck))
check('two banners reported', a.banners.length === 2, JSON.stringify(a.banners))
const limited = a.banners.find((b) => b.type === '301')
check('banner pull count', limited.pulls === 80, String(limited.pulls))
check('banner 5★ count', limited.five === 2, String(limited.five))
check('banner pity resets at the last 5★', limited.sinceFive === 0 || limited.sinceFive < 40, String(limited.sinceFive))
check('5★ list is newest first', a.fiveStars[0].time >= a.fiveStars[a.fiveStars.length - 1].time)
check('each 5★ carries its cost', a.fiveStars.every((s) => s.pity >= 1), JSON.stringify(a.fiveStars.map((s) => s.pity)))
check('pity buckets cover every 5★', a.pityBuckets.reduce((sum, b) => sum + b.count, 0) === a.five, JSON.stringify(a.pityBuckets))
check('monthly activity is ordered', a.monthly.map((m) => m.month).join(',') === '2026-01,2026-02', JSON.stringify(a.monthly))
check('monthly totals', a.monthly[0].pulls === 80 && a.monthly[1].pulls === 20, JSON.stringify(a.monthly))
check('empty records analyse to zeros', analyze({ items: [] }).total === 0)
check('no 5★ means no average', analyze({ items: [{ id: '1', gacha_type: '301', rank_type: '3', time: '2026-01-01 00:00:00' }] }).averageFive === null)

if (fails.length) {
  console.error('\nFAILED:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
