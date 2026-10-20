/**
 * Host integration test — no DSH runtime, a minimal fake ctx that records what
 * the plugin registers:
 *   node test/smoke-host.mjs
 *
 * Checks that apply() wires five tools, every schema is well formed, the text
 * renderers produce something readable, and the HTTP routes the browser half
 * calls answer with the documented shapes.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, Config } from '../lib/index.js'

// Keep the snapshot cache the plugin persists out of the real harness dir.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-genshin-test-'))

const fails = []
const check = (name, condition, detail) => {
  if (!condition) fails.push(name + (detail ? ' :: ' + detail : ''))
}

const fixture = decodeURIComponent(new URL('./fixture-good.json', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')

const tools = new Map()
const routes = new Map()

const ctx = {
  on() {},
  effect(fn) {
    const dispose = fn()
    return dispose
  },
  inject(names, callback) {
    const host = {
      effect: (fn) => fn(),
      tools: {
        register(definition) {
          tools.set(definition.name, definition)
          return () => tools.delete(definition.name)
        },
      },
      webServer: {
        register(route) {
          routes.set(route.path, route.handler)
          return () => routes.delete(route.path)
        },
      },
    }
    return callback(host)
  },
}

const config = { source: 'good', goodPath: fixture, cacheSeconds: 600 }
apply(ctx, config)

// --- tools -----------------------------------------------------------------
const expected = [
  'genshin_account_overview',
  'genshin_characters',
  'genshin_character',
  'genshin_artifacts',
  'genshin_weapons',
]
check('five tools registered', tools.size === expected.length, [...tools.keys()].join(','))
for (const name of expected) {
  const tool = tools.get(name)
  check(`${name} registered`, Boolean(tool))
  if (!tool) continue
  check(`${name} has description`, typeof tool.description === 'string' && tool.description.length > 20)
  check(`${name} parameters is object schema`, tool.parameters && tool.parameters.type === 'object')
  check(`${name} output.render is a function`, tool.output && typeof tool.output.render === 'function')
  check(`${name} execute is a function`, typeof tool.execute === 'function')
}

const call = async (name, args) => {
  const tool = tools.get(name)
  const value = await tool.execute(args || {}, {})
  return { value, text: tool.output.render(args || {}, value)[0].text }
}

const overviewResult = await call('genshin_account_overview', {})
check('overview ok', overviewResult.value.ok === true, JSON.stringify(overviewResult.value).slice(0, 160))
check('overview text mentions source', overviewResult.text.includes('good'), overviewResult.text.slice(0, 80))
check('overview text counts characters', /角色 3/.test(overviewResult.text), overviewResult.text)

const characterResult = await call('genshin_character', { name: '胡桃' })
check('character ok', characterResult.value.ok === true, JSON.stringify(characterResult.value).slice(0, 160))
check('character text has name', characterResult.text.includes('胡桃'), characterResult.text.slice(0, 60))
check('character text has talents', characterResult.text.includes('天赋'), characterResult.text.slice(0, 200))
check('character text has artifacts', characterResult.text.includes('圣遗物'), characterResult.text.slice(0, 200))
check('character text has set effect', characterResult.text.includes('件套'), characterResult.text.slice(-160))

const missingResult = await call('genshin_character', { name: '不存在的角色' })
check('missing character is a soft error', missingResult.value.ok === false, JSON.stringify(missingResult.value).slice(0, 120))
check('missing character text explains', missingResult.text.includes('读取失败'), missingResult.text.slice(0, 80))

const charactersResult = await call('genshin_characters', { element: '火' })
check('characters filter works', charactersResult.value.ok === true && charactersResult.value.total === 1, JSON.stringify(charactersResult.value).slice(0, 160))

const artifactsResult = await call('genshin_artifacts', { limit: 2 })
check('artifacts ok', artifactsResult.value.ok === true && artifactsResult.value.artifacts.length === 2, JSON.stringify(artifactsResult.value).slice(0, 160))
check('artifacts sorted by cv', artifactsResult.value.artifacts[0].cv >= artifactsResult.value.artifacts[1].cv)

const weaponsResult = await call('genshin_weapons', { rarity: 5 })
check('weapons ok', weaponsResult.value.ok === true, JSON.stringify(weaponsResult.value).slice(0, 160))
check('weapons rarity filter', weaponsResult.value.weapons.every((w) => w.rarity >= 5), JSON.stringify(weaponsResult.value.weapons))

// --- http routes -----------------------------------------------------------
const routePaths = [...routes.keys()]
check('routes mounted', routePaths.length === 6, routePaths.join(','))

function fakeRes() {
  const res = {
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
  return res
}

const summaryRes = fakeRes()
await routes.get('/dsh-genshin-account/summary')({ url: '/dsh-genshin-account/summary', method: 'GET', headers: {} }, summaryRes)
const summary = JSON.parse(summaryRes.body)
check('summary route ok', summaryRes.status === 200 && summary.ok === true, summaryRes.body.slice(0, 120))
check('summary has overview + characters', Boolean(summary.overview) && Array.isArray(summary.characters) && summary.characters.length === 3)
check('summary reports configured', summary.state && summary.state.configured === true, JSON.stringify(summary.state))

const characterRes = fakeRes()
await routes.get('/dsh-genshin-account/character')(
  { url: '/dsh-genshin-account/character?name=' + encodeURIComponent('胡桃'), method: 'GET', headers: {} },
  characterRes,
)
const characterPayload = JSON.parse(characterRes.body)
check('character route ok', characterPayload.ok === true, characterRes.body.slice(0, 120))
check('character route payload', characterPayload.character && characterPayload.character.name === '胡桃')
check('character route includes stats slot', 'stats' in characterPayload.character)

const artifactsRes = fakeRes()
await routes.get('/dsh-genshin-account/artifacts')({ url: '/dsh-genshin-account/artifacts?limit=3', method: 'GET', headers: {} }, artifactsRes)
check('artifacts route ok', JSON.parse(artifactsRes.body).ok === true, artifactsRes.body.slice(0, 120))

const stateRes = fakeRes()
await routes.get('/dsh-genshin-account/state')({ url: '/dsh-genshin-account/state', method: 'GET', headers: {} }, stateRes)
check('state route ok', JSON.parse(stateRes.body).source === 'good', stateRes.body.slice(0, 120))

const syncRes = fakeRes()
await routes.get('/dsh-genshin-account/sync')({ url: '/dsh-genshin-account/sync', method: 'POST', headers: {} }, syncRes)
check('sync route ok', JSON.parse(syncRes.body).ok === true, syncRes.body.slice(0, 120))

const badOriginRes = fakeRes()
await routes.get('/dsh-genshin-account/sync')({ url: '/x', method: 'POST', headers: { origin: 'https://evil.example', host: 'localhost:1' } }, badOriginRes)
check('sync rejects cross origin', badOriginRes.status === 403, String(badOriginRes.status))

// A source that cannot work must degrade to a soft error, not a throw.
// Drop the persisted snapshot first: keeping a stale one is correct behaviour,
// and this case is about having nothing cached at all.
rmSync(join(process.env.DSH_HOME, 'data', 'dsh-genshin-account'), { recursive: true, force: true })
const broken = { source: 'good', goodPath: 'C:\\definitely\\missing\\good.json', cacheSeconds: 0 }
const brokenTools = new Map()
apply(
  {
    on() {},
    effect: (fn) => fn(),
    inject: (names, callback) =>
      callback({
        effect: (fn) => fn(),
        tools: { register: (definition) => (brokenTools.set(definition.name, definition), () => {}) },
        webServer: { register: () => () => {} },
      }),
  },
  broken,
)
const brokenValue = await brokenTools.get('genshin_account_overview').execute({ refresh: true }, {})
check('missing GOOD file is a soft error', brokenValue.ok === false && /找不到 GOOD 文件/.test(brokenValue.error), JSON.stringify(brokenValue).slice(0, 160))

// --- schema ---------------------------------------------------------------
// A schemastery object is a callable schema, so it is a function, not a plain object.
check('Config is a schemastery schema', Config && (typeof Config === 'object' || typeof Config === 'function'), typeof Config)
const configJson = JSON.stringify(Config)
check('Config declares source enum', configJson.includes('miyoushe'), configJson.slice(0, 200))
check('Config marks fields volatile', configJson.includes('volatile'), configJson.slice(0, 200))

console.log(overviewResult.text)
console.log('---')
console.log(characterResult.text)
console.log('---')
console.log('tools:', [...tools.keys()].join(', '))
console.log('routes:', routePaths.join(', '))

if (fails.length) {
  console.error('\nFAILED:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
