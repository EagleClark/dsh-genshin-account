/**
 * Client bundle test — loads client/client.js the way the web boot protocol
 * does, with a stub React, and checks:
 *   1. the bundle registers itself under the package name,
 *   2. apply() registers exactly `main` + `sidebar.panellist` with the same key,
 *   3. the icon renders an SVG and the page renders without throwing,
 *   4. every field the page reads actually exists in the host's JSON payload
 *      (the most likely bug class in a two-half plugin).
 *
 *   node test/smoke-client.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-genshin-client-'))

const fails = []
const check = (name, condition, detail) => {
  if (!condition) fails.push(name + (detail ? ' :: ' + detail : ''))
}

// --- stub React -------------------------------------------------------------
// Components are called directly, so hooks only need to be callable and stable.
function createElement(type, props, ...children) {
  return { type, props: props || {}, children: children.flat() }
}
const stubReact = {
  createElement,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  // Effects run so the form-resolution path is exercised, not just rendering.
  useEffect: (fn) => {
    try {
      fn()
    } catch (error) {
      /* a stubbed transport may reject; rendering is what this test checks */
    }
  },
  useMemo: (factory) => factory(),
  useRef: (value) => ({ current: value }),
  Fragment: "Fragment",
}

// --- load the bundle the way the boot protocol does --------------------------
let factoryCapture = null
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => {
      factoryCapture = entry
    },
  },
}

await import('../client/client.js')

check('bundle called __ModuleLoader__.load', Boolean(factoryCapture))
check('bundle id is the package name', factoryCapture && factoryCapture.id === 'dsh-genshin-account', factoryCapture && factoryCapture.id)

const requireStub = (spec) => {
  if (spec === 'react') return stubReact
  if (spec === 'react/jsx-runtime') return { jsx: createElement, jsxs: createElement, Fragment: 'Fragment' }
  throw new Error('unexpected require: ' + spec)
}
const mod = factoryCapture.factory(requireStub)
check('exports.apply exists', typeof mod.apply === 'function')
check('exports.inject lists slots', Array.isArray(mod.inject) && mod.inject.includes('slots'), JSON.stringify(mod.inject))
check('configForms is optional, not a hard dependency', !mod.inject.includes('configForms'), JSON.stringify(mod.inject))

// The wizard writes through the shared Config form of this bundle's entry.
const getCalls = []
let subscribed = false
const fakeForm = {
  getSnapshot: () => ({ status: 'ready', writable: true, revision: 7, value: { source: 'miyoushe' } }),
  subscribe: () => {
    subscribed = true
    return () => {}
  },
  mutate: () => Promise.resolve(true),
  set: () => Promise.resolve(true),
  unset: () => Promise.resolve(true),
}

// Keep the effects' summary fetch harmless: it resolves to a failed payload
// (no network, no DOM), and the page falls back to the wizard.
globalThis.fetch = () =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: false, error: 'stubbed transport' }),
  })

// --- fake ctx: record slot registrations ------------------------------------
const registrations = []
let disposed = 0
const ctx = {
  slots: {
    inject(key, callback) {
      return callback()
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {
        disposed += 1
      }
    },
  },
  configForms: {
    get(entryId) {
      getCalls.push(entryId)
      return fakeForm
    },
  },
}

mod.apply(ctx)

check('two registrations', registrations.length === 2, String(registrations.length))
const main = registrations.find((entry) => entry.options.name === 'main')
const icon = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
check('main registered', Boolean(main))
check('sidebar.panellist registered', Boolean(icon))
check('main has a key', main && typeof main.options.key === 'string' && main.options.key.length > 0, main && main.options.key)
check('key is not the reserved conversation panel', main && main.options.key !== 'conversation', main && main.options.key)
check('panellist id matches main key', main && icon && icon.options.id === main.options.key, (main && main.options.key) + ' vs ' + (icon && icon.options.id))
check('panellist has an order', icon && typeof icon.options.order === 'number')
check('panellist label resolves', typeof icon.options.label === 'function' ? typeof icon.options.label() === 'string' : typeof icon.options.label === 'string')
check('icon component is a function', typeof icon.component === 'function')
check('page component is a function', typeof main.component === 'function')

// --- render the icon --------------------------------------------------------
const svg = icon.component({ size: 18, active: false })
check('icon renders an svg', svg && svg.type === 'svg', svg && String(svg.type))
check('icon uses the requested size', svg && svg.props.width === 18 && svg.props.height === 18, JSON.stringify(svg && svg.props.width))
const svgActive = icon.component({ size: 16, active: true })
check('icon renders when active', svgActive && svgActive.type === 'svg')

