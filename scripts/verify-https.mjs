/**
 * Serve the verification page over HTTPS.
 *
 * Why: GeeTest v3 behaves differently on plain http — it can skip the encrypted
 * path, produce a validate that its own server then refuses, and miHoYo answers
 * retcode 10306 even though the slider "worked". Every tool that reads artifact
 * sub-stats does this inside a WebView that loads the page over https, so this
 * script reproduces that condition locally with a self-signed certificate.
 *
 *   node scripts/verify-https.mjs [port]
 */
import { createServer } from 'node:https'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { renderVerifyPage } from '../lib/verify-page.js'

const PORT = Number(process.argv[2]) || 43191
const UPSTREAM = 'http://127.0.0.1:43129'
const PFX = join(tmpdir(), 'dga-verify.pfx')
const PASS = 'dga-verify'

if (!existsSync(PFX)) {
  // Generating a self-signed cert without extra dependencies: let PowerShell
  // make it and export a PFX, which Node's https server accepts directly.
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$c = New-SelfSignedCertificate -DnsName '127.0.0.1','localhost' -CertStoreLocation 'Cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddYears(1);` +
        `$p = ConvertTo-SecureString -String '${PASS}' -Force -AsPlainText;` +
        `Export-PfxCertificate -Cert $c -FilePath '${PFX}' -Password $p | Out-Null`,
    ],
    { stdio: 'inherit' },
  )
}

const server = createServer({ pfx: readFileSync(PFX), passphrase: PASS }, async (req, res) => {
  const url = new URL(req.url, `https://127.0.0.1:${PORT}`)

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/verify')) {
    const html = renderVerifyPage(url.searchParams.get('purpose') || 'index')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(html)
    return
  }

  if (req.method === 'POST' && url.pathname.startsWith('/dsh-genshin-account/')) {
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
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'access-control-allow-origin': '*',
      })
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
  console.log(`HTTPS 验证页: https://127.0.0.1:${PORT}/`)
  console.log('证书是自签的，浏览器会警告，选择"继续前往"即可。')
})
