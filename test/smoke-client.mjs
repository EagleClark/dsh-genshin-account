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
import { mkdtempSync, readFileSync } from 'node:fs'
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
// Cordis throws `cannot get property "configForms" without inject` on mere
// property access, so this must be a declared dependency — reading it lazily
// "just in case" is a render crash, not a graceful degradation.
check('declares configForms in inject', Array.isArray(mod.inject) && mod.inject.includes('configForms'), JSON.stringify(mod.inject))

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
// The registered component is the error-boundary wrapper, so expand it before
// asserting on the tree the user actually sees.
let pageTree
try {
  pageTree = flatten(expand(main.component({})))
  pageTree = flatten(pageTree)
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

// --- the setup pane is login-only -------------------------------------------
/**
 * Resolve a rendered tree into plain intrinsic nodes.
 *
 * Component elements (like the `<SetupTab>` the page renders) are invoked here,
 * so class assertions see what the browser would actually build.
 */
function flatten(node) {
  if (node == null || node === false || node === true) return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) {
    const items = []
    for (const item of node) {
      const resolved = flatten(item)
      if (resolved != null) items.push(resolved)
    }
    return items
  }
  if (typeof node !== 'object') return null
  if (typeof node.type === 'function') return flatten(expand(node))
  const children = []
  for (const child of node.children || []) {
    const resolved = flatten(child)
    if (resolved != null) children.push(resolved)
  }
  return { type: node.type, props: node.props || {}, children }
}

/** Depth-first walk over a rendered tree, calling back with every node. */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const child of node.children || []) walk(child, visit)
}

/** All text inside a node (strings, numbers, and nested children). */
function textOf(node) {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object') return textOf(node.children)
  return ''
}

/** The class attribute of a rendered element. */
function className(node) {
  return (node && node.props && node.props.className) || ''
}

/**
 * Unwrap a registered component down to real host elements.
 *
 * `main` is the error-boundary wrapper (a class component), so rendering it
 * yields another component element. Instantiate class components / call function
 * components until an intrinsic element (`div`, …) comes out.
 */
function expand(element) {
  let node = element
  for (let depth = 0; depth < 10 && node && typeof node === 'object'; depth += 1) {
    const type = node.type
    if (typeof type === 'string') return node
    if (typeof type === 'function' && type.prototype && typeof type.prototype.render === 'function') {
      node = new type(node.props || {}).render()
      continue
    }
    if (typeof type === 'function') {
      node = type(node.props || {})
      continue
    }
    return node
  }
  return node
}

const inputs = []
const buttons = []
walk(pageTree, (node) => {
  if (node.type === 'input') inputs.push(node)
  if (node.type === 'button') buttons.push(textOf(node))
})
const pageText = textOf(pageTree)

check('settings pane has the UID field', inputs.length >= 1, String(inputs.length))
check('settings pane explains the UID', pageText.includes('UID'), pageText.slice(0, 200))
check('settings pane has the QR button', buttons.some((label) => label.includes('生成二维码')), buttons.join(' / '))
// The slider does render (bind + appendTo), so the entry must stay reachable.
// The verification entry was removed after six payload/flag combinations and
// both http and https were rejected with 10306; offering the button would be a
// promise the plugin cannot keep.
// One manual retry entry stays, because a fresh App-side verification may
// change the outcome; it must not be an automatic loop.
check('settings pane offers a single manual retry', buttons.filter((label) => label.includes('验证')).length === 1, buttons.join(' / '))
check('settings pane offers a refresh after verifying', buttons.some((label) => label.includes('已完成，刷新数据')), buttons.join(' / '))
check('settings pane keeps save buttons', buttons.includes('保存并同步') && buttons.includes('仅保存'), buttons.join(' / '))
check('settings pane no longer offers diagnostics', !buttons.some((label) => label.includes('诊断')), buttons.join(' / '))
check('settings pane explains the session stays local', pageText.includes('只存在本机'), pageText.slice(0, 240))
check('settings pane states the sub-stat evidence', pageText.includes('10306') && pageText.includes('https'), pageText.slice(0, 300))
check('the default tab is the login pane on a cold start', className(pageTree).includes('dga-root') && pageText.includes('扫码登录'), pageText.slice(0, 120))

