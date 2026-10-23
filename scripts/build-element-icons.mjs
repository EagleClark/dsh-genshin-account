/**
 * Turn the webp element masters in data/element-icons into the 96px PNG data URLs
 * embedded in client/client.js.
 *
 * The panel needs the symbols at 22px and works offline, so shipping them inside
 * the bundle beats a route plus a file read. Run this only when the masters
 * change; the output is pasted by the script (it rewrites the ELEMENT_ICON_DATA
 * literal in place).
 *
 * Dev-only, needs Edge:
 *   node scripts/build-element-icons.mjs
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

const KEYS = ['pyro', 'hydro', 'anemo', 'electro', 'cryo', 'geo', 'dendro']
const root = join(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const masterDir = join(root, 'data', 'element-icons')
const clientPath = join(root, 'client', 'client.js')
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

for (const key of KEYS) {
  if (!existsSync(join(masterDir, key + '.webp'))) {
    console.error('缺少母图:', key + '.webp')
    process.exit(1)
  }
}

const server = createServer((req, res) => {
  const key = (new URL(req.url, 'http://x').pathname.replace('/', '') || '').replace(/\.webp$/, '')
  if (!key) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><meta charset=utf-8><body>ready</body>')
    return
  }
  try {
    const body = readFileSync(join(masterDir, key + '.webp'))
    res.writeHead(200, { 'content-type': 'image/webp' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:' + server.address().port

const edge = EDGE_CANDIDATES.find((path) => existsSync(path))
if (!edge) {
  console.error('找不到 msedge.exe')
  process.exit(1)
}
const port = 9527
const child = spawn(edge, [
  '--headless=new', '--disable-gpu',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(process.env.TEMP || '.', 'dsh-elemconv')}`,
  'about:blank',
], { detached: true, stdio: 'ignore' })
child.unref()

let targets = null
for (let attempt = 0; attempt < 40; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 400))
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    if (targets.some((target) => target.type === 'page' && target.webSocketDebuggerUrl)) break
  } catch {
    /* not up yet */
  }
}
const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
const socket = new WebSocket(page.webSocketDebuggerUrl)
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
await send('Runtime.enable')
await send('Page.navigate', { url: origin + '/' })
await new Promise((resolve) => setTimeout(resolve, 1500))

const result = await send('Runtime.evaluate', {
  expression: `(async () => {
    const keys = ${JSON.stringify(KEYS)};
    const out = {};
    for (const key of keys) {
      const img = new Image();
      img.src = '/' + key + '.webp';
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 96;
      canvas.getContext('2d').drawImage(img, 0, 0, 96, 96);
      out[key] = canvas.toDataURL('image/png');
    }
    return JSON.stringify(out);
  })()`,
  awaitPromise: true,
  returnByValue: true,
})
socket.close()
server.close()
try {
  spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
} catch {
  /* already gone */
}

const value = result.result && result.result.result && result.result.result.value
if (!value) {
  console.error('转换失败:', JSON.stringify(result.result).slice(0, 300))
  process.exit(1)
}
const map = JSON.parse(value)

// Rewrite the literal in the bundle.
const source = readFileSync(clientPath, 'utf8')
const start = source.indexOf('  var ELEMENT_ICON_DATA = {')
if (start < 0) {
  console.error('client.js 里找不到 ELEMENT_ICON_DATA')
  process.exit(1)
}
const close = source.indexOf('\n  };', start)
if (close < 0) {
  console.error('ELEMENT_ICON_DATA 没有闭合')
  process.exit(1)
}
const literal = JSON.stringify(map, null, 2).split('\n').map((line, index) => (index === 0 ? line : '  ' + line)).join('\n')
// `close` is the newline before the literal's closing `  };` — skip all five
// characters or the replacement leaves a stray brace behind.
const next = source.slice(0, start) + '  var ELEMENT_ICON_DATA = ' + literal + ';' + source.slice(close + 5)
writeFileSync(clientPath, next, 'utf8')

const total = Object.values(map).reduce((sum, value) => sum + value.length, 0)
console.log('已更新 client.js：' + KEYS.length + ' 个图标，共 ' + Math.round(total / 1024) + 'KB')
