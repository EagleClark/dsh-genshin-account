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
