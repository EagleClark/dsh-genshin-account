/**
 * miHoYo record API source (国服 / CN).
 *
 * `POST /character/detail` is the only endpoint that returns talent levels,
 * artifact main stats and substat rolls, and it needs a DS signature:
 *
 *   DS = "{t},{r},md5('salt={salt}&t={t}&r={r}&b={body}&q={query}')"
 *
 * where `body` and `query` must be the **exact bytes put on the wire** — the
 * signature is computed over the same serialisation that is sent, never over a
 * re-serialisation. That is why this file builds the body/query strings once
 * and hands the identical string to both `sign()` and `fetch()`.
 *
 * The salt / `x-rpc-app_version` pair is what miHoYo rotates when the API
 * changes; both are user-overridable in the plugin config so a future rotation
 * is a settings edit rather than a release.
 *
 * Flow: `GET /index` (every owned character, account summary) →
 * `POST /character/detail` (talent/weapon/artifact detail for those ids). Only
 * characters whose detail switch is public come back in the second call.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildSnapshot, makeArtifact, makeWeapon, statLine } from '../model.js'
import { SLOTS, SLOT_ORDER, STATS } from '../stats.js'

export const id = 'miyoushe'
export const label = '米游社（国服）'

const BASE = 'https://api-takumi-record.mihoyo.com/game_record/app/genshin/api'
/** Same host, but the card/verification family lives outside `/genshin/api`. */
const CARD_BASE = 'https://api-takumi-record.mihoyo.com/game_record/app/card/wapi'
const DEFAULT_SALT = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs'
const DEFAULT_APP_VERSION = '2.11.1'

/** Which shard a CN UID belongs to (the API wants the shard, not a guess). */
export function serverOfUid(uid) {
  const first = String(uid || '').trim()[0]
  if (first === '1' || first === '2' || first === '3') return 'cn_gf01'
  if (first === '5') return 'cn_qd01'
  return ''
}

export function signDs({ salt, body = '', query = '', now = Date.now() }) {
  const t = Math.floor(now / 1000)
  const r = 100001 + Math.floor(Math.random() * 100000)
  const hash = createHash('md5').update(`salt=${salt}&t=${t}&r=${r}&b=${body}&q=${query}`, 'utf8').digest('hex')
  return `${t},${r},${hash}`
}

/** `role_id=A&server=B` with keys sorted — the same string is signed and sent. */
export function buildQuery(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
}

/**
 * Validate the cookie's *shape* before spending a request.
 *
 * `ltoken_v2` must travel with `ltmid_v2` (and an account id); a session missing
 * either half looks like an abnormal login and is a common reason the record API
 * answers with a geetest challenge instead of data.
 */
export function cookieOf(raw) {
  const value = String(raw || '').trim()
  if (value === '') {
    throw new Error('还没有配置米游社 Cookie。请在插件设置里填入包含 ltuid_v2 / ltoken_v2 / ltmid_v2 的 Cookie。')
  }
  if (!value.includes('=')) {
    throw new Error('米游社 Cookie 格式不对：需要完整的 `ltuid_v2=…; ltoken_v2=…; ltmid_v2=…` 形式，而不是单独一个 token。')
  }
  const jar = new Map()
  for (const part of value.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim())
  }
  const hasAccount = ['ltuid_v2', 'account_id_v2', 'ltuid', 'account_id'].some((key) => jar.get(key))
  const hasToken = ['ltoken_v2', 'ltoken'].some((key) => jar.get(key))
  const hasMid = ['ltmid_v2', 'ltmid'].some((key) => jar.get(key))
  const missing = []
  if (!hasAccount) missing.push('ltuid_v2（账号 id）')
  if (!hasToken) missing.push('ltoken_v2（登录令牌）')
  if (!hasMid) missing.push('ltmid_v2（设备 id，ltoken_v2 必须与它配对）')
  if (missing.length) {
    throw new Error(
      '米游社 Cookie 缺少字段：' + missing.join('、') +
        '。\n请在浏览器登录 bbs.mihoyo.com，从 Cookies 里把这三项一起复制（只复制 ltoken_v2 会被当作异常会话，接口会要求人机验证）。',
    )
  }
  return value
}