// --- render the page with no data (nothing fetched) --------------------------
let pageTree
try {
  pageTree = main.component({})
} catch (error) {
  fails.push('page render threw :: ' + (error && error.message))
}
check('page renders a root element', pageTree && pageTree.type === 'div', pageTree && String(pageTree.type))

// The Host registers a bundle's Config under `include:<patch row id>`; the bare
// package name is only a fallback. Getting this wrong makes every write report
// "配置暂不可写" while reads keep working — exactly the bug this guards.
check(
  'resolves the include: entry id first',
  getCalls.length > 0 && getCalls[0] === 'include:dsh-genshin-account',
  getCalls.join(','),
)
check('subscribes to the config form snapshot', subscribed === true)

// The client module table can re-apply a bundle in one session (recomposition /
// HMR). Registering the same keyed cell twice abdicates the first occupant and,
// once the second is disposed, leaves a dead entry: selecting that panel key
// renders an empty column. Re-applying must therefore dispose the previous pair.
const beforeReapply = registrations.length
mod.apply(ctx)
check('re-apply disposes the previous registrations', disposed === 2, String(disposed))
check('re-apply registers one fresh pair', registrations.length === beforeReapply + 2, String(registrations.length))
check(
  'the fresh pair still covers both seats',
  registrations.slice(-2).map((entry) => entry.options.name).join(',') === 'main,sidebar.panellist',
  registrations.slice(-2).map((entry) => entry.options.name).join(','),
)

// --- the setup wizard is reachable and offers all three sources -------------
// Components are plain functions here, so expand them before walking.
function expand(node) {
  if (node === null || node === undefined) return node
  if (Array.isArray(node)) return node.map(expand)
  if (typeof node !== 'object') return node
  if (typeof node.type === 'function') return expand(node.type(node.props || {}))
  return { type: node.type, props: node.props || {}, children: (node.children || []).map(expand) }
}

const rendered = expand(pageTree)

function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  visit(node)
  if (node.children) walk(node.children, visit)
}

function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.children)
}

const className = (node) => (node.props && typeof node.props.className === 'string' ? node.props.className : '')
const cards = []
const buttons = []
walk(rendered, (node) => {
  if (className(node).split(' ').includes('dga-src')) cards.push(node)
  if (node.type === 'button') buttons.push(textOf(node))
})
check('wizard shows one card per data source', cards.length === 3, String(cards.length))
check('wizard card names', cards.map(textOf).join('|').includes('本地 GOOD 文件'), cards.map(textOf).join(' | ').slice(0, 160))
check('wizard names Enka', cards.map(textOf).join('|').includes('Enka.Network'))
check('wizard names 米游社', cards.map(textOf).join('|').includes('米游社'))
check('wizard explains what GOOD reads', cards.map(textOf).join('|').includes('完整背包'))
check('wizard explains Enka limits', cards.map(textOf).join('|').includes('只有展柜角色'))
check('wizard has 保存并同步', buttons.includes('保存并同步'), buttons.join(' / '))
check('wizard has 仅保存', buttons.includes('仅保存'), buttons.join(' / '))
check('wizard has a file picker', buttons.some((label) => label.includes('选择 GOOD 文件')), buttons.join(' / '))

// The step-by-step guide for the default source (GOOD) is rendered.
const steps = []
walk(rendered, (node) => {
  if (node.type === 'li') steps.push(textOf(node))
})
check('wizard renders the how-to steps', steps.length >= 3, JSON.stringify(steps).slice(0, 200))
check('the GOOD guide mentions an export tool', steps.join(' ').includes('Amenoma'), steps.join(' | ').slice(0, 160))
check('the default tab is 设置 on a cold start', className(pageTree).includes('dga-root') && steps.length > 0)

