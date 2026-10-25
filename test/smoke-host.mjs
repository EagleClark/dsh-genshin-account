/**
 * Host integration test — no DSH runtime, a minimal fake ctx that records what
 * the plugin registers:
 *   node test/smoke-host.mjs
 *
 * The transport is stubbed: the miHoYo fixtures below stand in for the record
 * API, so this exercises the real plugin path (miyoushe snapshot → tools →
 * routes) without touching the network.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, Config } from '../lib/index.js'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-genshin-test-'))

const fails = []
const check = (name, condition, detail) => {
  if (!condition) fails.push(name + (detail ? ' :: ' + detail : ''))
}

const fixture = (name) => JSON.parse(readFileSync(new URL('./' + name, import.meta.url), 'utf8'))
const indexFixture = fixture('fixture-miyoushe-index.json')
const detailFixture = fixture('fixture-miyoushe-detail.json')

// --- stubbed transport ------------------------------------------------------
let indexRetcode = 0
const seen = []
globalThis.fetch = async (url, init = {}) => {
  const target = String(url)
  seen.push({ url: target, headers: init.headers || {} })
  const respond = (body) => ({
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
    headers: { getSetCookie: () => [] },
  })
  if (target.includes('/device-fp/api/getFp')) return respond({ retcode: 0, data: { device_fp: 'fp123456789' } })
  if (target.includes('/card/wapi/createVerification')) return respond({ retcode: 0, data: { gt: 'GT', challenge: 'CH', new_captcha: 1 } })
  if (target.includes('/card/wapi/verifyVerification')) return respond({ retcode: 0, data: { challenge: 'XRPC-OK' } })
  if (target.includes('/character/detail')) return respond(detailFixture)
  if (target.includes('/sync/avatar/detail')) {
    const id = Number((target.match(/avatar_id=(\d+)/) || [])[1])
    if (id === 10000046) {
      return respond({
        retcode: 0,
        data: {
          level: 90,
          avatar: { id, name: '胡桃', constellation_num: 1 },
          skill_list: [
            { id: 10461, level_current: 9 },
            { id: 10462, level_current: 10 },
            { id: 10463, level_current: 8 },
          ],
          weapon: { id: 13501, name: '护摩之杖', level_current: 90 },
          reliquary_list: [{ id: 8054 }, { id: 8055 }],
        },
      })
    }
    if (id === 10000002) {
      return respond({
        retcode: 0,
        data: {
          level: 80,
          avatar: { id, name: '神里绫华', constellation_num: 0 },
          skill_list: [{ id: 10024, level_current: 8 }],
          weapon: { id: 11432, name: '厄水之祸', level_current: 80 },
          reliquary_list: [],
        },
      })
    }
    return respond({ retcode: 0, data: {} })
  }
  if (target.includes('/roleBasicInfo')) {
    return respond({ retcode: 0, data: { nickname: '测试旅行者', level: 58, region: 'cn_gf01' } })
  }
  if (target.includes('/card/')) return respond({ retcode: 0, data: {} })
  if (target.includes('/genshin/api/index')) {
    if (indexRetcode !== 0) return respond({ retcode: indexRetcode, message: '', data: null })
    return respond(indexFixture)
  }
  return respond({ retcode: 0, data: {} })
}

/** Build one apply() harness; a second one gives a cold cache for the 1034 case. */
function makeHarness(pluginConfig) {
  const localTools = new Map()
  const localRoutes = new Map()
  const localCtx = {
    on() {},
    effect(fn) {
      return fn()
    },
    inject(names, callback) {
      const host = {
        effect: (fn) => fn(),
        tools: {
          register(definition) {
            localTools.set(definition.name, definition)
            return () => localTools.delete(definition.name)
          },
        },
        webServer: {
          register(route) {
            localRoutes.set(route.path, route.handler)
            return () => localRoutes.delete(route.path)
          },
        },
      }
      return callback(host)
    },
  }
  apply(localCtx, pluginConfig)
  return {
    tools: localTools,
    routes: localRoutes,
    async call(name, args) {
      const tool = localTools.get(name)
      const value = await tool.execute(args || {}, {})
      return { value, text: tool.output.render(args || {}, value)[0].text }
    },
  }
}

