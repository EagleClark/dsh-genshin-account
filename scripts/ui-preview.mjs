/**
 * Render the real panel in a real browser, against a snapshot of the real host
 * payloads, and screenshot it.
 *
 * Why: the GUI itself needs its boot token, and the plugin's tabs only fill in
 * after effects run, so neither `renderToStaticMarkup` nor a plain page load can
 * show what the panel actually looks like. This script mounts the bundle with
 * the genuine React reconciler in headless Edge, feeds it JSON captured from the
 * running host, clicks a tab and captures the result.
 *
 * Dev-only. Needs react + react-dom resolvable (REACT_DIR), Edge, and a running
 * host to copy payloads from.
 *
 *   REACT_DIR=%TEMP%\ga-react node scripts/ui-preview.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync as fileExists } from 'node:fs'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(tmpdir(), 'dsh-genshin-preview')
mkdirSync(outDir, { recursive: true })

const HOST = process.env.DSH_HOST_URL || 'http://127.0.0.1:43129'
const API = '/dsh-genshin-account'
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

async function grab(path) {
  const res = await fetch(HOST + API + path)
  if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status)
  return res.json()
}

// --- payloads ---------------------------------------------------------------
// Two modes:
//  - default: copy what the running host serves (it must already hold a snapshot)
//  - PREVIEW_LOCAL=1: build the snapshot here from the repo code, so a fix can be
//    looked at before it is installed and the host restarted.
const LOCAL = process.env.PREVIEW_LOCAL === '1'

async function buildLocal() {
  const fs = await import('node:fs')
  const url = await import('node:url')
  const model = await import(url.pathToFileURL(join(root, 'lib', 'model.js')).href)
  const calc = await import(url.pathToFileURL(join(root, 'lib', 'sources', 'miyoushe-calc.js')).href)
  const microgg = await import(url.pathToFileURL(join(root, 'lib', 'sources', 'microgg.js')).href)
  const { readFileSync } = fs
  const patchPath = join(
    process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
    'dsh-desktop', 'harness', 'profiles', 'web', 'cordis.patch.yml',
  )
  const raw = readFileSync(patchPath, 'utf8')
  const block = raw.slice(raw.indexOf('miyousheCookie:') + 14).split(/\n\s{0,8}(?=[a-zA-Z][A-Za-z0-9]*:\s)/)[0]
  const cookie = block.replace(/\s*\n\s*/g, ' ').trim().replace(/^["']|["']$/g, '').replace(/;\s*$/, '').replace(/^:\s*/, '')
  const uid = (raw.match(/miyousheUid:\s*["']?(\d{9})/) || [])[1] || ''
  const cfg = { miyousheUid: uid, miyousheServer: 'cn_gf01', miyousheCookie: cookie }

  const base = await calc.fetchSnapshot(cfg)
  const showcaseUid = base.uid || cfg.miyousheUid
  const storageDir = join(
    process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
    'dsh-desktop', 'harness', 'data', 'dsh-genshin-account',
  )
  const showcase = await microgg.fetchShowcase(showcaseUid, {
    cacheFile: showcaseUid ? join(storageDir, 'showcase-' + showcaseUid + '.json') : '',
  })
  const snapshot = showcase.builds.length ? microgg.mergeShowcase(base, showcase) : base

  const characters = model.listCharacters(snapshot, {})
  const chosen = characters.find((c) => c.showcase) || characters[0]
  const found = chosen ? model.getCharacter(snapshot, chosen.name) : { error: '无角色' }
  return {
    '/state': {
      source: snapshot.source,
      configured: true,
      hasSnapshot: true,
      fetchedAt: snapshot.fetchedAt,
      error: '',
      stale: false,
      cacheSeconds: 600,
      note: snapshot.note,
      uid: snapshot.uid,
      config: { source: snapshot.source, miyousheUid: snapshot.uid, hasCookie: true, cacheSeconds: 600 },
      version: PKG_VERSION,
      repo: 'https://github.com/EagleClark/dsh-genshin-account',
      blog: 'https://eagle90.com',
    },
    '/summary': {
      ok: true,
      state: {
        source: snapshot.source, uid: snapshot.uid, fetchedAt: snapshot.fetchedAt, configured: true, note: snapshot.note,
        version: PKG_VERSION, repo: 'https://github.com/EagleClark/dsh-genshin-account', blog: 'https://eagle90.com',
      },
      overview: model.overview(snapshot),
      characters,
    },
    '/weapons': { ok: true, weapons: model.listWeapons(snapshot, { limit: 100 }) },
    '/character': found.error ? { ok: false, error: found.error } : { ok: true, character: model.characterView(snapshot, found) },
  }
}

// Wish history：本地模式下用本地代码重算，否则新字段（分档 / 歪）看不到
const GACHA_STORE = join(
  process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
  'dsh-desktop', 'harness', 'data', 'dsh-genshin-account',
)

let gacha = null
if (LOCAL) {
  const gachaMod = await import('../lib/sources/miyoushe-gacha.js')
  let uidForGacha = ''
  try {
    uidForGacha = JSON.parse(readFileSync(join(GACHA_STORE, 'snapshot-miyoushe.json'), 'utf8')).uid || ''
  } catch {
    /* no snapshot is fine */
  }
  gacha = { ok: true, analysis: gachaMod.analyze(gachaMod.readRecords(uidForGacha)) }
} else {
  try {
    gacha = await grab('/gacha')
  } catch {
    /* no wish history yet is fine */
  }
}

const local = LOCAL ? await buildLocal() : null
const state = local ? local['/state'] : await grab('/state')
const summary = local ? local['/summary'] : await grab('/summary')
const weapons = local ? local['/weapons'] : await grab('/weapons')

// A showcase character has artifacts; fall back to the first one either way.
const withArtifacts = (summary.characters || []).find((c) => c.showcase) || (summary.characters || [])[0]
const character = local
  ? local['/character']
  : withArtifacts
    ? await grab('/character?name=' + encodeURIComponent(withArtifacts.name))
    : null

if (process.env.PREVIEW_DEBUG) console.log('gacha fixture:', gacha && gacha.ok, gacha && gacha.analysis && gacha.analysis.total)
const fixtures = {
  '/state': state,
  '/summary': summary,
  '/weapons': weapons,
  '/gacha': gacha || { ok: false, error: 'no wish history' },
  '/character': character || { ok: false },
}
// --- assets -----------------------------------------------------------------
const reactDir = process.env.REACT_DIR || join(root, 'node_modules')
const pick = (relative) => {
  const path = join(reactDir, 'node_modules', relative)
  if (!existsSync(path)) throw new Error('missing ' + path + ' (set REACT_DIR)')
  return readFileSync(path, 'utf8')
}
const bundle = readFileSync(join(root, 'client', 'client.js'), 'utf8')

// --- one html per tab -------------------------------------------------------
const TABS = [
  { index: 0, name: 'overview' },
  { index: 1, name: 'characters' },
  { index: 2, name: 'gacha' },
  { index: 3, name: 'weapons' },
  { index: 4, name: 'settings' },
  { index: 5, name: 'about' },
]

const THEME = process.env.PREVIEW_THEME === 'light' ? 'light' : 'dark'

// Token values copied from the desktop shell. Light mode paints every layer
// white, which is exactly why the panel must not rely on background contrast.
const TOKENS = THEME === 'light'
  ? `
    --dsw-alias-bg-base:#ffffff;
    --dsw-alias-bg-layer-1:#ffffff;
    --dsw-alias-bg-layer-2:#ffffff;
    --dsw-alias-bg-layer-3:#f5f6f7;
    --dsw-alias-bg-overlay:#f5f6f7;
    --dsw-alias-bg-module-platform:#f5f6f7;
    --dsw-alias-border-l1:rgba(0,0,0,.04);
    --dsw-alias-border-l2:rgba(0,0,0,.10);
    --dsw-alias-label-primary:#0f1115;
    --dsw-alias-label-secondary:#61666b;
    --dsw-alias-label-tertiary:#81858c;
    --dsw-alias-label-dimmed:#c7ccd6;
    --dsw-alias-brand-primary:#0f1115;
    --dsw-alias-interactive-bg-hover:rgba(38,49,72,.06);
    --dsw-alias-state-success-primary:#22c55e;
    --dsw-alias-state-error-primary:#d92c2c;`
  : `
    --dsw-alias-bg-base:#151517;
    --dsw-alias-bg-layer-1:#1b1b1c;
    --dsw-alias-bg-layer-2:#232325;
    --dsw-alias-bg-layer-3:#2c2c2f;
    --dsw-alias-bg-overlay:#2c2c2f;
    --dsw-alias-bg-module-platform:#232325;
    --dsw-alias-border-l1:#ffffff14;
    --dsw-alias-border-l2:#ffffff26;
    --dsw-alias-label-primary:#f5f6f7;
    --dsw-alias-label-secondary:#a9adb3;
    --dsw-alias-label-tertiary:#81858c;
    --dsw-alias-label-dimmed:#54565a;
    --dsw-alias-brand-primary:#4d93f8;
    --dsw-alias-interactive-bg-hover:#ffffff12;
    --dsw-alias-state-success-primary:#22c55e;
    --dsw-alias-state-error-primary:#ec1313;`

function page(tabIndex) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  :root{${TOKENS}
  }
  html,body{margin:0;height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
  #root{height:100vh;width:1180px;margin:0 auto;border-left:1px solid var(--dsw-alias-border-l1);border-right:1px solid var(--dsw-alias-border-l1)}
</style>
</head><body${THEME === 'dark' ? ' data-ds-dark-theme' : ''}><div id="root"></div>
<script>const fixtures = ${JSON.stringify(fixtures)}</script>
<script>${pick('react/umd/react.production.min.js')}</script>
<script>${pick('react-dom/umd/react-dom.production.min.js')}</script>
<script>
  window.__ModuleLoader__ = { load: (entry) => { window.__entry = entry } }
  window.fetch = async (url) => {
    const path = String(url).split('?')[0].split('/dsh-genshin-account')[1] || '/'
    const key = path === '/character' ? '/character' : path
    const body = fixtures[key]
    if (body === undefined) return { ok: false, json: async () => ({ ok: false, error: 'no fixture ' + path }) }
    return { ok: true, json: async () => body }
  }
</script>
<script>${bundle}</script>
<script>
  const mod = window.__entry.factory((spec) => (spec === 'react' ? React : undefined))
  const registrations = []
  mod.apply({
    slots: {
      inject: (key, cb) => cb(),
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
    configForms: {
      get: () => ({
        getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value: {} }),
        subscribe: () => () => {},
        mutate: async () => true,
      }),
    },
  })
  const page = registrations.find((entry) => entry.options.name === 'main').component
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(page, {}))
  setTimeout(() => {
    const tabs = [...document.querySelectorAll('.dga-tab')]
    if (tabs[${tabIndex}]) tabs[${tabIndex}].click()
    setTimeout(() => {
      // The characters tab needs a showcase character selected to show cards.
      const rows = [...document.querySelectorAll('.dga-row')]
      const target = rows.find((row) => row.textContent.includes('展柜')) || rows[0]
      if (target && document.querySelector('.dga-detail .dga-empty')) target.click()
      document.title = 'ready'
    }, 900)
  }, 1200)
</script></body></html>`
}

const htmlFiles = []
for (const tab of TABS) {
  const file = join(outDir, `tab-${tab.name}.html`)
  writeFileSync(file, page(tab.index), 'utf8')
  htmlFiles.push(file)
}

// --- screenshot -------------------------------------------------------------
const edge = EDGE_CANDIDATES.find((path) => existsSync(path))
if (!edge) throw new Error('找不到 msedge.exe')

const port = 9455
const child = spawn(edge, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(outDir, 'profile')}`,
  '--window-size=1200,1500',
  'about:blank',
], { detached: true, stdio: 'ignore' })
child.unref()

let targets = null
for (let attempt = 0; attempt < 40; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 400))
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    if (targets.some((t) => t.type === 'page' && t.webSocketDebuggerUrl)) break
  } catch {
    /* not up yet */
  }
}
const target = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
const socket = new WebSocket(target.webSocketDebuggerUrl)
let messageId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
})
await new Promise((resolve) => socket.addEventListener('open', resolve))
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = (messageId += 1)
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
await send('Page.enable')