const RETCODE_HINTS = {
  10102: '角色详情没有公开。请在游戏里打开「角色详情」的公开开关（米游社 → 我的角色 → 设置）。',
  '-100': 'Cookie 已失效，请重新登录米游社并复制新的 Cookie。',
  10001: 'Cookie 无效或未登录。',
  10103: 'Cookie 有效，但没有绑定原神账号。',
  '-10001': '请求签名被拒绝：官方很可能又换了签名盐或 app_version。请在高级设置里更新「签名盐 / app_version」。',
  1008: 'UID 与 Cookie 不匹配，或者服务器选错了（官服 cn_gf01 / 渠道服 cn_qd01）。',
  10101: '这个 Cookie 今天查询的账号过多，被限流了。',
  '-110': '查询太频繁，请稍后再试。',
  1028: '查询太频繁，请稍后再试。',
  // geetest / captcha family — the account or the IP is being asked to prove it
  // is human. No amount of header tuning solves it; the request must come from
  // a verified session, or the source must be switched.
  1034: '米游社要求人机验证（geetest）。在设置页点「开始验证」拖一次滑块，通过后插件会自动换取 x-rpc-challenge 并重试。',
  10035: '触发了米游社的人机验证（geetest）。完成一次「开始验证」即可。',
  5003: '触发了米游社的人机验证（geetest）。完成一次「开始验证」即可。',
  10041: '触发了米游社的人机验证（geetest）。完成一次「开始验证」即可。',
}

/** Codes that mean "come back later", not "your configuration is wrong". */
const RETRYABLE = new Set(['1034', '10035', '5003', '10041', '-110', '1028', '10101'])

/**
 * A stable, plausible Android device identity.
 *
 * Two reasons this is persisted rather than random per process:
 * - the record API pairs a session with a device id, so a new id every run is
 *   exactly the "new device" signal that asks for a captcha;
 * - `x-rpc-device_id` is documented as a UUID, not an arbitrary hex blob.
 */
const DEVICE = {
  id: '',
  model: 'M2101K9C',
  sys: '13',
  channel: 'xiaomi',
}

function deviceIdFile() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'data', 'dsh-genshin-account', 'device-id.txt')
}

function loadDeviceId() {
  try {
    const existing = readFileSync(deviceIdFile(), 'utf8').trim()
    if (/^[0-9a-f-]{32,36}$/i.test(existing)) return existing
  } catch {
    /* first run */
  }
  const created = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : [
        createHash('md5').update(String(Math.random()) + String(Date.now())).digest('hex').slice(0, 8),
        createHash('md5').update(String(Math.random())).digest('hex').slice(8, 12),
        createHash('md5').update(String(Math.random())).digest('hex').slice(12, 16),
        createHash('md5').update(String(Math.random())).digest('hex').slice(16, 20),
        createHash('md5').update(String(Math.random())).digest('hex').slice(20, 32),
      ].join('-')
  try {
    mkdirSync(dirname(deviceIdFile()), { recursive: true })
    writeFileSync(deviceIdFile(), created, 'utf8')
  } catch {
    /* an in-memory id still works for this run */
  }
  return created
}

if (DEVICE.id === '') DEVICE.id = loadDeviceId()

/**
 * `x-rpc-device_fp` — the device fingerprint a few record endpoints insist on.
 *
 * Obtained from the documented `public-data-api.mihoyo.com/device-fp/api/getFp`
 * (see UIGF's auth page). The shape matters: `app_name` must be `bbs_cn`, and
 * `device_fp` must carry a NON-empty 13-char seed on the first call — an empty
 * string is rejected with `code 403 传入的参数有误`, which is what a naive call
 * looks like.
 *
 * The profile below is this plugin's own synthetic handset; only the field
 * names and value types are contractual, the values describe a device.
 */
const FP_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEVICE_SECRETS = { bbsId: '', fp: '', fpAt: 0, seed: '' }

function fpFile() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'data', 'dsh-genshin-account', 'device-fp.json')
}

function loadDeviceSecrets() {
  try {
    const stored = JSON.parse(readFileSync(fpFile(), 'utf8'))
    if (stored && typeof stored === 'object') {
      if (typeof stored.bbsId === 'string') DEVICE_SECRETS.bbsId = stored.bbsId
      if (typeof stored.fp === 'string') DEVICE_SECRETS.fp = stored.fp
      if (typeof stored.fpAt === 'number') DEVICE_SECRETS.fpAt = stored.fpAt
      if (typeof stored.seed === 'string') DEVICE_SECRETS.seed = stored.seed
    }
  } catch {
    /* first run */
  }
  if (!DEVICE_SECRETS.bbsId) DEVICE_SECRETS.bbsId = randomUuid()
  if (!DEVICE_SECRETS.seed) DEVICE_SECRETS.seed = randomHex(13)
  persistDeviceSecrets()
}