const config = {
  miyousheUid: '188337967',
  miyousheServer: 'cn_gf01',
  miyousheCookie: 'ltuid_v2=287530278; ltoken_v2=v2_SECRET; ltmid_v2=mid',
  cacheSeconds: 0,
}
const main = makeHarness(config)
const tools = main.tools
const routes = main.routes
const call = main.call

// --- config schema ---------------------------------------------------------
const schemaKeys = Object.keys(Config.dict || {})
check('config only carries login and gacha settings', schemaKeys.every((k) => k.startsWith('miyoushe') || ['cacheSeconds', 'gamePath', 'gachaUrl'].includes(k)), schemaKeys.join(','))
check('config dropped the GOOD path', !schemaKeys.includes('goodPath'), schemaKeys.join(','))
check('config dropped Enka', !schemaKeys.includes('enkaUid') && !schemaKeys.includes('enkaBase'), schemaKeys.join(','))
check('config dropped the browser-capture path', !schemaKeys.includes('miyousheJsonPath'), schemaKeys.join(','))

// --- tools -----------------------------------------------------------------
const expected = [
  'genshin_account_overview',
  'genshin_characters',
  'genshin_character',
  'genshin_artifacts',
  'genshin_weapons',
  'genshin_gacha',
]
check('six tools registered', tools.size === expected.length, [...tools.keys()].join(','))
for (const name of expected) {
  const tool = tools.get(name)
  check(`${name} registered`, Boolean(tool))
  if (!tool) continue
  check(`${name} has description`, typeof tool.description === 'string' && tool.description.length > 20)
  check(`${name} parameters is object schema`, tool.parameters && tool.parameters.type === 'object')
  check(`${name} output.render is a function`, tool.output && typeof tool.output.render === 'function')
  check(`${name} execute is a function`, typeof tool.execute === 'function')
}

const overviewResult = await call('genshin_account_overview', {})
check('overview ok', overviewResult.value.ok === true, JSON.stringify(overviewResult.value).slice(0, 160))
check('overview names the source', overviewResult.text.includes('米游社'), overviewResult.text.slice(0, 80))
check('overview counts characters', /角色 2/.test(overviewResult.text), overviewResult.text)
check('overview says sub-stats come from the showcase', /角色展柜/.test(overviewResult.text), overviewResult.text)

const characterResult = await call('genshin_character', { name: '胡桃' })
check('character ok', characterResult.value.ok === true, JSON.stringify(characterResult.value).slice(0, 160))
check('character text has talents', characterResult.text.includes('天赋'), characterResult.text.slice(0, 200))
check('character text has talents', characterResult.text.includes('天赋'), characterResult.text.slice(0, 200))

const missingResult = await call('genshin_character', { name: '不存在的角色' })
check('missing character is a soft error', missingResult.value.ok === false, JSON.stringify(missingResult.value).slice(0, 120))

const gachaResult = await call('genshin_gacha', {})
check('gacha tool explains an empty store', gachaResult.value.ok === false && /祈愿/.test(gachaResult.text), gachaResult.text.slice(0, 160))

const weaponsResult = await call('genshin_weapons', {})
check('weapons ok', weaponsResult.value.ok === true, JSON.stringify(weaponsResult.value).slice(0, 160))

// --- http routes -----------------------------------------------------------
const routePaths = [...routes.keys()]
// 图表库已内联进客户端，不再单独注册路由
check('routes mounted', routePaths.length === 15, routePaths.join(','))
check('no chart asset route', !routePaths.some((p) => p.includes('chartlib') || p.includes('chart.js')), routePaths.join(','))

function fakeRes() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      if (body !== undefined) this.body += String(body)
    },
  }
}

