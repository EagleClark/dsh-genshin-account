/**
 * The showcase path: MicroGG (CN) / Enka (global) → artifact sub-stats.
 *
 * This is the only route to `reliquarySubstats` for a CN account, so the mapper
 * and the merge into a calculator-built snapshot both need to be pinned down.
 * The fixture below is trimmed from a real `profile.microgg.cn` response.
 */
import { fetchShowcase, mergeShowcase } from '../lib/sources/microgg.js'
import { buildSnapshot, carryForwardShowcase, characterView, listWeapons, overview } from '../lib/model.js'

let failures = 0
let checks = 0
function check(label, ok, detail) {
  checks += 1
  if (!ok) {
    failures += 1
    console.log('  FAILED: ' + label + (detail ? ' :: ' + String(detail).slice(0, 300) : ''))
  }
}

function artifact({ id, setId, equipType, icon, main, mainValue, subs, level = 20 }) {
  return {
    itemId: id,
    reliquary: { level, mainPropId: main, appendPropIdList: subs.map((s) => s[0]) },
    flat: {
      rankLevel: 5,
      icon,
      equipType,
      setId,
      setNameTextMapHash: 0,
      itemType: 'ITEM_RELIQUARY',
      reliquaryMainstat: { mainPropId: main, statValue: mainValue },
      reliquarySubstats: subs.map(([id2, value]) => ({ appendPropId: id2, statValue: value })),
    },
  }
}

const fixture = {
  playerInfo: { nickname: '测试旅行者', level: 58, signature: '展柜测试', worldLevel: 8 },
  avatarInfoList: [
    {
      avatarId: 10000046,
      propMap: { 4001: { type: 4001, ival: '90', val: '90' } },
      // Trimmed panel props: base HP/ATK/DEF (1/4/7), final (2000-2002), crit,
      // ER, EM and the pyro bonus at 40.
      fightPropMap: {
        1: 15552, 4: 106, 7: 876, 20: 0.6, 22: 1.8, 23: 1.5, 26: 0, 28: 120,
        40: 0.466, 41: 0, 42: 0, 43: 0, 44: 0, 45: 0, 46: 0,
        2000: 30123, 2001: 1288, 2002: 1104,
      },
      equipList: [
        {
          itemId: 13501,
          weapon: { level: 90, affixMap: { 1: 4 } },
          flat: { nameTextMapHash: 0, rankLevel: 5, icon: 'UI_EquipIcon_Pole_Homa' },
        },
        artifact({
          id: 80510,
          setId: 15001,
          equipType: 'EQUIP_BRACER',
          icon: 'UI_RelicIcon_15001_4',
          main: 'FIGHT_PROP_HP',
          mainValue: 4780,
          subs: [
            ['FIGHT_PROP_CRITICAL', 10.5],
            ['FIGHT_PROP_CRITICAL_HURT', 21.8],
            ['FIGHT_PROP_ATTACK_PERCENT', 9.3],
            ['FIGHT_PROP_ELEMENT_MASTERY', 40],
          ],
        }),
        artifact({
          id: 80520,
          setId: 15002,
          equipType: 'EQUIP_NECKLACE',
          icon: 'UI_RelicIcon_15002_2',
          main: 'FIGHT_PROP_ATTACK',
          mainValue: 311,
          subs: [
            ['FIGHT_PROP_CRITICAL', 3.5],
            ['FIGHT_PROP_CRITICAL_HURT', 14.0],
            ['FIGHT_PROP_HP_PERCENT', 5.8],
            ['FIGHT_PROP_CHARGE_EFFICIENCY', 11.0],
          ],
        }),
      ],
    },
    {
      avatarId: 10000002,
      propMap: { 4001: { type: 4001, ival: '80', val: '80' } },
      equipList: [],
    },
  ],
}

const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  if (String(url).includes('profile.microgg.cn') || String(url).includes('enka.network')) {
    return { ok: true, status: 200, json: async () => structuredClone(fixture) }
  }
  throw new Error('unexpected fetch ' + url)
}

const showcase = await fetchShowcase('188337967')
check('showcase ok', showcase.ok === true, JSON.stringify(showcase).slice(0, 200))
check('showcase uses the CN host first', showcase.host === 'microgg', showcase.host)
check('showcase reads both characters', showcase.builds.length === 2, showcase.builds.length)