function persistDeviceSecrets() {
  try {
    mkdirSync(dirname(fpFile()), { recursive: true })
    writeFileSync(fpFile(), JSON.stringify(DEVICE_SECRETS), 'utf8')
  } catch {
    /* in-memory is enough for this run */
  }
}

function randomHex(length) {
  let out = ''
  for (let i = 0; i < length; i++) out += '0123456789abcdef'[(Math.random() * 16) | 0]
  return out
}

function randomUuid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  const hex = (n) => randomHex(n)
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
}

/** The synthetic handset described by every `getFp` call. */
function fingerprintExtensions() {
  const model = DEVICE.model
  const product = 'OP5913L1'
  return {
    proxyStatus: 0,
    isRoot: 0,
    romCapacity: '512',
    deviceName: model,
    productName: product,
    romRemain: '300',
    hostname: 'localhost',
    screenSize: '1080x2400',
    isTablet: 0,
    aaid: '',
    model,
    brand: 'XiaoMi',
    hardware: 'qcom',
    deviceType: product,
    devId: 'REL',
    serialNumber: 'unknown',
    sdCapacity: 512215,
    buildTime: '1693626947000',
    buildUser: 'android-build',
    simState: 5,
    ramRemain: '200000',
    appUpdateTimeDiff: 1702604034482,
    deviceInfo: `XiaoMi/${product}/${product}:13/SKQ1.221119.001/T.118e6c7:user/release-keys`,
    vaid: '',
    buildType: 'user',
    sdkVersion: '34',
    ui_mode: 'UI_MODE_TYPE_NORMAL',
    isMockLocation: 0,
    cpuType: 'arm64-v8a',
    isAirMode: 0,
    ringMode: 2,
    chargeStatus: 1,
    manufacturer: 'XiaoMi',
    emulatorStatus: 0,
    appMemory: '512',
    osVersion: DEVICE.sys,
    vendor: 'unknown',
    accelerometer: '1.4x7.1x6.2',
    sdRemain: 200000,
    buildTags: 'release-keys',
    packageName: 'com.mihoyo.hyperion',
    networkType: 'WiFi',
    oaid: '',
    debugStatus: 1,
    ramCapacity: '469679',
    magnetometer: '20.0x-27.4x2.1',
    display: `${product}_13.1.0.181(CN01)`,
    appInstallTimeDiff: 1688455751496,
    packageVersion: '2.11.1',
    gyroscope: '0.03x0.01x0.01',
    batteryStatus: 100,
    hasKeyboard: 0,
    board: 'taro',
  }
}

/** Last fingerprint failure, surfaced by the probe so it is not silent. */
let fpError = ''

/**
 * Return a usable `device_fp`, refreshing it weekly.
 * @returns the fingerprint, or '' when the endpoint refused (never throws).
 */
async function ensureDeviceFp() {
  if (DEVICE_SECRETS.fp && Date.now() - DEVICE_SECRETS.fpAt < FP_TTL_MS) return DEVICE_SECRETS.fp
  const body = JSON.stringify({
    device_id: DEVICE.id.replace(/-/g, '').slice(0, 16),
    seed_id: randomUuid(),
    platform: '2',
    seed_time: String(Date.now()),
    ext_fields: JSON.stringify(fingerprintExtensions()),
    app_name: 'bbs_cn',
    bbs_device_id: DEVICE_SECRETS.bbsId,
    // A non-empty seed is REQUIRED: '' is rejected with `403 传入的参数有误`.
    device_fp: DEVICE_SECRETS.seed || randomHex(13),
  })
  try {
    const res = await fetch('https://public-data-api.mihoyo.com/device-fp/api/getFp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': webviewUserAgent(DEFAULT_APP_VERSION),
        origin: 'https://webstatic.mihoyo.com',
        referer: 'https://webstatic.mihoyo.com',
      },
      body,
    })
    const json = await res.json()
    const fp = json && json.data && typeof json.data.device_fp === 'string' ? json.data.device_fp : ''
    if (fp) {
      DEVICE_SECRETS.fp = fp
      DEVICE_SECRETS.fpAt = Date.now()
      fpError = ''
      persistDeviceSecrets()
      return fp
    }
    fpError = `getFp 返回 code=${json && json.data ? json.data.code : '?'} ${(json && json.data && json.data.msg) || ''}`.trim()
  } catch (error) {
    fpError = 'getFp 请求失败：' + ((error && error.message) || error)
  }
  return ''
}

