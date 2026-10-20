/**
 * Real-DOM mount check for the browser bundle — the check that a blanked shell
 * would need to be caught by.
 *
 * `test/render-check.mjs` renders to a string, so it never runs effects.
 * This one mounts the registered page with the real React DOM client inside
 * jsdom, runs its effects (which is where fetches, the Config-form lookup and
 * the state updates happen), and reports any thrown error or console error.
 *
 * Dev-only:
 *   npm i --prefix %TEMP%\ga-react react@18 react-dom@18 jsdom
 *   REACT_DIR=%TEMP%\ga-react node test/mount-check.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const reactDir = process.env.REACT_DIR || join(here, '..', 'node_modules')
const require = createRequire(join(reactDir, 'noop.js'))

let React, ReactDOM, ReactDOMClient, JSDOM
try {
  React = require('react')
  ReactDOM = require('react-dom')
  ReactDOMClient = require('react-dom/client')
  JSDOM = require('jsdom').JSDOM
} catch (error) {
  console.error('SKIP: react / react-dom / jsdom not resolvable from', reactDir)
  process.exit(0)
}

const fails = []
const check = (name, condition, detail) => {
  if (!condition) fails.push(name + (detail ? ' :: ' + detail : ''))
}

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:43129/',
  pretendToBeVisual: true,
})
const { window } = dom
globalThis.window = window
globalThis.document = window.document
// Node's global `navigator` is getter-only; define a configurable copy instead.
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
globalThis.HTMLElement = window.HTMLElement
globalThis.Node = window.Node
globalThis.MutationObserver = window.MutationObserver

// Surface anything React would print before it unmounts a tree.
const consoleErrors = []
const originalError = console.error
console.error = (...args) => {
  const text = args.map((a) => (a && a.message) || String(a)).join(' ')
  // Harness noise from calling act() outside a test framework, not app errors.
  if (text.includes('not configured to support act') || text.includes('ReactDOMTestUtils.act') || text.includes('not wrapped in act')) return
  consoleErrors.push(text)
  originalError(...args)
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The host routes the page calls; enough shapes to exercise every branch.
const responses = {
  '/summary': { ok: false, error: '还没有配置 GOOD 文件路径。', state: { source: 'good', configured: false, fetchedAt: 0, config: { source: 'good', goodPath: '' }, sources: { good: { configured: false }, enka: { configured: false }, miyoushe: { configured: false } } } },
  '/state': { source: 'good', configured: false },
}
globalThis.fetch = (url) => {
  const path = String(url).replace('/dsh-genshin-account', '')
  const body = responses[path.split('?')[0]] || { ok: false, error: 'not stubbed: ' + path }
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
}

let captured = null
window.__ModuleLoader__ = {
  load: (entry) => {
    captured = entry
  },
}

const source = readFileSync(join(here, '..', 'client', 'client.js'), 'utf8')
const factory = new Function('window', 'document', 'fetch', 'require', 'module', 'exports', source)
const moduleObject = { exports: {} }
factory(window, window.document, globalThis.fetch, (spec) => {
  if (spec === 'react') return React
  throw new Error('unexpected require: ' + spec)
}, moduleObject, moduleObject.exports)

const clientModule = captured.factory((spec) => {
  if (spec === 'react') return React
  throw new Error('unexpected require: ' + spec)
})

const registrations = []
const form = {
  getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value: { source: 'good' } }),
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
clientModule.apply(ctx)

const page = registrations.find((entry) => entry.options.name === 'main')

// React 18's client renderer is concurrent: wrap in act() so effects flush.
const { act } = require('react-dom/test-utils')

let thrown = null
const root = ReactDOMClient.createRoot(window.document.getElementById('root'))
try {
  act(() => {
    root.render(React.createElement(page.component, {}))
  })
} catch (error) {
  thrown = error
}

check('mount does not throw', thrown === null, thrown && thrown.message)

const html = window.document.getElementById('root').innerHTML
check('app mounted content', html.length > 200, String(html.length))
check('wizard is the landing view', html.includes('dga-src'), html.slice(0, 160))
check('three source cards rendered', (html.match(/class="dga-src(?=[" ])/g) || []).length === 3,
  String((html.match(/class="dga-src(?=[" ])/g) || []).length))
check('no React console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

// Effects resolve as microtasks; let them land before judging the tree.
await new Promise((resolve) => setTimeout(resolve, 60))
const settled = window.document.getElementById('root').innerHTML
check('tree survives effect resolution', settled.length > 200, String(settled.length))
check('no unhandled console error after effects', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

// Clicking "保存并同步" must not throw even when the write path is stubbed.
let clickThrown = null
try {
  const buttons = [...window.document.querySelectorAll('button')]
  const save = buttons.find((b) => b.textContent === '保存并同步')
  check('save button present', Boolean(save))
  if (save) {
    act(() => {
      save.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
  }
} catch (error) {
  clickThrown = error
}
check('save click does not throw', clickThrown === null, clickThrown && clickThrown.message)

console.log('mounted html bytes:', html.length)
console.log('console errors:', consoleErrors.length)

if (fails.length) {
  console.error('\nFAILED:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
