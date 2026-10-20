/**
 * Verification (geetest → x-rpc-challenge) test — offline, stubbed transport.
 *   node test/smoke-verify.mjs
 */
import {
  clearXrpcChallenge,
  createVerification,
  getXrpcChallenge,
  probeEndpoints,
  purposeOf,
  verifyVerification,
} from '../lib/sources/miyoushe.js'

const fails = []
const check = (name, condition, detail) => {
  if (!condition) fails.push(name + (detail ? ' :: ' + detail : ''))
}

const config = {
  miyousheUid: '100000001',
  miyousheServer: 'cn_gf01',
  miyousheCookie: 'ltuid_v2=1; ltoken_v2=v2_x; ltmid_v2=m',
  miyousheDsSalt: '',
}

const realFetch = globalThis.fetch
const calls = []

/** Install a fetch stub; each entry answers by URL substring. */
function stubFetch(routes) {
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {}, method: init.method || 'GET' })
    for (const [fragment, body] of Object.entries(routes)) {
      if (String(url).includes(fragment)) {
        return { status: 200, text: async () => JSON.stringify(body), json: async () => body, headers: { getSetCookie: () => [] } }
      }
    }
    return { status: 200, text: async () => '{"retcode":0,"data":{}}', json: async () => ({ retcode: 0, data: {} }), headers: { getSetCookie: () => [] } }
  }
}

// --- createVerification -----------------------------------------------------
clearXrpcChallenge()
stubFetch({ '/card/wapi/createVerification': { retcode: 0, data: { gt: 'GT123', challenge: 'CH123', new_captcha: 1 } } })
const task = await createVerification(config)
check('createVerification returns gt', task.gt === 'GT123', task.gt)
check('createVerification returns challenge', task.challenge === 'CH123', task.challenge)
check('createVerification reports newCaptcha', task.newCaptcha === true, String(task.newCaptcha))
const createCall = calls.find((c) => c.url.includes('createVerification'))
check('createVerification hits the card host', Boolean(createCall && createCall.url.includes('/card/wapi/createVerification')), createCall && createCall.url)
check('createVerification sends challenge_game', createCall && createCall.headers['x-rpc-challenge_game'] === '2', createCall && String(createCall.headers['x-rpc-challenge_game']))
check('createVerification sends challenge_path', createCall && String(createCall.headers['x-rpc-challenge_path']).endsWith('/genshin/api/index'), createCall && String(createCall.headers['x-rpc-challenge_path']))

calls.length = 0
stubFetch({ '/card/wapi/createVerification': { retcode: 0, data: { gt: 'GT2', challenge: 'CH2', new_captcha: 1 } } })
const charTask = await createVerification(config, 'characters')
const charCreate = calls.find((c) => c.url.includes('createVerification'))
check('characters verification uses the list path', charCreate && String(charCreate.headers['x-rpc-challenge_path']).endsWith('/genshin/api/character/list'), charCreate && String(charCreate.headers['x-rpc-challenge_path']))
check('characters task remembers its purpose', charTask.purpose === 'characters', charTask.purpose)

stubFetch({ '/card/wapi/createVerification': { retcode: 0, data: { gt: '', challenge: '' } } })
const empty = await createVerification(config).catch((error) => ({ error }))
check('createVerification rejects an empty task', empty.error && /没有返回验证参数/.test(empty.error.message), String(empty.error && empty.error.message))

// --- verifyVerification -----------------------------------------------------
clearXrpcChallenge()
check('no challenge before verifying', getXrpcChallenge() === '')
stubFetch({ '/card/wapi/verifyVerification': { retcode: 0, data: { challenge: 'X-RPC-TOKEN' } } })
const token = await verifyVerification(config, 'CH123', 'VAL123')
check('verifyVerification returns the token', token === 'X-RPC-TOKEN', token)
check('the token is held in memory', getXrpcChallenge() === 'X-RPC-TOKEN', getXrpcChallenge())

stubFetch({ '/card/wapi/verifyVerification': { retcode: 0, data: {} } })
const noToken = await verifyVerification(config, 'CH', 'VAL').catch((error) => ({ error }))
check('verifyVerification rejects a missing token', noToken.error && /没有拿到 x-rpc-challenge/.test(noToken.error.message), String(noToken.error && noToken.error.message))

// --- the token is purpose-scoped and only rides on that purpose's calls ----
stubFetch({ '/character/list': { retcode: 0, data: { list: [{ base: { id: 10000046 } }] } } })
await probeEndpoints(config)
const indexCall = calls.find((c) => c.url.includes('/genshin/api/index'))
const detailCall = calls.find((c) => c.url.includes('/character/detail'))
check('index carries the index token', indexCall && indexCall.headers['x-rpc-challenge'] === 'X-RPC-TOKEN', indexCall && String(indexCall.headers['x-rpc-challenge']))
check('character calls do NOT reuse the index token', !detailCall || detailCall.headers['x-rpc-challenge'] === undefined, detailCall && String(detailCall.headers['x-rpc-challenge']))

// A token minted for "characters" rides on /character/detail instead.
calls.length = 0
stubFetch({ '/card/wapi/verifyVerification': { retcode: 0, data: { challenge: 'CHAR-TOKEN' } } })
await verifyVerification(config, 'CH2', 'VAL2', 'characters')
check('characters token held separately', getXrpcChallenge('characters') === 'CHAR-TOKEN', getXrpcChallenge('characters'))
check('index token untouched', getXrpcChallenge('index') === 'X-RPC-TOKEN', getXrpcChallenge('index'))

calls.length = 0
stubFetch({ '/character/list': { retcode: 0, data: { list: [{ base: { id: 10000046 } }] } } })
await probeEndpoints(config)
const detailNow = calls.find((c) => c.url.includes('/character/detail'))
check('character detail carries the characters token', detailNow && detailNow.headers['x-rpc-challenge'] === 'CHAR-TOKEN', detailNow && String(detailNow.headers['x-rpc-challenge']))

clearXrpcChallenge()
calls.length = 0
stubFetch({ '/character/list': { retcode: 0, data: { list: [{ base: { id: 10000046 } }] } } })
await probeEndpoints(config)
const cleanCall = calls.find((c) => c.url.includes('/genshin/api/index'))
check('cleared token is not sent', cleanCall && cleanCall.headers['x-rpc-challenge'] === undefined, cleanCall && String(cleanCall.headers['x-rpc-challenge']))

check('purposeOf maps detail to characters', purposeOf('/character/detail') === 'characters')
check('purposeOf maps index to index', purposeOf('/index') === 'index')

globalThis.fetch = realFetch

if (fails.length) {
  console.error('\nFAILED:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
