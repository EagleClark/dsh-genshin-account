/**
 * Real-React render check for the browser bundle.
 *
 * The stub-React test (`test/smoke-client.mjs`) cannot catch a render-time
 * throw, a hook-order violation, or an invalid element type — the exact class
 * of failure that blanks the whole shell when a slot component throws. This
 * script renders the registered page with the REAL React reconciler (server
 * renderer, so no DOM is needed) and fails loudly if it throws.
 *
 * Dev-only: needs `react` + `react-dom` resolvable. Point REACT_DIR at a
 * directory that has them, e.g.
 *   npm i --prefix %TEMP%\ga-react react@18 react-dom@18
 *   REACT_DIR=%TEMP%\ga-react node test/render-check.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const reactDir = process.env.REACT_DIR || join(here, '..', 'node_modules')
const require = createRequire(join(reactDir, 'noop.js'))

let React
let ReactDOMServer
try {
  React = require('react')
  ReactDOMServer = require('react-dom/server')
} catch (error) {
  console.error('SKIP: react/react-dom not resolvable from', reactDir)
  process.exit(0)
}

const fails = []
const check = (name, condition, detail) => {
  if (!condition) fails.push(name + (detail ? ' :: ' + detail : ''))
}

// --- minimal browser globals the bundle touches --------------------------
const headChildren = []
globalThis.document = {
  head: { appendChild: (node) => headChildren.push(node) },
  createElement: () => ({ dataset: {}, textContent: '' }),
  querySelector: () => null,
}
globalThis.fetch = () =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: 'render-check has no server' }) })

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => {
      captured = entry
    },
  },
}

// Evaluate the bundle with the real React supplied through `require`.
const source = readFileSync(join(here, '..', 'client', 'client.js'), 'utf8')
const factory = new Function('window', 'document', 'fetch', 'require', 'module', 'exports', source)
const moduleObject = { exports: {} }
factory(globalThis.window, globalThis.document, globalThis.fetch, (spec) => {
  if (spec === 'react') return React
  throw new Error('unexpected require: ' + spec)
}, moduleObject, moduleObject.exports)

check('bundle registered through the loader', Boolean(captured))
check('bundle id', captured && captured.id === 'dsh-genshin-account', captured && captured.id)

const clientModule = captured.factory((spec) => {
  if (spec === 'react') return React
  throw new Error('unexpected require: ' + spec)
})

// --- fake ctx ------------------------------------------------------------
const registrations = []
const form = {
  getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value: {} }),
  subscribe: () => () => {},
  mutate: () => Promise.resolve(true),
  set: () => Promise.resolve(true),
  unset: () => Promise.resolve(true),
}
const ctx = {
  slots: {
    inject: (key, callback) => callback(),
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
  configForms: { get: () => form },
}

let applyError = null
try {
  clientModule.apply(ctx)
} catch (error) {
  applyError = error
}
check('apply() does not throw', applyError === null, applyError && applyError.message)

const page = registrations.find((entry) => entry.options.name === 'main')
const icon = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
check('page registered', Boolean(page))
check('icon registered', Boolean(icon))

function render(name, element) {
  try {
    return { html: ReactDOMServer.renderToStaticMarkup(element), error: null }
  } catch (error) {
    return { html: '', error: (error && error.message) || String(error) }
  }
}

const pageResult = render('page', React.createElement(page.component, {}))
check('page renders with real React', pageResult.error === null, pageResult.error)
check('page output mentions the plugin', pageResult.html.includes('原神账号'), pageResult.html.slice(0, 200))
const cardCount = (pageResult.html.match(/class="dga-src(?=[" ])/g) || []).length
check('page output no longer renders source cards', cardCount === 0, String(cardCount))

const iconResult = render('icon', React.createElement(icon.component, { size: 18, active: false }))
check('icon renders with real React', iconResult.error === null, iconResult.error)
check('icon output is an svg', iconResult.html.startsWith('<svg'), iconResult.html.slice(0, 80))

// --- data-dependent tabs ----------------------------------------------------
// The page mounts on the settings pane and effects do not run in a server
// render, so these are rendered directly with fixtures.
const parts = clientModule.__components || {}
const artifact = {
  setName: '翠绿之影', setKey: '15002', slot: 'flower', slotZh: '生之花', rarity: 5, level: 20,
  main: '4780 生命值',
  mainStat: { key: 'hp', label: '生命值', text: '4780', value: 4780, percent: false },
  subs: ['19.8% 暴击率', '5.8% 攻击力'],
  subStats: [
    { key: 'critRate_', label: '暴击率', text: '19.8%', value: 19.8, percent: true },
    { key: 'atk_', label: '攻击力', text: '5.8%', value: 5.8, percent: true },
  ],
  cv: 39.6, efficiency: 86, grade: '极品', icon: '', owner: '温迪',
}
const cardResult = render('artifact-card', React.createElement(parts.ArtifactCard, { a: artifact }))
check('artifact card renders', cardResult.error === null, cardResult.error)
check('artifact card is not a table row', !cardResult.html.includes('<td') && cardResult.html.includes('dga-artiCard'), cardResult.html.slice(0, 160))
check('artifact card shows set, main and CV', cardResult.html.includes('翠绿之影') && cardResult.html.includes('4780') && cardResult.html.includes('39.6'), cardResult.html.slice(0, 200))

const characterFixture = {
  name: '温迪', level: 90, rarity: 5, element: 'Anemo', elementZh: '风', weaponType: 'bow', weaponTypeZh: '弓',
  constellation: 0, talents: { auto: 9, skill: 9, burst: 9 }, stats: null,
  weapon: { name: '终末嗟叹之诗', level: 90, rarity: 5, refinement: 1 },
  artifacts: [artifact], sets: [], setEffects: [],
}
const detailResult = render('character-detail', React.createElement(parts.CharacterDetail, { character: characterFixture, onExport: () => {} }))
check('character detail renders', detailResult.error === null, detailResult.error)
check('character detail uses the card grid', detailResult.html.includes('dga-artiGrid'), detailResult.html.slice(0, 200))
check('character detail has no artifact table', !/圣遗物[^<]*<\/div><table/.test(detailResult.html), 'still a table')

const analysis = {
  total: 500, five: 8, four: 60, averageFive: 62.5, expectedAverage: 62.5, luck: 1, uid: '188337967',
  updatedAt: Date.now(), lastPullAt: '2026-10-01 12:00:00',
  banners: [{ type: '301', label: '角色活动', pulls: 300, five: 5, four: 40, sinceFive: 12 }],
  fiveStars: [{ id: '1', name: '芙宁娜', banner: '角色活动', pity: 23, time: '2026-09-30 10:00:00', rank_type: '5' }],
  monthly: [{ month: '2026-09', pulls: 120 }, { month: '2026-10', pulls: 80 }],
  pityBuckets: [{ label: '0-30', min: 0, max: 30, count: 3 }, { label: '31-60', min: 31, max: 60, count: 2 }],
  biggestBanner: 300,
}
const gachaResult = render('gacha', React.createElement(parts.GachaTab, { analysis, busy: false, status: '', url: '', onUrl: () => {}, onSync: () => {}, onSyncManual: () => {} }))
check('gacha dashboard renders', gachaResult.error === null, gachaResult.error)
check('gacha dashboard shows the rarity mix', gachaResult.html.includes('星级分布'), gachaResult.html.slice(0, 200))
check('gacha dashboard charts months', gachaResult.html.includes('dga-monthChart'), gachaResult.html.slice(0, 200))
check('gacha dashboard shows pity progress', gachaResult.html.includes('保底进度') && gachaResult.html.includes('dga-pityFill'), gachaResult.html.slice(0, 200))

const gachaEmpty = render('gacha-empty', React.createElement(parts.GachaTab, { analysis: null, busy: false, status: '', url: '', onUrl: () => {}, onSync: () => {}, onSyncManual: () => {} }))
check('empty wish history renders the guide', gachaEmpty.error === null && gachaEmpty.html.includes('怎么拿到祈愿记录'), gachaEmpty.error || gachaEmpty.html.slice(0, 160))
check('guide mentions authkey', gachaEmpty.html.includes('authkey'), 'no authkey hint')

const roster = { characters: [
  { id: '1', name: '温迪', icon: '', element: 'anemo', elementZh: '风', rarity: 5, level: 90, constellation: 0, showcase: true },
  { id: '2', name: '钟离', icon: '', element: 'geo', elementZh: '岩', rarity: 5, level: 90, constellation: 0, showcase: false },
] }
const listResult = render('characters', React.createElement(parts.CharactersTab, { summary: roster, query: '', onQuery: () => {}, selected: null, loading: false, onSelect: () => {}, onExport: () => {} }))
check('character list renders', listResult.error === null, listResult.error)
check('showcase badge is rendered', listResult.html.includes('dga-showcaseTag'), listResult.html.slice(0, 200))
check('showcase character comes first', listResult.html.indexOf('温迪') < listResult.html.indexOf('钟离'), 'order')
// A second render must not violate hook order (same component, same tree).
const again = render('page-again', React.createElement(page.component, {}))
check('page renders twice (hook order stable)', again.error === null, again.error)

console.log('page html bytes:', pageResult.html.length)
console.log('icon html:', iconResult.html.slice(0, 120))
console.log('css tags injected:', headChildren.length)

if (fails.length) {
  console.error('\nFAILED:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
