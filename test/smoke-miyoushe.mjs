/**
 * miHoYo record-API parser test — offline. The payloads mirror the documented
 * `/index` + `/character/detail` shapes (identity nested under `base`, prop ids
 * resolved through the response's own `property_map`):
 *   node test/smoke-miyoushe.mjs
 */
import { readFile } from 'node:fs/promises'
import { buildFromResponses, buildQuery, serverOfUid, signDs } from '../lib/sources/miyoushe.js'
import { getCharacter, listArtifacts, overview } from '../lib/model.js'

const fails = []
const check = (name, condition, detail) => {
  if (!condition) fails.push(name + (detail ? ' :: ' + detail : ''))
}

// --- signature --------------------------------------------------------------
check('server cn_gf01 for uid 1', serverOfUid('100000001') === 'cn_gf01', serverOfUid('100000001'))
check('server cn_gf01 for uid 2', serverOfUid('200000001') === 'cn_gf01', serverOfUid('200000001'))
check('server cn_qd01 for uid 5', serverOfUid('500000001') === 'cn_qd01', serverOfUid('500000001'))
check('query sorted', buildQuery({ server: 'cn_gf01', role_id: 1 }) === 'role_id=1&server=cn_gf01', buildQuery({ server: 'cn_gf01', role_id: 1 }))

const ds = signDs({ salt: 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs', body: '{"a":1}', query: 'role_id=1', now: 1700000000000 })
const [dsT, dsR, dsHash] = ds.split(',')
check('ds has three parts', ds.split(',').length === 3, ds)
check('ds t is unix seconds', dsT === '1700000000', dsT)
check('ds r in range', Number(dsR) >= 100001 && Number(dsR) <= 200000, dsR)
check('ds hash is md5 hex', /^[0-9a-f]{32}$/.test(dsHash), dsHash)
// Same inputs, different r → different hash (sanity: it is a real digest of r).
const ds2 = signDs({ salt: 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs', body: '{"a":1}', query: 'role_id=1', now: 1700000000000 })
check('ds is time-deterministic in t', ds2.split(',')[0] === dsT, ds2)

// --- parsing ----------------------------------------------------------------
const index = JSON.parse(await readFile(new URL('./fixture-miyoushe-index.json', import.meta.url), 'utf8'))
const details = JSON.parse(await readFile(new URL('./fixture-miyoushe-detail.json', import.meta.url), 'utf8'))
const snapshot = buildFromResponses({ index, details, uid: '200000001' })

check('both characters survive', snapshot.characters.length === 2, String(snapshot.characters.length))
check('player nickname', snapshot.player.nickname === '测试旅行者', snapshot.player.nickname)
check('player level', snapshot.player.level === 58, String(snapshot.player.level))
check('region kept', snapshot.player.region === '天空岛', snapshot.player.region)

const hutao = getCharacter(snapshot, '胡桃')
check('hutao found', !hutao.error && hutao.name === '胡桃', hutao.error || hutao.name)
check('hutao element from base', hutao.element === 'pyro', hutao.element)
check('hutao weapon type', hutao.weaponType === 'polearm', hutao.weaponType)
check('hutao constellation', hutao.constellation === 1, String(hutao.constellation))
check('hutao talents by skill_type', hutao.talents && hutao.talents.auto === 10 && hutao.talents.skill === 9 && hutao.talents.burst === 8, JSON.stringify(hutao.talents))
check('hutao weapon', hutao.equippedWeapon && hutao.equippedWeapon.name === '护摩之杖', JSON.stringify(hutao.equippedWeapon))
check('weapon refinement', hutao.equippedWeapon && hutao.equippedWeapon.refinement === 1, String(hutao.equippedWeapon && hutao.equippedWeapon.refinement))
check('five artifacts', hutao.artifacts.length === 5, String(hutao.artifacts.length))
check('set name resolved from record API', hutao.artifacts[0].setName === '炽烈的炎之魔女', hutao.artifacts[0].setName)
check('slot by pos', hutao.artifacts.map((a) => a.slot).join(',') === 'flower,plume,sands,goblet,circlet', hutao.artifacts.map((a) => a.slot).join(','))
check('main stat from property_map', hutao.artifacts[0].main && hutao.artifacts[0].main.label === '生命值', JSON.stringify(hutao.artifacts[0].main))
check('main flat value parsed', hutao.artifacts[0].main && hutao.artifacts[0].main.value === 4780, JSON.stringify(hutao.artifacts[0].main))
check('percent main parsed', hutao.artifacts[2].main && hutao.artifacts[2].main.value === 46.6, JSON.stringify(hutao.artifacts[2].main))
check('substat percent flag', hutao.artifacts[0].subs[0].percent === true && hutao.artifacts[0].subs[0].value === 27.2, JSON.stringify(hutao.artifacts[0].subs[0]))
check('cv from record substats', hutao.artifacts[0].score.cv === 68, String(hutao.artifacts[0].score.cv))

// Without a detail entry the character must still list, just without a build.
const ayaka = getCharacter(snapshot, '神里绫华')
check('undetailed character still lists', !ayaka.error && ayaka.name === '神里绫华', ayaka.error || ayaka.name)
check('undetailed has no artifacts', ayaka.artifacts.length === 0, String(ayaka.artifacts.length))

const ov = overview(snapshot)
check('overview counts', ov.counts.characters === 2 && ov.counts.artifacts === 5, JSON.stringify(ov.counts))
const top = listArtifacts(snapshot, { limit: 1 })
check('artifact listing works', top.length === 1 && top[0].owner === '胡桃', JSON.stringify(top))

console.log(JSON.stringify({ ds, snapshot: { player: snapshot.player, note: snapshot.note }, hutao: { talents: hutao.talents, weapon: hutao.equippedWeapon, artifacts: hutao.artifacts.map((a) => ({ slot: a.slotZh, set: a.setName, main: a.main && a.main.text + ' ' + a.main.label, cv: a.score.cv })) } }, null, 2))

if (fails.length) {
  console.error('\nFAILED:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