loadDeviceSecrets()

/**
 * The miHoYo BBS mobile-webview user agent. `x-rpc-client_type: 5` means
 * "webview", so the fingerprint has to match that: an Android webview UA with
 * the `miHoYoBBS/<version>` suffix. A desktop UA next to client_type 5 is a
 * self-contradicting request — the shape anti-abuse rules look for.
 */
function webviewUserAgent(appVersion) {
  return (
    `Mozilla/5.0 (Linux; Android ${DEVICE.sys}; ${DEVICE.model} Build/TKQ1.220829.002; wv) ` +
    'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 ' +
    `Mobile Safari/537.36 miHoYoBBS/${appVersion}`
  )
}

/**
 * `x-rpc-challenge` — the token that clears a 1034.
 *
 * The record API answers 1034 until the client proves it passed a geetest
 * challenge for the exact endpoint it wants to read. The flow (same as
 * Snap.Hutao's CardClient):
 *   1. GET  /card/wapi/createVerification?is_high=true  → { gt, challenge }
 *   2. user solves the geetest slider                  → { challenge, validate }
 *   3. POST /card/wapi/verifyVerification              → { challenge }  ← this one
 *   4. replay the original call with `x-rpc-challenge: <challenge>`
 *
 * Held in memory only: it is short-lived and endpoint-specific, and persisting
 * it would just replay a stale token after the next restart.
 */
let xrpcChallenge = ''

/** @returns the challenge currently held, or ''. */
export function getXrpcChallenge() {
  return xrpcChallenge
}

/** Forget the challenge (after a 1034, or when the account changes). */
export function clearXrpcChallenge() {
  xrpcChallenge = ''
}

/** Headers that name *which* endpoint the verification is good for. */
const challengeHeaders = () => ({
  'x-rpc-challenge_game': '2',
  'x-rpc-challenge_path': 'https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/index',
})

async function call({ path, method = 'GET', params, payload, salt, appVersion, cookie, extraHeaders, base = BASE }) {
  const query = params ? buildQuery(params) : ''
  const body = payload === undefined ? '' : JSON.stringify(payload)
  // The device fingerprint is minted once and then replayed; a few record
  // endpoints refuse to answer without it.
  const deviceFp = await ensureDeviceFp()
  // Header set from the UIGF API collection's "鉴权" page: for client_type 5 the
  // referer is webstatic, the origin is the API host itself, and
  // X-Requested-With must name the CN app package.
  const headers = {
    DS: signDs({ salt, body, query }),
    'x-rpc-app_version': appVersion,
    'x-rpc-client_type': '5',
    'x-rpc-device_id': DEVICE.id,
    'x-rpc-device_model': DEVICE.model,
    'x-rpc-device_name': 'Xiaomi ' + DEVICE.model,
    'x-rpc-sys_version': DEVICE.sys,
    'x-rpc-channel': DEVICE.channel,
    'x-rpc-language': 'zh-cn',
    'x-requested-with': 'com.mihoyo.hyperion',
    origin: 'https://api-takumi-record.mihoyo.com',
    referer: 'https://webstatic.mihoyo.com',
    'user-agent': webviewUserAgent(appVersion),
    cookie,
    accept: 'application/json',
  }
  if (deviceFp) headers['x-rpc-device_fp'] = deviceFp
  if (xrpcChallenge) headers['x-rpc-challenge'] = xrpcChallenge
  if (extraHeaders) Object.assign(headers, extraHeaders)
  if (body !== '') headers['content-type'] = 'application/json'
  const url = base + path + (query !== '' ? '?' + query : '')
  let res
  try {
    res = await fetch(url, { method, headers, body: body === '' ? undefined : body })
  } catch (error) {
    throw new Error(`连接米游社接口失败：${error && error.message ? error.message : String(error)}`)
  }
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    if (res.status === 403 || res.status === 412) {
      throw new Error(`米游社接口返回 HTTP ${res.status}（风控/维护），请稍后再试。`)
    }
    throw new Error(`米游社接口返回了非 JSON 内容（HTTP ${res.status}）：${text.slice(0, 120)}`)
  }
  const retcode = json && json.retcode
  if (retcode !== 0) {
    // A 1034 means "solve the geetest challenge for this endpoint", not "the
    // config is wrong" — mark it so the UI can offer the slider instead of
    // showing a dead end.
    const step = path === '/index' ? '读取账号概览' : '读取角色详情'
    const retry = RETRYABLE.has(String(retcode)) ? '（可重试类错误，配置没写错）' : ''
    const serverMessage = json && typeof json.message === 'string' && json.message ? json.message : '(无)'
    const hint = RETCODE_HINTS[String(retcode)] || ''
    // Keep the server's own payload: it is the only way to tell a captcha apart
    // from a policy change without guessing.
    let raw = ''
    try {
      raw = JSON.stringify(json).slice(0, 240)
    } catch {
      raw = ''
    }
    const error = new Error(
      `米游社接口报错 retcode=${retcode}，出错步骤：${step}${retry}\n` +
        `服务器信息：${serverMessage}\n` +
        (hint ? hint + '\n' : '') +
        (raw ? '原始响应：' + raw : ''),
    )
    // Structured fields so a probe can report per-endpoint outcomes without
    // re-parsing a human-readable message.
    error.retcode = retcode
    error.serverMessage = serverMessage
    error.step = path
    error.needsVerification = String(retcode) === '1034'
    throw error
  }
  if (json.data == null) throw new Error('米游社接口返回了空数据。请确认角色详情已公开。')
  return json.data
}

