/**
 * Enka parser test — offline, driven by a hand-written response that mirrors
 * the documented `/api/uid/{uid}` shape:
 *   node test/smoke-enka.mjs
 */
import { readFile } from 'node:fs/promises'
import { parsePayload, regionOfUid } from '../lib/sources/enka.js'
import { getCharacter, listArtifacts, overview } from '../lib/model.js'
import { SLOT_ORDER } from '../lib/stats.js'

const payload = JSON.parse(await readFile(new URL('./fixture-enka.json', import.meta.url), 'utf8'))
const snapshot = parsePayload(payload, { uid: '800000001', base: 'https://enka.network' })

const fails = []
const check = (name, condition, detail) => {
  if (!condition) fails.push(name + (detail ? ' :: ' + detail : ''))
}

check('two characters', snapshot.characters.length === 2, String(snapshot.characters.length))
check('player nickname', snapshot.player.nickname === '测试旅行者', snapshot.player.nickname)
check('player world level', snapshot.player.worldLevel === 8, String(snapshot.player.worldLevel))
check('uid kept', snapshot.uid === '800000001', snapshot.uid)
check('region inferred', regionOfUid('800000001') === '亚服', regionOfUid('800000001'))

const hutao = getCharacter(snapshot, '胡桃')
check('hutao resolved', !hutao.error && hutao.name === '胡桃', hutao.error || hutao.name)
check('hutao level from propMap', hutao.level === 90, String(hutao.level))
check('hutao constellation', hutao.constellation === 3, String(hutao.constellation))
check('hutao talents ordered A/E/Q', hutao.talents.auto === 9 && hutao.talents.skill === 10 && hutao.talents.burst === 8, JSON.stringify(hutao.talents))
check('hutao element', hutao.element === 'pyro', hutao.element)
check('hutao weapon type', hutao.weaponType === 'polearm', hutao.weaponType)

check('equipped weapon resolved', hutao.equippedWeapon && hutao.equippedWeapon.name === '护摩之杖', JSON.stringify(hutao.equippedWeapon))
check('weapon level', hutao.equippedWeapon && hutao.equippedWeapon.level === 90, String(hutao.equippedWeapon && hutao.equippedWeapon.level))
check('weapon refinement from affixMap', hutao.equippedWeapon && hutao.equippedWeapon.refinement === 5, String(hutao.equippedWeapon && hutao.equippedWeapon.refinement))

check('panel stats parsed', hutao.stats && hutao.stats.critRate_ === 54.1, JSON.stringify(hutao.stats))
check('panel crit dmg', hutao.stats && hutao.stats.critDMG_ === 143.3, String(hutao.stats && hutao.stats.critDMG_))
check('panel hp from fightProp 2000', hutao.stats && hutao.stats.hp === 31265.9, String(hutao.stats && hutao.stats.hp))

check('five artifacts', hutao.artifacts.length === 5, String(hutao.artifacts.length))
check(
  'artifact slots mapped from equipType',
  hutao.artifacts.map((a) => a.slot).join(',') === SLOT_ORDER.join(','),
  hutao.artifacts.map((a) => a.slot).join(','),
)
check('set id recovered from icon', hutao.artifacts[0].setId === '15006', hutao.artifacts[0].setId)
check('set name from dict', hutao.artifacts[0].setName === '炽烈的炎之魔女', hutao.artifacts[0].setName)
check('main stat attached', hutao.artifacts[0].main && hutao.artifacts[0].main.label === '生命值', JSON.stringify(hutao.artifacts[0].main))
check('substat labels', hutao.artifacts[0].subs[0].label === '暴击率', JSON.stringify(hutao.artifacts[0].subs[0]))
check('substat percent formatting', hutao.artifacts[0].subs[0].text === '10.5%', hutao.artifacts[0].subs[0].text)
check('flower cv', hutao.artifacts[0].score.cv === 42.8, String(hutao.artifacts[0].score.cv))
check('4-star circlet kept', hutao.artifacts[4].rarity === 4 && hutao.artifacts[4].level === 16, JSON.stringify({ r: hutao.artifacts[4].rarity, l: hutao.artifacts[4].level }))

const ayaka = getCharacter(snapshot, '神里绫华')
check('ayaka level', ayaka.level === 80, String(ayaka.level))
check('ayaka talents', ayaka.talents.auto === 8 && ayaka.talents.skill === 6 && ayaka.talents.burst === 9, JSON.stringify(ayaka.talents))
check('ayaka refined 4-star weapon', ayaka.equippedWeapon && ayaka.equippedWeapon.rarity === 4 && ayaka.equippedWeapon.refinement === 3, JSON.stringify(ayaka.equippedWeapon))

const ov = overview(snapshot)
check('overview element split', ov.counts.byElement.pyro === 1 && ov.counts.byElement.cryo === 1, JSON.stringify(ov.counts.byElement))

const equippedByOwner = listArtifacts(snapshot, { owner: '胡桃', limit: 10 })
check('owner filter', equippedByOwner.length === 5, String(equippedByOwner.length))

console.log(JSON.stringify({ player: snapshot.player, hutao: { level: hutao.level, talents: hutao.talents, stats: hutao.stats, weapon: hutao.equippedWeapon, artifacts: hutao.artifacts.map((a) => ({ set: a.setName, slot: a.slotZh, main: a.main && a.main.label, cv: a.score.cv })) } }, null, 2))

if (fails.length) {
  console.error('\nFAILED:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