const hutao = showcase.builds.find((build) => build.avatarId === '10000046')
check('character level from propMap', hutao && hutao.level === 90, hutao && hutao.level)
check('weapon name resolves from the dictionary', hutao && hutao.weapon && hutao.weapon.name === '护摩之杖', hutao && hutao.weapon && hutao.weapon.name)
check('weapon refinement is 1-based', hutao && hutao.weapon && hutao.weapon.refinement === 5, hutao && hutao.weapon && hutao.weapon.refinement)
check('two artifacts mapped', hutao && hutao.artifacts.length === 2, hutao && hutao.artifacts.length)
check('panel stats are read from fightPropMap', hutao && hutao.stats && hutao.stats.hp === 30123 && hutao.stats.critRate_ === 60, hutao && JSON.stringify(hutao.stats))
check('em and elemental bonus are kept', hutao && hutao.stats.eleMas === 120 && hutao.stats.dmg.pyro === 46.6, hutao && JSON.stringify(hutao.stats))

const flower = hutao.artifacts[0]
check('set name resolves from setId', flower.setName === '角斗士的终幕礼', flower.setName)
check('slot resolves from equipType', flower.slot === 'flower', flower.slot)
check('main stat carries its value', flower.main && flower.main.value === 4780, flower.main && flower.main.value)
check('four substats', flower.subs.length === 4, flower.subs.length)
check('substat label is Chinese', flower.subs[0].label === '暴击率', flower.subs[0].label)
// CV = crit rate * 2 + crit damage
check('CV counts crit rate twice', flower.score.cv === 42.8, flower.score.cv)
check('efficiency is a percentage of perfect rolls', flower.score.efficiency > 50 && flower.score.efficiency <= 100, flower.score.efficiency)

const snapshot = buildSnapshot({
  source: 'miyoushe',
  uid: '188337967',
  player: {},
  characters: [
    { id: '10000046', key: 'hutao', name: '胡桃', element: 'pyro', equippedPieces: [], artifacts: [] },
    { id: '10000002', key: 'kamisatoayaka', name: '神里绫华', equippedPieces: [], artifacts: [] },
  ],
  weapons: [],
  artifacts: [],
  note: '计算器',
})
const merged = mergeShowcase(snapshot, showcase, { elapsedMs: 5 })
check('merge keeps the full roster', merged.characters.length === 2, merged.characters.length)
check('merge adds the showcase artifacts', merged.artifacts.length === 2, merged.artifacts.length)
check('artifacts attach to the right character', merged.characters[0].artifacts.length === 2, merged.characters[0].artifacts.length)
check('character without a build stays empty', merged.characters[1].artifacts.length === 0, merged.characters[1].artifacts.length)
check('showcase character is flagged', merged.characters[0].showcase === true, merged.characters[0].showcase)
check('panel stats survive the merge', merged.characters[0].stats && merged.characters[0].stats.hp === 30123, 'stats')
check('character without a build has no panel', !merged.characters[1].stats, 'stats leaked')
check('note names what was upgraded', /展柜/.test(merged.note), merged.note)
check('counts follow the merge', merged.counts.artifacts === 2, merged.counts.artifacts)
// The card and the poster both render per-substat roll counts and a weapon card.
const view = characterView(merged, merged.characters[0].artifacts.length ? merged.characters[0] : merged.characters[0])
check('view exposes the matching element bonus', view.stats && view.stats.elemDmg === 46.6, view.stats && view.stats.elemDmg)
check('view carries the weapon detail for the hover card', Boolean(view.weapon && view.weapon.detail && view.weapon.detail.baseAtk), view.weapon && JSON.stringify(view.weapon).slice(0, 160))
const critSub = view.artifacts[0].subStats.find((sub) => sub.key === 'critRate_')
check('substat roll count is solved from the roll tiers', critSub && critSub.rolls === 3 && critSub.rollsExact === true, critSub && JSON.stringify(critSub))
check('best artifact is exposed', merged.artifacts[0].score.cv >= merged.artifacts[1].score.cv || merged.artifacts.length === 2, 'ordering')