/** Pull the four credentials a record call needs out of the plugin config. */
function credentialOf(config) {
  const uid = String((config && config.miyousheUid) || '').trim()
  const server = String((config && config.miyousheServer) || '').trim() || serverOfUid(uid)
  const salt = String((config && config.miyousheDsSalt) || '').trim() || DEFAULT_SALT
  const appVersion = String((config && config.miyousheAppVersion) || '').trim() || DEFAULT_APP_VERSION
  const cookie = cookieOf(config && config.miyousheCookie)
  if (!/^\d{5,12}$/.test(uid)) throw new Error(`UID 不合法：${uid || '(空)'}`)
  return { uid, server, salt, appVersion, cookie }
}

/**
 * Step 1 of the verification: ask miHoYo for a geetest task.
 * @returns {{ gt: string, challenge: string, newCaptcha: boolean }}
 */
export async function createVerification(config) {
  const { salt, appVersion, cookie } = credentialOf(config)
  const data = await call({
    base: CARD_BASE,
    path: '/createVerification',
    params: { is_high: 'true' },
    salt,
    appVersion,
    cookie,
    extraHeaders: challengeHeaders(),
  })
  const gt = String(data.gt || '')
  const challenge = String(data.challenge || '')
  if (!gt || !challenge) throw new Error('米游社没有返回验证参数（gt/challenge 为空），请稍后重试。')
  return { gt, challenge, newCaptcha: data.new_captcha === 1 }
}

/**
 * Step 3 of the verification: hand back the solved challenge and keep the
 * `x-rpc-challenge` it yields, so the next record call passes.
 * @returns the challenge string now held in memory.
 */
export async function verifyVerification(config, challenge, validate) {
  const { salt, appVersion, cookie } = credentialOf(config)
  const data = await call({
    base: CARD_BASE,
    path: '/verifyVerification',
    method: 'POST',
    payload: { challenge, validate },
    salt,
    appVersion,
    cookie,
    extraHeaders: challengeHeaders(),
  })
  const token = String(data.challenge || '')
  if (!token) throw new Error('验证已提交，但没有拿到 x-rpc-challenge，请重试。')
  xrpcChallenge = token
  return token
}

/**
 * Try every record endpoint with the configured cookie and report which ones
 * pass. `/index` is not the only way in — if it is gated but `/character/list`
 * or `/character/detail` is not, the snapshot can be assembled from those.
 *
 * Read-only: nothing is cached, and the results are meant to be shown to the
 * user (and to this plugin's author) rather than acted on silently.
 */
