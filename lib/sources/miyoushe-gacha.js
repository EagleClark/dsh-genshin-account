/**
 * Wish history (祈愿记录).
 *
 * The API is `public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog`, and
 * it authenticates with an `authkey` that only exists inside the URL the game
 * opens when you view 祈愿 → 历史记录. That key expires in about 24 hours.
 *
 * The plugin used to dig that URL out of the game's `webCaches` files. In
 * practice the cache often holds a link from days ago, so the API answered
 * `retcode -101 authkey timeout` every time and the feature never worked. That
 * path is gone: the caller must pass a freshly copied URL.
 *
 * Nothing leaves this machine except the request to miHoYo's own API.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const API = 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog'

/** Banner list, in the order the game shows them. */
export const BANNERS = [
  { type: '100', label: '新手祈愿' },
  { type: '200', label: '常驻祈愿' },
  { type: '301', label: '角色活动祈愿' },
  { type: '302', label: '武器活动祈愿' },
  // 400 是角色活动祈愿的第二条线（双 UP 的第二期），保底与 301 共享；
  // 集录祈愿是 500。早先这里把 400 当成集录，导致把角色池的金算到集录头上。
  { type: '400', label: '角色活动祈愿' },
  { type: '500', label: '集录祈愿' },
]

/** 抽卡类型 → 池子。同一个池子的多条线共享保底（301 与 400）。 */
const POOL_OF_TYPE = {
  '100': 'newbie',
  '200': 'standard',
  '301': 'character',
  '400': 'character',
  '302': 'weapon',
  '500': 'chronicled',
}

export const POOL_LABEL = {
  newbie: '新手祈愿',
  standard: '常驻祈愿',
  character: '角色活动祈愿',
  weapon: '武器活动祈愿',
  chronicled: '集录祈愿',
}
const BANNER_LABEL = Object.fromEntries(BANNERS.map((b) => [b.type, b.label]))

/**
 * 常驻池里的五星。
 *
 * 角色活动祈愿出到这些角色，通常就是「歪了」（小保底没中 UP）；
 * 武器活动祈愿同理，出到常驻武器就是歪。名单只用于标注，不影响概率计算。
 */
const STANDARD_FIVE_CHARACTERS = new Set([
  '迪卢克', '琴', '莫娜', '七七', '刻晴', '提纳里', '迪希雅', '埃洛伊',
])
const STANDARD_FIVE_WEAPONS = new Set([
  '天空之刃', '天空之傲', '天空之卷', '天空之翼', '天空之脊',
  '风鹰剑', '狼的末路', '阿莫斯之弓', '和璞鸢', '四风原典',
])

/**
 * 单次出金的欧非分档（按垫了多少抽）。
 * 74 抽之后进入软保底，90 抽是硬保底，所以这两段单独一档。
 */
const FIVE_TIERS = [
  { key: 'lucky', label: '欧皇', max: 20 },
  { key: 'good', label: '小欧', max: 40 },
  { key: 'normal', label: '正常', max: 60 },
  { key: 'late', label: '有点非', max: 73 },
  { key: 'soft', label: '软保底', max: 89 },
  { key: 'hard', label: '硬保底', max: Number.POSITIVE_INFINITY },
]

export function fiveTierOf(pity) {
  const value = Number(pity) || 0
  return FIVE_TIERS.find((tier) => value <= tier.max) || FIVE_TIERS[FIVE_TIERS.length - 1]
}

/** 这条五星是不是常驻池里的东西（角色活动 / 武器活动里等于「歪了」）。 */
export function isStandardFive(item) {
  if (!item) return false
  const name = String(item.name || '')
  const pool = POOL_OF_TYPE[item.gacha_type]
  if (pool === 'character' || pool === 'weapon') {
    return STANDARD_FIVE_CHARACTERS.has(name) || STANDARD_FIVE_WEAPONS.has(name)
  }
  return false
}

const storeFile = (uid) => {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'data', 'dsh-genshin-account', `gacha-${uid || 'unknown'}.json`)
}