// --- tiny http server -------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.js': 'text/javascript' }
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname.endsWith('/chartlib') || url.pathname.endsWith('/asset/chart.js')) {
    const file = (() => {
      try {
        const req = createRequire(import.meta.url)
        return join(dirname(req.resolve('chart.js')), 'chart.umd.js')
      } catch {
        return ''
      }
    })()
    if (!file || !fileExists(file)) {
      res.writeHead(404)
      res.end('no chart.js')
      return
    }
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
    res.end(readFileSync(file))
    return
  }
  let target = null
  const asset = url.pathname.match(/^\/dsh-genshin-account\/asset\/element\/([a-z]+\.webp)$/)
  if (asset) target = join(root, 'data', 'element-icons', asset[1])
  else target = join(outDir, url.pathname.replace(/^\//, '') || 'index.html')
  if (!fileExists(target)) {
    res.writeHead(404)
    res.end('missing')
    return
  }
  res.writeHead(200, { 'content-type': MIME[target.slice(target.lastIndexOf('.'))] || 'application/octet-stream' })
  res.end(readFileSync(target))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:' + server.address().port
console.log('预览服务:', origin)

const shots = []
for (const file of htmlFiles) {
  await send('Page.navigate', { url: origin + '/' + file.split(/[\\/]/).pop() })
  await new Promise((resolve) => setTimeout(resolve, 6200))
  // Wait for the tab's own content: the weapons tab fetches its rows after the
  // summary lands, and "no skeleton" is already true before React mounts.
  const readySelector = file.includes('tab-weapons')
    ? '.dga-wCard'
    : file.includes('tab-characters')
      ? '.dga-detail, .dga-empty'
      : '.dga-root'
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const ready = await send('Runtime.evaluate', {
      expression: "!!document.querySelector('" + readySelector + "') && !document.querySelector('.dga-skel')",
      returnByValue: true,
    })
    if (ready.result && ready.result.result && ready.result.result.value) break
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  const name = 'ui-' + THEME + '-' + file.split('tab-')[1].replace('.html', '') + '.png'
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  if (shot.result && shot.result.data) {
    writeFileSync(join(outDir, name), Buffer.from(shot.result.data, 'base64'))
    shots.push(name)
  }
}
socket.close()
server.close()
try {
  spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
} catch {
  /* already gone */
}
console.log('预览目录:', outDir)
console.log('截图:', shots.join(', '))
