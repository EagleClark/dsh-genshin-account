/**
 * QR-login module test — offline, with a stubbed transport:
 *   node test/smoke-login.mjs
 */
import { cookieFromSetCookie, createQr, pollQr } from '../lib/sources/miyoushe-login.js'

const fails = []
const check = (name, condition, detail) => {
  if (!condition) fails.push(name + (detail ? ' :: ' + detail : ''))
}

// --- Set-Cookie parsing -----------------------------------------------------
const jar = cookieFromSetCookie([
  'ltuid_v2=123456789; Path=/; Domain=.miyoushe.com; Expires=Wed, 21 Oct 2026 07:28:00 GMT',
  'ltoken_v2=v2_ABCdef; Path=/; HttpOnly',
  'ltmid_v2=midXYZ; Path=/',
  'aliyungf_tc=should-be-dropped; Path=/',
])
check('parses the session cookies', jar === 'ltuid_v2=123456789; ltoken_v2=v2_ABCdef; ltmid_v2=midXYZ', jar)
check('drops unrelated cookies', !jar.includes('aliyungf_tc'), jar)
check('empty input is safe', cookieFromSetCookie([]) === '')
check('junk input is safe', cookieFromSetCookie([null, '', 'novalue', '=x']) === '')

// --- createQr ---------------------------------------------------------------
const qrResponse = {
  retcode: 0,
  message: 'OK',
  data: { url: 'https://user.mihoyo.com/login-platform/mobile.html?tk=abc&token_types=4#/login/qr', ticket: 'abc' },
}
const qr = await createQr({
  fetchImpl: async () => ({ json: async () => qrResponse }),
})
check('createQr returns the ticket', qr.ticket === 'abc', qr.ticket)
check('createQr returns an svg', typeof qr.svg === 'string' && qr.svg.startsWith('<svg'), String(qr.svg).slice(0, 60))
check('svg is not empty', qr.svg.length > 500, String(qr.svg.length))

const refused = await createQr({
  fetchImpl: async () => ({ json: async () => ({ retcode: -100, message: '请求错误' }) }),
}).catch((error) => ({ error }))
check('createQr surfaces a refusal', refused.error && /创建二维码失败/.test(refused.error.message), String(refused.error && refused.error.message))

// --- pollQr statuses --------------------------------------------------------
const pollWith = (body, setCookies = []) => ({
  fetchImpl: async () => ({
    json: async () => body,
    headers: { getSetCookie: () => setCookies },
  }),
})

check('Created', (await pollQr('t', pollWith({ retcode: 0, data: { status: 'Created' } }))).status === 'Created')
check('Scanned', (await pollQr('t', pollWith({ retcode: 0, data: { status: 'Scanned' } }))).status === 'Scanned')
check('Expired', (await pollQr('t', pollWith({ retcode: -3501, data: null }))).status === 'Expired')
check('Canceled', (await pollQr('t', pollWith({ retcode: -3505, data: null }))).status === 'Canceled')

const confirmed = await pollQr(
  't',
  pollWith({ retcode: 0, data: { status: 'Confirmed', user_info: { aid: '123' } } }, [
    'ltuid_v2=123; Path=/',
    'ltoken_v2=v2_TOK; Path=/',
    'ltmid_v2=mid; Path=/',
  ]),
)
check('Confirmed status', confirmed.status === 'Confirmed', confirmed.status)
check('Confirmed yields a usable cookie', confirmed.cookie === 'ltuid_v2=123; ltoken_v2=v2_TOK; ltmid_v2=mid', confirmed.cookie)
check('Confirmed carries the account id', confirmed.uid === '123', confirmed.uid)

const noCookie = await pollQr('t', pollWith({ retcode: 0, data: { status: 'Confirmed' } }, [])).catch((error) => ({ error }))
check('Confirmed without cookies is an error', noCookie.error && /没有拿到 Cookie/.test(noCookie.error.message), String(noCookie.error && noCookie.error.message))

const riskRejected = await pollQr('t', pollWith({ retcode: -3503, message: '当前设备或网络环境存在风险' })).catch((error) => ({ error }))
check('-3503 is surfaced verbatim', riskRejected.error && /存在风险/.test(riskRejected.error.message), String(riskRejected.error && riskRejected.error.message))

console.log('jar:', jar)
console.log('qr svg bytes:', qr.svg.length)

if (fails.length) {
  console.error('\nFAILED:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