export function readRecords(uid) {
  try {
    const stored = JSON.parse(readFileSync(storeFile(uid), 'utf8'))
    if (stored && Array.isArray(stored.items)) return stored
  } catch {
    /* nothing stored yet */
  }
  return { uid: uid || '', updatedAt: 0, items: [] }
}

function writeRecords(uid, items) {
  const target = storeFile(uid)
  mkdirSync(dirname(target), { recursive: true })
  const payload = { uid: uid || '', updatedAt: Date.now(), items }
  writeFileSync(target, JSON.stringify(payload), 'utf8')
  return payload
}

/** One page of one banner. */
async function fetchPage(base, params, gachaType, endId) {
  const query = new URLSearchParams(params)
  query.set('gacha_type', gachaType)
  query.set('size', '20')
  query.set('page', '1')
  query.set('end_id', endId || '0')
  const res = await fetch(`${API}?${query.toString()}`, {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
  })
  const json = await res.json().catch(() => null)
  if (!json) throw new Error('祈愿接口返回了非 JSON 内容')
  if (json.retcode !== 0) {
    const hint =
      json.retcode === -101
        ? '链接里的 authkey 过期了。请回到游戏里打开一次「祈愿 → 历史记录」，再点同步；插件会重新读缓存里的新链接。'
        : json.retcode === 10001
          ? '需要先在游戏里打开一次「祈愿 → 历史记录」，让缓存里出现新的 authkey。'
          : ''
    const error = new Error(`祈愿接口报错 retcode=${json.retcode}：${json.message || '(无)'}${hint ? '\n' + hint : ''}`)
    error.retcode = json.retcode
    throw error
  }
  return (json.data && json.data.list) || []
}

/**
 * Pull every banner until it stops returning new records.
 * @param {{ url: string, uid?: string, full?: boolean }} options
 */
