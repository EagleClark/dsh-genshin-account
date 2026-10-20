/**
 * Smoke test for the GOOD source + query layer. No network, no DSH runtime:
 *   node test/smoke-good.mjs
 */
import { fetchSnapshot } from '../lib/sources/good.js'
import { getCharacter, listArtifacts, listCharacters, listWeapons, overview, activeSetEffects, setSummary } from '../lib/model.js'

const fixture = new URL('./fixture-good.json', import.meta.url)
const snapshot = await fetchSnapshot({ goodPath: decodeURIComponent(fixture.pathname).replace(/^\/([A-Za-z]:)/, '$1') })

const fails = []
const check = (name, condition, detail) => {
  if (!condition) fails.push(name + (detail ? ' :: ' + detail : ''))
}

check('characters parsed', snapshot.characters.length === 3, String(snapshot.characters.length))
check('weapons parsed', snapshot.weapons.length === 3, String(snapshot.weapons.length))
check('artifacts parsed', snapshot.artifacts.length === 7, String(snapshot.artifacts.length))

const hutao = getCharacter(snapshot, '胡桃')
check('resolve 胡桃 by chinese name', !hutao.error && hutao.name === '胡桃', JSON.stringify(hutao).slice(0, 120))
check('hutao good key', hutao.key === 'HuTao', hutao.key)
check('hutao element', hutao.element === 'pyro', hutao.element)
check('hutao elementZh', hutao.elementZh === '火', hutao.elementZh)
check('hutao weaponType', hutao.weaponType === 'polearm', hutao.weaponType)
check('hutao equipped weapon', hutao.equippedWeapon && hutao.equippedWeapon.name === '护摩之杖', JSON.stringify(hutao.equippedWeapon))
check('hutao 5 artifacts', hutao.artifacts.length === 5, String(hutao.artifacts.length))
check(
  'artifacts in slot order',
  hutao.artifacts.map((a) => a.slot).join(',') === 'flower,plume,sands,goblet,circlet',
  hutao.artifacts.map((a) => a.slot).join(','),
)

const flower = hutao.artifacts[0]
check('set name resolved', flower.setName === '炽烈的炎之魔女', flower.setName)
check('main stat text', flower.main.text === '4780' && flower.main.label === '生命值', flower.main.text + ' ' + flower.main.label)
check('cv computed', flower.score.cv === 42.8, String(flower.score.cv))
check('efficiency sane', flower.score.efficiency > 0 && flower.score.efficiency <= 100, String(flower.score.efficiency))

const ayaka = getCharacter(snapshot, 'kamisatoayaka')
check('resolve by good key', !ayaka.error && ayaka.name === '神里绫华', ayaka.error || ayaka.name)
check('ayaka artifact count', ayaka.artifacts.length === 2, String(ayaka.artifacts.length))

const traveler = getCharacter(snapshot, '旅行者')
check('traveler resolves', !traveler.error, traveler.error)

const missing = getCharacter(snapshot, '雷电将军')
check('missing character reports error', typeof missing.error === 'string', JSON.stringify(missing).slice(0, 80))

const ov = overview(snapshot)
check('overview counts', ov.counts.characters === 3 && ov.counts.artifacts === 7, JSON.stringify(ov.counts))
check('overview element names', ov.elements['火'] === 1, JSON.stringify(ov.elements))

const topArtifacts = listArtifacts(snapshot, { limit: 3 })
check('top artifacts sorted by cv', topArtifacts[0].cv >= topArtifacts[1].cv, JSON.stringify(topArtifacts.map((a) => a.cv)))

const pyroChars = listCharacters(snapshot, { element: '火' })
check('filter by element alias', pyroChars.length === 1 && pyroChars[0].name === '胡桃', JSON.stringify(pyroChars.map((c) => c.name)))

const polearms = listWeapons(snapshot, { type: '长柄武器' })
check('filter weapons by zh type', polearms.length === 2, JSON.stringify(polearms.map((w) => w.name)))

const sets = setSummary(hutao.artifacts)
check('set summary', sets.length === 1 && sets[0].count === 5, JSON.stringify(sets))
const effects = activeSetEffects(hutao.artifacts)
check('active set effects text', effects.length === 2 && effects[1].includes('4件套'), JSON.stringify(effects))

const byOwner = listArtifacts(snapshot, { owner: '胡桃', limit: 10 })
check('filter artifacts by owner', byOwner.length === 5, String(byOwner.length))

console.log(
  JSON.stringify(
    {
      characters: snapshot.characters.length,
      weapons: snapshot.weapons.length,
      artifacts: snapshot.artifacts.length,
      hutaoTotalCv: listCharacters(snapshot).find((c) => c.name === '胡桃')?.cv,
      flowerScore: flower.score,
      topArtifact: topArtifacts[0],
      setEffects: effects,
    },
    null,
    2,
  ),
)

if (fails.length) {
  console.error('\nFAILED:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