// --- field contract: what the page reads must exist in the host payload -----
const { apply: hostApply } = await import('../lib/index.js')
const hostTools = new Map()
const hostRoutes = new Map()
const fixture = (name) => JSON.parse(readFileSync(new URL('./' + name, import.meta.url), 'utf8'))
const indexFixture = fixture('fixture-miyoushe-index.json')
const detailFixture = fixture('fixture-miyoushe-detail.json')
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  const target = String(url)
  const respond = (body) => ({ status: 200, text: async () => JSON.stringify(body), json: async () => body, headers: { getSetCookie: () => [] } })
  if (target.includes('/device-fp/api/getFp')) return respond({ retcode: 0, data: { device_fp: 'fp' } })
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
          skill_list: [{ id: 10461, level_current: 9 }, { id: 10462, level_current: 10 }, { id: 10463, level_current: 8 }],
          weapon: { id: 13501, name: '护摩之杖', level_current: 90 },
          reliquary_list: [{ id: 8054 }],
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
  if (target.includes('/roleBasicInfo')) return respond({ retcode: 0, data: { nickname: '测试旅行者', level: 58, region: 'cn_gf01' } })
  return respond(indexFixture)
}
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
  { miyousheUid: '188337967', miyousheCookie: 'ltuid_v2=1; ltoken_v2=v2_x; ltmid_v2=m', cacheSeconds: 0 },
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

async function postRoute(target, text) {
  const pathname = target.split('?')[0]
  const req = {
    url: '/dsh-genshin-account' + pathname,
    method: 'POST',
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(text, 'utf8')
    },
  }
  const res = fakeRes()
  await hostRoutes.get('/dsh-genshin-account' + pathname)(req, res)
  return JSON.parse(res.body)
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
check('overview.bestArtifact is null or complete', summary.overview.bestArtifact === null || ('setName' in summary.overview.bestArtifact && 'cv' in summary.overview.bestArtifact), JSON.stringify(summary.overview.bestArtifact))
check('overview.note', typeof summary.overview.note === 'string')
const listItem = summary.characters[0]
check('character list item fields', ['id', 'name', 'level', 'element', 'elementZh', 'rarity', 'constellation'].every((key) => key in listItem), JSON.stringify(listItem))

// Per-character artifacts only exist on the record path; pass one verification
// (stubbed) so the contract below is checked against the full snapshot.
const verified = await postRoute('/verify/finish', JSON.stringify({ purpose: 'index', challenge: 'CH', validate: 'VAL' }))
check('stubbed verification yields the full snapshot', verified.ok === true && verified.overview.counts.artifacts > 0, JSON.stringify(verified.overview && verified.overview.counts))

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

// --- a context that refuses configForms must not blank the page -------------
// Cordis throws `cannot get property "configForms" without inject` on property
// access; this reproduces the exact render crash that showed an empty panel.
const hostile = {
  slots: ctx.slots,
  get configForms() {
    throw new Error('cannot get property "configForms" without inject')
  },
}
let hostileThrown = null
let hostileText = ''
try {
  mod.apply(hostile)
  const pageEntry = registrations.filter((entry) => entry.options.name === 'main').slice(-1)[0]
  hostileText = textOf(flatten(expand(pageEntry.component({}))))
} catch (error) {
  hostileThrown = error
}
check('renders when configForms access throws', hostileThrown === null, hostileThrown && hostileThrown.message)
check('wizard still renders without configForms', hostileText.includes('扫码登录'), hostileText.slice(0, 120))
check('read-only hint is shown instead of a crash', hostileText.includes('无法写入配置'), hostileText.slice(-200))

console.log('registrations:', registrations.map((entry) => entry.options.name + '(' + (entry.options.key || entry.options.id) + ')').join(', '))
console.log('page root:', pageTree && pageTree.type, 'children:', pageTree && (pageTree.children || []).length)
console.log('contract checked against', artifact.setName, artifact.main)

if (fails.length) {
  console.error('\nFAILED:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