export async function syncGacha({ url, uid, full = false, maxPages = 200 } = {}) {
  // 只接受手动粘贴的链接。游戏缓存里那条往往是几天前的，authkey 早就过期，
  // 自动读取只会稳定地拿到 -101，所以这条路径已经移除。
  if (!url || !String(url).trim()) {
    throw new Error('需要一条祈愿历史链接：在游戏里打开「祈愿 → 历史记录」，把那段地址整段复制过来。')
  }
  const target = String(url).trim()
  let parsed
  try {
    parsed = new URL(target)
  } catch {
    throw new Error('祈愿链接格式不对，需要以 https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog? 开头')
  }
  const params = {}
  for (const key of ['authkey_ver', 'sign_type', 'auth_appid', 'init_type', 'gacha_id', 'timestamp', 'lang', 'game_biz', 'region', 'authkey']) {
    const value = parsed.searchParams.get(key)
    if (value) params[key] = value
  }
  if (!params.authkey) throw new Error('祈愿链接里没有 authkey，请在游戏里重新打开一次祈愿历史。')

  const stored = readRecords(uid)
  const known = new Set(stored.items.map((item) => item.id))
  const added = []
  let reachedKnown = false

  for (const banner of BANNERS) {
    let endId = '0'
    for (let page = 0; page < maxPages; page += 1) {
      const list = await fetchPage(target, params, banner.type, endId)
      if (!list.length) break
      let fresh = 0
      for (const item of list) {
        if (!item || !item.id) continue
        if (known.has(item.id)) continue
        known.add(item.id)
        fresh += 1
        added.push({
          id: String(item.id),
          uid: String(item.uid || uid || ''),
          gacha_id: String(item.gacha_id || ''),
          gacha_type: String(item.gacha_type || banner.type),
          item_id: String(item.item_id || ''),
          count: String(item.count || '1'),
          time: String(item.time || ''),
          name: String(item.name || ''),
          lang: String(item.lang || 'zh-cn'),
          item_type: String(item.item_type || ''),
          rank_type: String(item.rank_type || ''),
        })
      }
      if (!fresh) {
        reachedKnown = true
        break
      }
      endId = list[list.length - 1].id
      if (list.length < 20) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (reachedKnown && !full) break
  }

  const merged = [...stored.items, ...added]
  // Newest first, and deduplicated by id.
  const seen = new Set()
  const items = merged
    .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
    .sort((a, b) => String(b.time).localeCompare(String(a.time)) || String(b.id).localeCompare(String(a.id)))
  const saved = writeRecords(uid || (items[0] && items[0].uid) || '', items)
  return { added: added.length, total: items.length, updatedAt: saved.updatedAt, partial: reachedKnown }
}

/** Chinese banner label for a gacha_type string. */
export function bannerLabel(type) {
  return BANNER_LABEL[String(type)] || String(type)
}

/**
 * Turn raw records into the numbers people actually want:
 * how many pulls, which 5★ came when, how far into pity each banner is.
 */
export function analyze(records) {
  const items = (records && records.items) || []
  const fiveStars = []
  const byBanner = new Map()

  // Oldest first, so "pulls since last 5★" is meaningful.
  const ordered = items.slice().sort((a, b) => String(a.time).localeCompare(String(b.time)) || String(a.id).localeCompare(String(b.id)))
  for (const item of ordered) {
    const pool = POOL_OF_TYPE[item.gacha_type] || 'standard'
    const bucket = byBanner.get(pool) || { type: pool, pool, label: POOL_LABEL[pool], pulls: 0, five: 0, four: 0, sinceFive: 0, next: null }
    bucket.pulls += 1
    bucket.sinceFive += 1
    if (item.rank_type === '5') {
      bucket.five += 1
      const tier = fiveTierOf(bucket.sinceFive)
      fiveStars.push({
        ...item,
        banner: bucket.label,
        pool,
        bannerType: String(item.gacha_type),
        pity: bucket.sinceFive,
        tier: tier.label,
        tierKey: tier.key,
        standard: isStandardFive(item),
        // 只有角色 / 武器活动祈愿才谈得上「歪」
        lost: isStandardFive(item),
      })
      bucket.sinceFive = 0
    } else if (item.rank_type === '4') {
      bucket.four += 1
    }
    byBanner.set(pool, bucket)
  }

  const banners = [...byBanner.values()].filter((bucket) => bucket.pulls > 0)
  const total = items.length
  const five = fiveStars.length
  const rates = banners.map((bucket) => bucket.pulls)

  // Monthly activity, oldest month first, for the little bar chart.
  const monthCounts = new Map()
  for (const item of ordered) {
    const month = String(item.time || '').slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month)) continue
    monthCounts.set(month, (monthCounts.get(month) || 0) + 1)
  }
  const monthly = [...monthCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, pulls]) => ({ month, pulls }))

  // How expensive the 5★ actually were: a histogram of "pulls since last 5★".
  const bucketDefs = [
    { label: '1-20', min: 1, max: 20 },
    { label: '21-40', min: 21, max: 40 },
    { label: '41-60', min: 41, max: 60 },
    { label: '61-80', min: 61, max: 80 },
    { label: '81+', min: 81, max: Number.POSITIVE_INFINITY },
  ]
  const pityBuckets = bucketDefs.map((bucket) => ({
    label: bucket.label,
    count: fiveStars.filter((entry) => entry.pity >= bucket.min && entry.pity <= bucket.max).length,
  }))

  // 1.6% is the published base rate; 62.5 pulls per 5★ at that rate.
  const expectedAverage = 62.5
  const luck = five > 0 && total > 0 ? Math.round((expectedAverage / (total / five)) * 100) / 100 : null

  return {
    total,
    five,
    four: items.filter((item) => item.rank_type === '4').length,
    averageFive: five > 0 ? Math.round((total / five) * 10) / 10 : null,
    expectedAverage,
    // >1 means luckier than the base rate, <1 means unluckier.
    luck,
    updatedAt: records ? records.updatedAt : 0,
    uid: records ? records.uid : '',
    banners,
    // Newest 5★ first for display; each carries how many pulls it took.
    fiveStars: fiveStars.slice().reverse(),
    biggestBanner: rates.length ? Math.max(...rates) : 0,
    monthly,
    pityBuckets,
    lastPullAt: ordered.length ? ordered[ordered.length - 1].time : '',
  }
}