export async function probeEndpoints(config) {
  const results = []
  const uid = String((config && config.miyousheUid) || '').trim()
  const server = String((config && config.miyousheServer) || '').trim() || serverOfUid(uid)
  const salt = String((config && config.miyousheDsSalt) || '').trim() || DEFAULT_SALT
  const appVersion = String((config && config.miyousheAppVersion) || '').trim() || DEFAULT_APP_VERSION
  let cookie
  try {
    cookie = cookieOf(config && config.miyousheCookie)
  } catch (error) {
    return [{ step: 'cookie', ok: false, error: error.message }]
  }
  if (!/^\d{5,12}$/.test(uid)) return [{ step: 'uid', ok: false, error: `UID 不合法：${uid || '(空)'}` }]

  // Report the fingerprint step explicitly: it is the header most likely to be
  // missing, and a silent failure there looks exactly like a captcha.
  const fpStarted = Date.now()
  const fp = await ensureDeviceFp()
  results.push(
    fp
      ? { step: 'x-rpc-device_fp', ok: true, ms: Date.now() - fpStarted, message: '已取得设备指纹' }
      : { step: 'x-rpc-device_fp', ok: false, ms: Date.now() - fpStarted, message: fpError || '未取得设备指纹' },
  )

  const attempt = async (step, run) => {
    const started = Date.now()
    try {
      const data = await run()
      results.push({ step, ok: true, ms: Date.now() - started, characters: Array.isArray(data && (data.list || data.avatars)) ? (data.list || data.avatars).length : 0 })
      return data
    } catch (error) {
      results.push({
        step,
        ok: false,
        ms: Date.now() - started,
        retcode: error && error.retcode !== undefined ? error.retcode : null,
        message: String((error && error.message) || error).split('\n')[0],
      })
      return null
    }
  }

  const index = await attempt('/index (GET)', () =>
    call({ path: '/index', params: { role_id: uid, server }, salt, appVersion, cookie }),
  )
  const list = await attempt('/character/list (POST)', () =>
    call({ path: '/character/list', method: 'POST', payload: { role_id: Number(uid), server }, salt, appVersion, cookie }),
  )

  const idsFrom = (value) => {
    const rows = (value && (value.list || value.avatars)) || []
    return rows.map((row) => Number((row.base && row.base.id) || row.id)).filter((n) => Number.isFinite(n))
  }
  const ids = idsFrom(list).length ? idsFrom(list) : idsFrom(index)
  if (ids.length) {
    await attempt('/character/detail (POST)', () =>
      call({
        path: '/character/detail',
        method: 'POST',
        payload: { role_id: Number(uid), server, character_ids: ids.slice(0, 3) },
        salt,
        appVersion,
        cookie,
      }),
    )
  } else {
    results.push({ step: '/character/detail (POST)', ok: false, skipped: true, message: '需要先有一个能返回角色 id 的接口' })
  }
  return results
}

/** "27.2%" → { value: 27.2, percent: true }; "4780" → { value: 4780, percent: false }. */
function parseValue(raw) {
  const text = String(raw == null ? '' : raw).trim()
  const percent = text.endsWith('%')
  const n = Number(percent ? text.slice(0, -1) : text)
  return { value: Number.isFinite(n) ? n : 0, percent }
}

/**
 * Resolve a record-API `property_type` through the response's own
 * `property_map` (which carries the Chinese label), then match that label
 * against the canonical stat table. `%` disambiguates 生命值/攻击力/防御力,
 * whose flat and percent forms share a label.
 */
function statFromProperty(propertyMap, propertyType) {
  const entry = propertyMap ? propertyMap[String(propertyType)] : null
  const zh = entry && typeof entry.name === 'string' ? entry.name : ''
  return { zh, key: keyOfZh(zh) }
}

const ZH_TO_KEYS = new Map()
for (const [key, meta] of Object.entries(STATS)) {
  if (!ZH_TO_KEYS.has(meta.zh)) ZH_TO_KEYS.set(meta.zh, [])
  ZH_TO_KEYS.get(meta.zh).push(key)
}

function keyOfZh(zh) {
  const keys = ZH_TO_KEYS.get(zh)
  return keys ? keys[0] : ''
}