// --- a failed showcase read must not delete account progress -----------------
// The calculator path has no achievements / abyss / artifacts; before this
// guard, one 424 from the mirror emptied the 进度 card and every artifact.
const enriched = buildSnapshot({
  source: 'miyoushe',
  uid: '188337967',
  player: {
    nickname: 'x',
    achievements: '1181',
    abyss: { floor: 12, chamber: 3, stars: 36 },
    stygian: { difficulty: 4, seconds: 255 },
    fetterCount: 63,
  },
  characters: [
    { id: '10000046', key: 'hutao', name: '胡桃', element: 'pyro', rarity: 5, level: 95, levelFromShowcase: true, showcase: true, artifactCount: 1, stats: { hp: 30123 }, artifacts: [], equippedPieces: [] },
  ],
  weapons: [],
  artifacts: [
    { id: 'p1', setKey: 's1', setName: '炽烈的炎之魔女', slot: 'flower', slotZh: '生之花', rarity: 5, level: 20, location: 'hutao', main: { key: 'hp', label: '生命值', text: '4780', value: 4780, percent: false }, subs: [{ key: 'critRate_', label: '暴击率', text: '3.5%', value: 3.5, percent: true }] },
  ],
})
const bare = buildSnapshot({
  source: 'miyoushe',
  uid: '188337967',
  player: { nickname: 'x' },
  characters: [{ id: '10000046', key: 'hutao', name: '胡桃', element: 'pyro', rarity: 5, level: 90, artifacts: [], equippedPieces: [] }],
  weapons: [],
  artifacts: [],
  note: '养成计算器',
})
check('a bare snapshot really has no progress', overview(bare).progress.achievements === '', overview(bare).progress.achievements)
const carried = carryForwardShowcase(enriched, bare)
check('carry-forward keeps achievements', carried && carried.player.achievements === '1181', carried && carried.player.achievements)
check('carry-forward keeps abyss', carried && carried.player.abyss && carried.player.abyss.floor === 12, carried && JSON.stringify(carried.player.abyss))
check('carry-forward keeps the artifacts', carried && carried.artifacts.length === 1, carried && carried.artifacts.length)
check('carry-forward keeps the panel and level', carried && carried.characters[0].stats.hp === 30123 && carried.characters[0].level === 95, 'panel')
check('carry-forward says the data is inherited', /沿用上次数据/.test(carried.note), carried.note)
check('a different account is never carried over', carryForwardShowcase(enriched, { ...bare, uid: '999999999' }) === null, 'uid guard')

// An empty showcase is a normal state, not an error.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ playerInfo: {}, avatarInfoList: [] }) })
const empty = await fetchShowcase('188337967')
check('empty showcase is ok but has no builds', empty.ok === true && empty.builds.length === 0, JSON.stringify(empty).slice(0, 160))
check('empty showcase explains what to do', /角色展柜/.test(empty.note), empty.note)
check('merging an empty showcase is a no-op', mergeShowcase(snapshot, empty) === snapshot)


// --- refinement only exists in the showcase payload --------------------------
// The calculator path never reports 精炼, and buildSnapshot re-links the equipped
// weapon from the snapshot's weapon list — so the merge has to copy it there.
const weaponSnapshot = buildSnapshot({
  source: 'miyoushe',
  uid: '188337967',
  player: {},
  characters: [{ id: '10000046', key: 'hutao', name: '胡桃', element: 'pyro', rarity: 5, level: 90, artifacts: [], equippedPieces: [] }],
  weapons: [{ id: '13501', key: 'homa', name: '护摩之杖', rarity: 5, type: 'polearm', level: 90, location: 'hutao', refinement: null }],
  artifacts: [],
})
const mergedWeapons = mergeShowcase(weaponSnapshot, showcase)
check('showcase refinement lands on the weapon list', mergedWeapons.weapons[0].refinement === 5, JSON.stringify(mergedWeapons.weapons[0]))
check('the equipped weapon keeps its refinement', mergedWeapons.characters[0].equippedWeapon.refinement === 5, mergedWeapons.characters[0].equippedWeapon && mergedWeapons.characters[0].equippedWeapon.refinement)
check('listWeapons exposes the refinement', listWeapons(mergedWeapons, { limit: 10 })[0].refinement === 5, JSON.stringify(listWeapons(mergedWeapons, { limit: 10 })[0]))

globalThis.fetch = realFetch

console.log(`microgg: ${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
