/**
 * Standalone verification page for testing without restarting DSH.
 *
 * It serves the plugin's newest verification page and proxies the three
 * endpoints it needs to the *running* plugin, so the token lands in that live
 * process and the next sync can use it.
 *
 *   node scripts/verify-standalone.mjs [port]
 *
 * Then open the printed URL, drag the slider, and go back to the plugin's 抽卡 /
 * 角色 page — no restart needed to prove the widget renders.
 */
import { createServer } from 'node:http'
import { renderVerifyPage } from '../lib/verify-page.js'
import { renderLabPage } from '../lib/verify-lab.js'

const PORT = Number(process.argv[2]) || 43190
const UPSTREAM = 'http://127.0.0.1:43129'
const PROXY_PATHS = new Set(['/dsh-genshin-account/verify/start', '/dsh-genshin-account/verify/finish', '/dsh-genshin-account/diag'])

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)

  if (req.method === 'GET' && url.pathname === '/lab') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(renderLabPage())
    return
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/verify')) {
    const html = renderVerifyPage(url.searchParams.get('purpose') || 'index')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(html)
    return
  }

  if (req.method === 'POST' && PROXY_PATHS.has(url.pathname)) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    try {
      const upstream = await fetch(UPSTREAM + url.pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body || '{}',
      })
      const text = await upstream.text()
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' })
      res.end(text)
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: '无法连接运行中的插件：' + ((error && error.message) || error) }))
    }
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`验证页（独立）: http://127.0.0.1:${PORT}/`)
  console.log(`诊断页: http://127.0.0.1:${PORT}/lab`)
  console.log(`代理到运行中的插件: ${UPSTREAM}`)
})
