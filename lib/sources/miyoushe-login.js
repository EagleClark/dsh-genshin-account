/**
 * 米游社 QR login (国服) — the only way to get a session this plugin owns.
 *
 * Why this exists: the record API answers `retcode 1034` (captcha) whenever a
 * session created somewhere else is replayed from here. A session we create
 * ourselves, with our own device id, is not a replay — that is exactly what
 * 胡桃工具箱 and friends do, and it is also the only approach that does not
 * require the user to hand over a password or a copied cookie.
 *
 * Documented flow (UIGF API collection → 米游社 → Login → 米游社扫码登录):
 *   1. POST {passport}/account/ma-cn-passport/web/createQRLogin
 *        headers: x-rpc-app_id: bll8iq97cem8, x-rpc-device_id
 *        → data.url (what the QR encodes), data.ticket
 *   2. POST {passport}/account/ma-cn-passport/web/queryQRLoginStatus  {ticket}
 *        → data.status: Created | Scanned | Confirmed
 *      On Confirmed the **Set-Cookie** headers carry ltoken_v2 / ltmid_v2 /
 *      account id, i.e. the session itself — no ticket exchange step.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import QRCode from 'qrcode'

const PASSPORT = 'https://passport-api.miyoushe.com/account/ma-cn-passport/web'
const APP_ID = 'bll8iq97cem8'

/** Cookies worth keeping: the record API needs these three (or their v1 forms). */
const WANTED_COOKIES = [
  'ltuid_v2',
  'ltoken_v2',
  'ltmid_v2',
  'ltuid',
  'ltoken',
  'ltmid',
  'account_id_v2',
  'account_id',
  'cookie_token_v2',
  'cookie_token',
]

/**
 * Turn `Set-Cookie` headers into one `k=v; k=v` cookie string.
 *
 * Reads the name/value out of each header's first `;` segment; attributes
 * (`Path`, `Expires`, …) are dropped. Pure, so it is unit-tested directly.
 */
export function cookieFromSetCookie(headers) {
  const jar = new Map()
  for (const header of headers || []) {
    if (typeof header !== 'string') continue
    const first = header.split(';')[0]
    const index = first.indexOf('=')
    if (index <= 0) continue
    const name = first.slice(0, index).trim()
    const value = first.slice(index + 1).trim()
    if (!WANTED_COOKIES.includes(name)) continue
    if (!value) continue
    jar.set(name, value)
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

const deviceFile = () => {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'data', 'dsh-genshin-account', 'device-id.txt')
}

/**
 * ONE device id for the whole login flow.
 *
 * Creating the QR and polling it with different ids is what miHoYo reports as
 * `retcode -3503 当前设备或网络环境存在风险`: to the server it looks like two
 * different devices touching the same ticket. Shared with the record-API source
 * (same file) so a login and the calls that follow it look like one device.
 */
let deviceCache = ''
function stableDeviceId() {
  if (deviceCache) return deviceCache
  try {
    const stored = readFileSync(deviceFile(), 'utf8').trim()
    if (stored) {
      deviceCache = stored
      return deviceCache
    }
  } catch {
    /* first run */
  }
  let out = ''
  for (let i = 0; i < 16; i++) out += '0123456789abcdef'[(Math.random() * 16) | 0]
  try {
    mkdirSync(dirname(deviceFile()), { recursive: true })
    writeFileSync(deviceFile(), out, 'utf8')
  } catch {
    /* in-memory is enough for this run */
  }
  deviceCache = out
  return deviceCache
}

const headers = () => ({
  'x-rpc-app_id': APP_ID,
  'x-rpc-device_id': stableDeviceId(),
  'content-type': 'application/json',
  accept: 'application/json',
  origin: 'https://user.mihoyo.com',
  referer: 'https://user.mihoyo.com/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
})

/** Create one login QR. @returns {{ url: string, ticket: string, svg: string }} */
export async function createQr({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl(PASSPORT + '/createQRLogin', { method: 'POST', headers: headers(), body: '{}' })
  const json = await res.json().catch(() => null)
  if (!json || json.retcode !== 0 || !json.data || !json.data.url) {
    throw new Error(
      `创建二维码失败：retcode=${json && json.retcode}，${(json && json.message) || '无返回'}。` +
        '（如果提示缺少请求头 -3001，说明 x-rpc-app_id / x-rpc-device_id 没被接受。）',
    )
  }
  const url = String(json.data.url)
  const ticket = String(json.data.ticket || '')
  // Rendered here rather than in the page: the QR has to encode the exact URL,
  // and the encoder is verified by decoding it back in the test suite.
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 260 })
  return { url, ticket, svg }
}

/**
 * Poll one QR ticket.
 * @returns {{ status: 'Created'|'Scanned'|'Confirmed'|'Expired'|'Canceled', cookie?: string, uid?: string }}
 */
export async function pollQr(ticket, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(PASSPORT + '/queryQRLoginStatus', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ticket }),
  })
  const json = await res.json().catch(() => null)
  if (!json) throw new Error('查询扫码状态失败：返回不是 JSON')
  // -3501 expired, -3505 canceled — both mean "generate a new QR".
  if (json.retcode === -3501) return { status: 'Expired' }
  if (json.retcode === -3505) return { status: 'Canceled' }
  if (json.retcode !== 0) {
    throw new Error(`查询扫码状态失败：retcode=${json.retcode}，${json.message || '无返回'}`)
  }
  const status = json.data && json.data.status ? String(json.data.status) : 'Created'
  if (status !== 'Confirmed') return { status }
  const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  const cookie = cookieFromSetCookie(setCookie)
  const uid = json.data && json.data.user_info && json.data.user_info.aid ? String(json.data.user_info.aid) : ''
  if (!cookie) {
    throw new Error(
      '登录已确认，但响应里没有拿到 Cookie（Set-Cookie 为空）。可能这次登录没有携带 token_types=4，请重新生成二维码再扫。',
    )
  }
  return { status, cookie, uid }
}