const summaryRes = fakeRes()
await routes.get('/dsh-genshin-account/summary')({ url: '/dsh-genshin-account/summary', method: 'GET', headers: {} }, summaryRes)
const summary = JSON.parse(summaryRes.body)
check('summary route ok', summaryRes.status === 200 && summary.ok === true, summaryRes.body.slice(0, 120))
check('summary has overview + characters', Boolean(summary.overview) && Array.isArray(summary.characters) && summary.characters.length === 2)
check('summary reports configured', summary.state && summary.state.configured === true, JSON.stringify(summary.state))

const stateRes = fakeRes()
await routes.get('/dsh-genshin-account/state')({ url: '/dsh-genshin-account/state', method: 'GET', headers: {} }, stateRes)
const statePayload = JSON.parse(stateRes.body)
check('state route ok', statePayload.source === 'miyoushe', stateRes.body.slice(0, 120))
check('state carries the config', Boolean(statePayload.config) && statePayload.config.miyousheUid === '188337967', JSON.stringify(statePayload.config))
check('state reports the stored cookie as a flag', statePayload.config.hasCookie === true)
check('state never echoes the cookie', !stateRes.body.includes('v2_SECRET'), 'cookie leaked into /state')
check('state carries per-source status', Boolean(statePayload.sources) && Boolean(statePayload.sources.miyoushe), JSON.stringify(statePayload.sources))

// --- QR login routes --------------------------------------------------------
const qrRes = fakeRes()
await routes.get('/dsh-genshin-account/login/qr')({ url: '/dsh-genshin-account/login/qr', method: 'POST', headers: {} }, qrRes)
const qrPayload = JSON.parse(qrRes.body)
check('login/qr answers', typeof qrPayload.ok === 'boolean', qrRes.body.slice(0, 160))

const pollGet = fakeRes()
await routes.get('/dsh-genshin-account/login/poll')({ url: '/dsh-genshin-account/login/poll', method: 'GET', headers: {} }, pollGet)
check('login/poll rejects GET', pollGet.status === 405, String(pollGet.status))

// --- verification routes ----------------------------------------------------
const verifyStart = fakeRes()
await routes.get('/dsh-genshin-account/verify/start')({ url: '/dsh-genshin-account/verify/start', method: 'POST', headers: {} }, verifyStart)
const verifyTask = JSON.parse(verifyStart.body)
check('verify/start returns a geetest task', verifyTask.ok === true && verifyTask.gt === 'GT' && verifyTask.challenge === 'CH', verifyStart.body.slice(0, 160))

const verifyFinish = await postJsonRoute('/dsh-genshin-account/verify/finish', JSON.stringify({ challenge: 'CH', validate: 'VAL' }))
const verifyPayload = JSON.parse(verifyFinish.body)
check('verify/finish retries the read', verifyPayload.ok === true && Array.isArray(verifyPayload.characters), verifyFinish.body.slice(0, 200))
check('after verification the record path supplies artifacts', verifyPayload.overview && verifyPayload.overview.counts.artifacts === 5, JSON.stringify(verifyPayload.overview && verifyPayload.overview.counts))
check('verify/finish keeps the x-rpc-challenge on record calls', seen.some((c) => c.url.includes('/genshin/api/index') && c.headers['x-rpc-challenge'] === 'XRPC-OK'))

const gachaRes = fakeRes()
await routes.get('/dsh-genshin-account/gacha')({ url: '/dsh-genshin-account/gacha', method: 'GET', headers: {} }, gachaRes)
const gachaPayload = JSON.parse(gachaRes.body)
check('gacha route answers with an analysis', gachaPayload.ok === true && Boolean(gachaPayload.analysis), gachaRes.body.slice(0, 140))
check('gacha analysis counts pulls', typeof gachaPayload.analysis.total === 'number', JSON.stringify(gachaPayload.analysis).slice(0, 120))

const gachaSyncGet = fakeRes()
await routes.get('/dsh-genshin-account/gacha/sync')({ url: '/dsh-genshin-account/gacha/sync', method: 'GET', headers: {} }, gachaSyncGet)
check('gacha/sync rejects GET', gachaSyncGet.status === 405, String(gachaSyncGet.status))