function keyOfZhAndValue(zh, percent) {
  const keys = ZH_TO_KEYS.get(zh) || []
  const exact = keys.find((key) => Boolean(STATS[key].percent) === Boolean(percent))
  return exact || keys[0] || ''
}

const ELEMENT_BY_NAME = {
  Pyro: 'pyro', Hydro: 'hydro', Anemo: 'anemo', Electro: 'electro',
  Dendro: 'dendro', Cryo: 'cryo', Geo: 'geo', None: 'none',
}
const WEAPON_BY_CODE = { 1: 'sword', 10: 'catalyst', 11: 'claymore', 12: 'bow', 13: 'polearm' }
const SLOT_BY_POS = { 1: 'flower', 2: 'plume', 3: 'sands', 4: 'goblet', 5: 'circlet' }

function talentsOf(skills) {
  const byType = { 1: 0, 2: 0, 3: 0 }
  for (const skill of skills || []) {
    const type = Number(skill && skill.skill_type)
    if (type in byType && skill.level != null) byType[type] = Number(skill.level) || 0
  }
  if (byType[1] || byType[2] || byType[3]) return { auto: byType[1], skill: byType[2], burst: byType[3] }
  return null
}

function artifactsOf(character, propertyMap) {
  const relics = character.relics || character.artifacts || []
  return relics.map((relic) => {
    const main = relic.main_property
    const mainParsed = main ? parseValue(main.value != null ? main.value : main.final) : null
    const mainEntry = main ? statFromProperty(propertyMap, main.property_type) : null
    const mainKey = mainEntry && mainEntry.zh ? keyOfZhAndValue(mainEntry.zh, mainParsed ? mainParsed.percent : true) : ''
    const subs = (relic.sub_property_list || []).map((sub) => {
      const parsed = parseValue(sub.value != null ? sub.value : sub.final)
      const entry = statFromProperty(propertyMap, sub.property_type)
      const key = entry.zh ? keyOfZhAndValue(entry.zh, parsed.percent) : ''
      return key ? statLine(key, parsed.value) : null
    })
    return makeArtifact({
      // The record API exposes the set only by name; the dictionary resolves it.
      setKey: (relic.set && relic.set.name) || relic.name || '',
      slot: SLOT_BY_POS[Number(relic.pos)] || SLOT_ORDER[0],
      rarity: relic.rarity,
      level: relic.level,
      main: mainKey ? statLine(mainKey, mainParsed ? mainParsed.value : 0) : null,
      subs: subs.filter(Boolean),
      location: String((character.base && character.base.id) || character.id || ''),
    })
  })
}

function weaponOf(character) {
  const weapon = character.weapon
  if (!weapon) return null
  const item = makeWeapon(weapon.id, {
    level: weapon.level,
    refinement: weapon.affix_level,
    location: String((character.base && character.base.id) || character.id || ''),
  })
  if (weapon.name) item.name = weapon.name
  return item
}

