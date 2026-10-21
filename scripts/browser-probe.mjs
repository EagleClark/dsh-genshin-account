/**
 * Fetch the miHoYo game-record API from inside a real Edge page.
 *
 * Why: the API answers `1034` (captcha required) to plain Node requests, but the
 * same request sent from a page on the official domain carries the browser's
 * whole session and is the one shape we have not disproved. This script drives a
 * dedicated Edge profile over CDP so the request really comes from a page.
 *
 * Usage:
 *   node scripts/browser-probe.mjs open     # open the browser so you can log in
 *   node scripts/browser-probe.mjs probe    # run the request and print the result
 *   node scripts/browser-probe.mjs close    # shut the browser down
 *
 * The profile lives under the user data directory, so a single QR login is
 * enough for every later probe.
 */
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PORT = 9333
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const PROFILE_DIR = join(
  process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
  'dsh-genshin-account',
  'browser-profile',
)

const SALT = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs'
const X_RPC_APP_VERSION = '2.26.1'

function edgePath() {
  const found = EDGE_CANDIDATES.find((path) => existsSync(path))
  if (!found) throw new Error('找不到 msedge.exe')
  return found
}

function ds2(query, body = '') {
  const t = Math.round(Date.now() / 1000)
  const r = Math.floor(Math.random() * 900000 + 100000)
  const main = `salt=${SALT}&t=${t}&r=${r}&b=${body}&q=${query}`
  return `${t},${r},${createHash('md5').update(main).digest('hex')}`
}

async function debuggingEndpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return await res.json()
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(`调试端口 ${PORT} 未就绪`)
}

async function pageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const targets = await res.json()
  const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl)
  return pages.find((target) => /miyoushe|mihoyo/.test(target.url)) || pages[0]
}

/** A tiny CDP client: one socket, request/response by id. */
async function connect(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 0
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
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
    close() {
      socket.close()
    },
  }
}

async function openBrowser() {
  mkdirSync(PROFILE_DIR, { recursive: true })
  const child = spawn(
    edgePath(),
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1000,760',
      'https://www.miyoushe.com/ys/',
    ],
    { detached: true, stdio: 'ignore' },
  )
  child.unref()
  await debuggingEndpoint()
  const page = await pageTarget()
  console.log('浏览器已打开（登录状态会保存在：' + PROFILE_DIR + '）')
  console.log('当前页面：' + (page && page.url))
}

async function probe() {
  await debuggingEndpoint()
  const page = await pageTarget()
  if (!page) throw new Error('没有可用的页面目标')
  const client = await connect(page.webSocketDebuggerUrl)
  await client.send('Runtime.enable')

  // Read the cookie names the page can see — useful to prove login happened.
  const cookieCheck = await client.send('Runtime.evaluate', {
    expression: 'document.cookie.split(";").map(s => s.trim().split("=")[0]).join(",")',
    returnByValue: true,
  })

  const calls = [
    {
      label: '/index（账号总览）',
      url: 'https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/index?role_id=188337967&server=cn_gf01',
      query: 'role_id=188337967&server=cn_gf01',
      body: '',
    },
    {
      label: '/character/detail（本色柜圣遗物）',
      url: 'https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/character/detail',
      query: '',
      body: JSON.stringify({ character_ids: [10000046, 10000002, 10000030], role_id: '188337967', server: 'cn_gf01' }),
    },
  ]

  for (const call of calls) {
    const expression = `(async () => {
      try {
        const res = await fetch(${JSON.stringify(call.url)}, {
          method: ${JSON.stringify(call.body ? 'POST' : 'GET')},
          credentials: 'include',
          headers: {
            'x-rpc-app_version': ${JSON.stringify(X_RPC_APP_VERSION)},
            'x-rpc-client_type': '5',
            'DS': ${JSON.stringify(ds2(call.query, call.body))},
            'X-Requested-With': 'com.mihoyo.hyperion',
            'Content-Type': 'application/json',
          },
          ${call.body ? `body: ${JSON.stringify(call.body)},` : ''}
        });
        const text = await res.text();
        return JSON.stringify({ status: res.status, body: text.slice(0, 400) });
      } catch (error) {
        return JSON.stringify({ error: String(error) });
      }
    })()`
    const reply = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    const value = reply.result && reply.result.result && reply.result.result.value
    console.log('\n' + call.label)
    console.log('  ' + (value || JSON.stringify(reply.result && reply.result.exceptionDetails)))
  }

  console.log('\n页面可见 cookie: ' + (cookieCheck.result && cookieCheck.result.result && cookieCheck.result.result.value))
  client.close()
}

async function closeBrowser() {
  try {
    const version = await debuggingEndpoint()
    const browserSocket = version.webSocketDebuggerUrl
    const client = await connect(browserSocket)
    await client.send('Browser.close')
    client.close()
    console.log('浏览器已关闭')
  } catch (error) {
    // Fall back to killing whatever holds the port.
    try {
      const output = execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
      const line = output.split('\n').find((row) => row.includes(`:${PORT}`) && row.includes('LISTENING'))
      const pid = line && line.trim().split(/\s+/).pop()
      if (pid) {
        execFileSync('taskkill', ['/PID', pid, '/T', '/F'])
        console.log('已结束进程 ' + pid)
        return
      }
    } catch {
      /* nothing to close */
    }
    console.log('没有运行中的浏览器：' + ((error && error.message) || error))
  }
}

const command = process.argv[2] || 'probe'
if (command === 'open') await openBrowser()
else if (command === 'probe') await probe()
else if (command === 'close') await closeBrowser()
else {
  console.log('用法: node scripts/browser-probe.mjs <open|probe|close>')
  process.exitCode = 1
}
