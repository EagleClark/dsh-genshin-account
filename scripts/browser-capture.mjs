/**
 * Capture whatever the official 战绩 page itself fetches.
 *
 * The record API answers `1034` to every hand-made request (including from a
 * logged-in browser), so the only supported way in is to let the official page
 * run its own request - including any slider that page asks the user to solve -
 * and read the response off the wire.
 *
 * This script attaches to the Edge instance started by browser-probe.mjs,
 * enables the Network domain, and writes every `game_record` / `api-takumi`
 * JSON response body to `captured/`.
 *
 * Usage:
 *   node scripts/browser-capture.mjs [seconds]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 9333
const DURATION_SECONDS = Number(process.argv[2] || 240)
const OUT_DIR = 'captured'
const MATCH = /game_record|api-takumi|character|reliquar/i

mkdirSync(OUT_DIR, { recursive: true })

async function findPage() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
  return (
    targets.filter((target) => target.type === 'page').find((target) => /mihoyo|miyoushe/.test(target.url)) ||
    targets.find((target) => target.type === 'page')
  )
}

async function connect(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  const listeners = []
  let nextId = 0
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
      return
    }
    for (const listener of listeners) listener(message)
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', reject)
  })
  return {
    send(method, params = {}) {
      return new Promise((resolve) => {
        const id = (nextId += 1)
        pending.set(id, resolve)
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    on(listener) {
      listeners.push(listener)
    },
    close() {
      socket.close()
    },
  }
}

const page = await findPage()
if (!page) {
  console.error('没有可用的页面，请先运行 node scripts/browser-probe.mjs open')
  process.exit(1)
}
console.log('监听页面：' + page.url)

const client = await connect(page.webSocketDebuggerUrl)
await client.send('Network.enable', { maxTotalBufferSize: 100 * 1024 * 1024, maxPostDataSize: 4 * 1024 * 1024 })
console.log('Network 已开启，请在弹出的浏览器窗口里扫码登录并打开「角色详情」，' + DURATION_SECONDS + ' 秒内自动收集…')

const seen = new Map()
let saved = 0

client.on(async (message) => {
  if (message.method === 'Network.responseReceived') {
    const { requestId, response } = message.params
    if (!response || !MATCH.test(response.url)) return
    if (!/json|text/i.test(response.mimeType || '')) return
    seen.set(requestId, response.url)
    return
  }
  if (message.method === 'Network.loadingFinished') {
    const url = seen.get(message.params.requestId)
    if (!url) return
    seen.delete(message.params.requestId)
    const body = await client.send('Network.getResponseBody', { requestId: message.params.requestId })
    const text = body.result && body.result.body
    if (!text) return
    if (!/retcode|"data"/.test(text)) return
    saved += 1
    const name = String(saved).padStart(3, '0') + '-' + url.split('/').pop().split('?')[0].replace(/[^\w.-]/g, '_') + '.json'
    writeFileSync(join(OUT_DIR, name), text, 'utf8')
    let summary = ''
    try {
      const parsed = JSON.parse(text)
      summary = 'retcode=' + parsed.retcode
      const list = (parsed.data && (parsed.data.list || parsed.data.avatars)) || []
      if (list.length) {
        summary += ' | 条目=' + list.length
        const first = list[0]
        if (first && first.reliquaries && first.reliquaries[0]) {
          summary += ' | 圣遗物字段=' + Object.keys(first.reliquaries[0]).join(',')
        }
      }
    } catch {
      /* keep the raw file even when it is not JSON we understand */
    }
    console.log('  [' + name + '] ' + url.slice(0, 90) + ' -> ' + summary)
  }
})

// Nudge the page so it re-issues its own requests.
await client.send('Page.enable')
await client.send('Page.reload', { ignoreCache: true })
console.log('（已刷新页面，请在上面的窗口里完成扫码）')

setTimeout(() => {
  console.log('\n结束，共保存 ' + saved + ' 个响应到 ' + OUT_DIR + '/')
  client.close()
  process.exit(0)
}, DURATION_SECONDS * 1000)