/** Pure assembly half, exported for the offline test. */
export function buildFromResponses({ index, details, uid }) {
  const started = Date.now()
  // Accept either the `{retcode,data}` envelope or the already-unwrapped `data`.
  const indexData = index && index.data ? index.data : index
  const detailData = details && details.data ? details.data : details
  const list = (indexData && (indexData.list || indexData.avatars)) || []
  const detailList = (detailData && (detailData.list || detailData.avatars)) || []
  const propertyMap = detailData && detailData.property_map ? detailData.property_map : null
  const detailsById = new Map()
  for (const entry of detailList) {
    const base = entry.base || entry
    if (base && base.id != null) detailsById.set(String(base.id), entry)
  }

  const characters = []
  const weapons = []
  const artifacts = []
  const covered = new Set()

  for (const entry of list) {
    const base = entry.base || entry
    const characterId = String(base.id)
    const detail = detailsById.get(characterId) || null
    if (detail) covered.add(characterId)
    const detailBase = detail ? detail.base || detail : null
    const source = detailBase || base
    const weapon = detail ? weaponOf(detail) : null
    const equipped = detail ? artifactsOf(detail, propertyMap) : []
    if (weapon) weapons.push(weapon)
    artifacts.push(...equipped)
    characters.push({
      id: characterId,
      key: characterId,
      name: source.name || base.name || characterId,
      element: ELEMENT_BY_NAME[source.element] || ELEMENT_BY_NAME[base.element] || 'none',
      weaponType: WEAPON_BY_CODE[Number(source.weapon_type || base.weapon_type)] || 'other',
      rarity: Number(source.rarity || base.rarity || 0),
      level: Number(source.level || base.level || 0),
      constellation: Number(source.actived_constellation_num || base.actived_constellation_num || 0),
      talents: detail ? talentsOf(detail.skills) : null,
      stats: null,
      equippedWeapon: weapon,
    })
  }
  // A detail-only character (not in index) still deserves to show up.
  for (const entry of detailList) {
    const base = entry.base || entry
    const characterId = String(base.id)
    if (covered.has(characterId)) continue
    const weapon = weaponOf(entry)
    const equipped = artifactsOf(entry, propertyMap)
    if (weapon) weapons.push(weapon)
    artifacts.push(...equipped)
    characters.push({
      id: characterId,
      key: characterId,
      name: base.name || characterId,
      element: ELEMENT_BY_NAME[base.element] || 'none',
      weaponType: WEAPON_BY_CODE[Number(base.weapon_type)] || 'other',
      rarity: Number(base.rarity || 0),
      level: Number(base.level || 0),
      constellation: Number(base.actived_constellation_num || 0),
      talents: talentsOf(entry.skills),
      stats: null,
      equippedWeapon: weapon,
    })
  }

  const role = (indexData && indexData.role) || {}
  const stats = (indexData && indexData.stats) || {}
  const noteBits = ['米游社 · 国服']
  if (stats.achievement_number) noteBits.push(`成就 ${stats.achievement_number}`)
  if (stats.active_day_number) noteBits.push(`活跃 ${stats.active_day_number} 天`)
  if (detailList.length) noteBits.push(`角色详情 ${detailList.length} 个`)

  return buildSnapshot({
    source: id,
    uid,
    player: {
      nickname: role.nickname || '',
      level: role.level,
      worldLevel: null,
      signature: '',
      region: role.region || '',
    },
    characters,
    weapons,
    artifacts,
    note: noteBits.join(' · '),
    elapsedMs: Date.now() - started,
  })
}

export async function fetchSnapshot(config) {
  const uid = String((config && config.miyousheUid) || '').trim()
  if (!/^\d{5,12}$/.test(uid)) {
    throw new Error('请在插件设置里填写一个有效的国服 UID（1/2/5 开头的纯数字）。')
  }
  const server = String((config && config.miyousheServer) || '').trim() || serverOfUid(uid)
  if (!server) throw new Error(`UID ${uid} 不像国服 UID（1/2/5 开头），请确认服务器选择。`)
  const cookie = cookieOf(config && config.miyousheCookie)
  const salt = String((config && config.miyousheDsSalt) || '').trim() || DEFAULT_SALT
  const appVersion = String((config && config.miyousheAppVersion) || '').trim() || DEFAULT_APP_VERSION

  const index = await call({
    path: '/index',
    params: { role_id: uid, server },
    salt,
    appVersion,
    cookie,
  })

  const ids = ((index && (index.list || index.avatars)) || [])
    .map((entry) => Number((entry.base && entry.base.id) || entry.id))
    .filter((n) => Number.isFinite(n))
  // The endpoint is happy with a batch; keep the request small and predictable.
  const BATCH = 20
  let details = null
  for (let offset = 0; offset < ids.length; offset += BATCH) {
    // A short gap between calls reads less like a bot than a burst does.
    if (offset > 0) await new Promise((resolve) => setTimeout(resolve, 400))
    const chunk = ids.slice(offset, offset + BATCH)
    try {
      const part = await call({
        path: '/character/detail',
        method: 'POST',
        payload: { role_id: Number(uid), server, character_ids: chunk },
        salt,
        appVersion,
        cookie,
      })
      if (!details) details = { list: [], property_map: part.property_map }
      details.list.push(...((part && part.list) || []))
      if (part && part.property_map) details.property_map = part.property_map
    } catch (error) {
      // A private detail switch should not lose the account overview.
      if (offset === 0 && (details === null || details.list.length === 0)) {
        throw new Error(
          (error && error.message ? error.message : String(error)) +
            '\n提示：米游社只对「已公开角色详情」的角色返回天赋/圣遗物数据，其余角色仍会出现在列表里。',
        )
      }
    }
  }

  return buildFromResponses({ index, details: details || { list: [] }, uid })
}