const widgetRes = fakeRes()
await routes.get('/dsh-genshin-account/verify/widget')({ url: '/dsh-genshin-account/verify/widget?purpose=characters', method: 'GET', headers: {} }, widgetRes)
check('verify/widget serves html', widgetRes.status === 200 && /<html/i.test(widgetRes.body), widgetRes.body.slice(0, 80))
check('verify/widget loads the geetest script', widgetRes.body.includes('static.geetest.com/static/tools/gt.js'))
check('verify/widget embeds the purpose', /var purpose = "characters";/.test(widgetRes.body), widgetRes.body.slice(0, 120))
// Deliberately no CSP on the widget page: a strict policy can break the
// third-party geetest script silently. Assert the choice, not a policy string.
check('verify/widget serves without a csp', widgetRes.headers && widgetRes.headers['content-security-policy'] === undefined, JSON.stringify(widgetRes.headers))
check('verify/widget sets nosniff', Boolean(widgetRes.headers && widgetRes.headers['x-content-type-options'] === 'nosniff'), JSON.stringify(widgetRes.headers))
check('verify/widget never echoes raw input', !widgetRes.body.includes('<script>alert'))

const widgetInject = fakeRes()
await routes.get('/dsh-genshin-account/verify/widget')({ url: '/dsh-genshin-account/verify/widget?purpose=' + encodeURIComponent('<script>alert(1)</script>'), method: 'GET', headers: {} }, widgetInject)
check('verify/widget neutralises a hostile purpose', !widgetInject.body.includes('alert(1)'), widgetInject.body.slice(0, 120))

const widgetPost = await postJsonRoute('/dsh-genshin-account/verify/widget', '{}')
check('verify/widget rejects POST', widgetPost.status === 405, String(widgetPost.status))

const verifyMissing = await postJsonRoute('/dsh-genshin-account/verify/finish', JSON.stringify({ challenge: 'CH' }))
check('verify/finish needs both values', JSON.parse(verifyMissing.body).ok === false, verifyMissing.body.slice(0, 140))

// --- 1034: a failed refresh keeps the cached snapshot, and /state says why --
indexRetcode = 1034
const blocked = await call('genshin_account_overview', { refresh: true })
check('a gated record API still yields data', blocked.value.ok === true, JSON.stringify(blocked.value).slice(0, 140))
check('the fallback explains where artifact stats come from', /角色展柜/.test(blocked.text), blocked.text.slice(0, 220))

// A cold instance with a fresh DSH_HOME has nothing cached; the calculator path
// must still produce a roster rather than an error.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-genshin-cold-'))
const cold = makeHarness({ miyousheUid: '188337967', miyousheCookie: config.miyousheCookie, cacheSeconds: 0 })
const coldResult = await cold.call('genshin_account_overview', {})
check('a cold instance still reads the roster', coldResult.value.ok === true && coldResult.value.overview.counts.characters === 2, JSON.stringify(coldResult.value).slice(0, 160))
check('the cold read reports zero artifact stats', coldResult.value.overview.counts.artifacts === 0, JSON.stringify(coldResult.value.overview.counts))
indexRetcode = 0

const badOriginRes = fakeRes()
await routes.get('/dsh-genshin-account/sync')({ url: '/x', method: 'POST', headers: { origin: 'https://evil.example', host: 'localhost:1' } }, badOriginRes)
check('sync rejects cross origin', badOriginRes.status === 403, String(badOriginRes.status))

const diagGet = fakeRes()
await routes.get('/dsh-genshin-account/diag')({ url: '/dsh-genshin-account/diag', method: 'GET', headers: {} }, diagGet)
check('diag rejects GET', diagGet.status === 405, String(diagGet.status))

function postJsonRoute(path, text) {
  const req = {
    url: path,
    method: 'POST',
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(text, 'utf8')
    },
  }
  const res = fakeRes()
  return Promise.resolve(routes.get(path)(req, res)).then(() => res)
}

if (fails.length) {
  console.error('\nFAILED:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