// --- field contract: what the page reads must exist in the host payload -----
const { apply: hostApply } = await import('../lib/index.js')
const hostTools = new Map()
const hostRoutes = new Map()
const fixture = decodeURIComponent(new URL('./fixture-good.json', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
hostApply(
  {
    on() {},
    effect: (fn) => fn(),
    inject: (names, callback) =>
      callback({
        effect: (fn) => fn(),
        tools: { register: (definition) => (hostTools.set(definition.name, definition), () => {}) },
        webServer: { register: (route) => (hostRoutes.set(route.path, route.handler), () => {}) },
      }),
  },
  { source: 'good', goodPath: fixture, cacheSeconds: 600 },
)

function fakeRes() {
  return {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(body) {
      if (body !== undefined) this.body += String(body)
    },
  }
}

async function fetchRoute(target) {
  // The router matches the pathname only; the browser helper keeps the query.
  const pathname = target.split('?')[0]
  const res = fakeRes()
  await hostRoutes.get('/dsh-genshin-account' + pathname)({ url: '/dsh-genshin-account' + target, method: 'GET', headers: {} }, res)
  return JSON.parse(res.body)
}

const summary = await fetchRoute('/summary')
check('summary ok for contract check', summary.ok === true, JSON.stringify(summary).slice(0, 120))

// The page reads: state.{source,uid,fetchedAt,configured}, overview.*, characters[].{id,name,level,element}
check('state.source', typeof summary.state.source === 'string')
check('state.uid', 'uid' in summary.state)
check('state.fetchedAt', typeof summary.state.fetchedAt === 'number')
check('state.configured', typeof summary.state.configured === 'boolean')
check('overview.player', summary.overview.player && typeof summary.overview.player === 'object')
check('overview.counts', summary.overview.counts && typeof summary.overview.counts.characters === 'number')
check('overview.fiveStarArtifacts', typeof summary.overview.counts.fiveStarArtifacts === 'number')
check('overview.elements', summary.overview.elements && typeof summary.overview.elements === 'object')
check('overview.bestArtifact fields', summary.overview.bestArtifact && 'setName' in summary.overview.bestArtifact && 'cv' in summary.overview.bestArtifact)
check('overview.note', typeof summary.overview.note === 'string')
const listItem = summary.characters[0]
check('character list item fields', ['id', 'name', 'level', 'element', 'elementZh', 'rarity', 'constellation'].every((key) => key in listItem), JSON.stringify(listItem))

const character = (await fetchRoute('/character?name=' + encodeURIComponent('胡桃'))).character
check('character.name', typeof character.name === 'string')
check('character.level', typeof character.level === 'number')
check('character.rarity', typeof character.rarity === 'number')
check('character.element', typeof character.element === 'string')
check('character.weaponType', typeof character.weaponType === 'string')
check('character.constellation', typeof character.constellation === 'number')
check('character.talents', character.talents && typeof character.talents.auto === 'number' && 'skill' in character.talents && 'burst' in character.talents)
check('character.stats key exists', 'stats' in character)
check('character.weapon fields', character.weapon && ['name', 'level', 'rarity'].every((key) => key in character.weapon), JSON.stringify(character.weapon))
check('character.sets fields', Array.isArray(character.sets) && character.sets.every((s) => 'setName' in s && 'count' in s))
check('character.setEffects', Array.isArray(character.setEffects))
const artifact = character.artifacts[0]
check(
  'artifact fields the table reads',
  ['slotZh', 'setName', 'rarity', 'level', 'main', 'subs', 'cv', 'efficiency', 'grade'].every((key) => key in artifact),
  JSON.stringify(Object.keys(artifact)),
)
check('artifact subs is an array', Array.isArray(artifact.subs))

const artifacts = await fetchRoute('/artifacts?limit=5')
check('artifacts route shape', artifacts.ok === true && Array.isArray(artifacts.artifacts), JSON.stringify(artifacts).slice(0, 120))
check('artifact row owner present', 'owner' in artifacts.artifacts[0])

const weapons = await fetchRoute('/weapons')
check('weapons route shape', weapons.ok === true && Array.isArray(weapons.weapons), JSON.stringify(weapons).slice(0, 120))
check(
  'weapon row fields',
  ['name', 'typeZh', 'rarity', 'level', 'refinement', 'owner'].every((key) => key in weapons.weapons[0]),
  JSON.stringify(weapons.weapons[0]),
)

// The client fetches exactly these paths — keep them in sync with API in client.js.
const expectedPaths = ['/state', '/summary', '/character', '/artifacts', '/weapons', '/sync']
check('all routes the client calls are mounted', expectedPaths.every((path) => hostRoutes.has('/dsh-genshin-account' + path)), [...hostRoutes.keys()].join(','))

console.log('registrations:', registrations.map((entry) => entry.options.name + '(' + (entry.options.key || entry.options.id) + ')').join(', '))
console.log('page root:', pageTree.type, 'children:', pageTree.children.length)
console.log('contract checked against', artifact.setName, artifact.main)

if (fails.length) {
  console.error('\nFAILED:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
