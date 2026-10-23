/**
 * Substats roll counting.
 *
 * The API only ships the final value, so the counts are reconstructed from the
 * official four-magnitude roll table. These cases are taken from the account's
 * own artifacts, so a table or solver change shows up immediately.
 */
import { candidateRolls, solveRolls, upgradesOf } from '../lib/rolls.js'
import { publicArtifact } from '../lib/model.js'
import { scoreArtifact } from '../lib/score.js'
import { STATS } from '../lib/stats.js'

let failures = 0
let checks = 0
function check(label, ok, detail) {
  checks += 1
  if (!ok) {
    failures += 1
    console.log('  FAILED: ' + label + (detail ? ' :: ' + String(detail).slice(0, 240) : ''))
  }
}

// --- one stat at a time ------------------------------------------------------
check('crit rate 3.9% is exactly one roll', JSON.stringify(candidateRolls('critRate_', 3.9)) === '[1]', candidateRolls('critRate_', 3.9))
check('crit rate 6.6% is two rolls', JSON.stringify(candidateRolls('critRate_', 6.6)) === '[2]', candidateRolls('critRate_', 6.6))
check('crit rate 10.5% is three rolls', JSON.stringify(candidateRolls('critRate_', 10.5)) === '[3]', candidateRolls('critRate_', 10.5))
check('crit damage 18.7% is three rolls', JSON.stringify(candidateRolls('critDMG_', 18.7)) === '[3]', candidateRolls('critDMG_', 18.7))
check('crit damage 20.2% is three rolls', JSON.stringify(candidateRolls('critDMG_', 20.2)) === '[3]', candidateRolls('critDMG_', 20.2))
// 3 × 16.317 = 48.95 prints as 49: the table's "16" is a rounded 16.317.
check('element mastery 49 is three rolls', JSON.stringify(candidateRolls('eleMas', 49)) === '[3]', candidateRolls('eleMas', 49))
check('flat attack 29 is two rolls', JSON.stringify(candidateRolls('atk', 29)) === '[2]', candidateRolls('atk', 29))
check('energy recharge 5.2% is one roll', JSON.stringify(candidateRolls('enerRech_', 5.2)) === '[1]', candidateRolls('enerRech_', 5.2))

// --- flat vs percent share a label but not a table ---------------------------
// "防御力 65" is a flat roll; "防御力 65%" is impossible (percent rolls top out at
// 7.3%). Treating the two as one stat was the original worry, so pin it down.
check('flat defence 65 resolves against the flat table', JSON.stringify(candidateRolls('def', 65)) === '[3,4]', candidateRolls('def', 65))
check('percent defence 65 is impossible', candidateRolls('def_', 65).length === 0, candidateRolls('def_', 65))
check('flat HP 866 resolves against the flat table', JSON.stringify(candidateRolls('hp', 866)) === '[3,4]', candidateRolls('hp', 866))
check('percent HP 866 is impossible', candidateRolls('hp_', 866).length === 0, candidateRolls('hp_', 866))
check('flat attack 19 is one roll', JSON.stringify(candidateRolls('atk', 19)) === '[1]', candidateRolls('atk', 19))
check('percent attack 19 is impossible', candidateRolls('atk_', 19).length === 0, candidateRolls('atk_', 19))
check('flat and percent are different keys', ['hp', 'atk', 'def'].every((key) => key + '_' in STATS && STATS[key].maxRoll !== STATS[key + '_'].maxRoll), 'keys')

// --- level → upgrades --------------------------------------------------------
check('API level 21 means +20 (five upgrades)', upgradesOf(21) === 5, upgradesOf(21))
check('API level 16 means +15 (three upgrades)', upgradesOf(16) === 3, upgradesOf(16))
check('API level 1 means no upgrades', upgradesOf(1) === 0, upgradesOf(1))

// --- whole artifacts --------------------------------------------------------
// A real four-stat piece: 2 + 2 + 1 + 4 = 9 rolls → started with four substats.
const four = [
  { key: 'critRate_', value: 6.6 },
  { key: 'eleMas', value: 44 },
  { key: 'hp_', value: 4.1 },
  { key: 'def_', value: 26.2 },
]
const solvedFour = solveRolls(four, { rarity: 5, level: 21 })
check('four-stat piece totals 9 rolls', solvedFour.total === 9, solvedFour.total)
check('four-stat piece started with 4 substats', solvedFour.initial === 4, solvedFour.initial)
check('every substat got a count', solvedFour.perStat.every((entry) => entry.rolls >= 1), JSON.stringify(solvedFour.perStat))

// A real three-stat piece: 3 + 2 + 1 + 2 = 8 rolls → started with three substats.
const three = [
  { key: 'eleMas', value: 49 },
  { key: 'atk', value: 29 },
  { key: 'enerRech_', value: 5.2 },
  { key: 'hp', value: 538 },
]
const solvedThree = solveRolls(three, { rarity: 5, level: 21 })
check('three-stat piece totals 8 rolls', solvedThree.total === 8, solvedThree.total)
check('three-stat piece started with 3 substats', solvedThree.initial === 3, solvedThree.initial)

// A value that cannot be explained must not throw or lose the other counts.
const weird = [{ key: 'critRate_', value: 6.6 }, { key: 'eleMas', value: 999 }]
const solvedWeird = solveRolls(weird, { rarity: 5, level: 21 })
check('an impossible value still returns counts', solvedWeird.perStat.length === 2 && solvedWeird.perStat[0].rolls === 2, JSON.stringify(solvedWeird.perStat))

// --- publicArtifact wiring --------------------------------------------------
const artifact = {
  setName: '穹境示现之夜',
  setKey: 'night',
  slot: 'flower',
  slotZh: '生之花',
  rarity: 5,
  level: 21,
  main: { key: 'hp', label: '生命值', text: '4780', value: 4780, percent: false },
  subs: [
    { key: 'def', label: '防御力', text: '44', value: 44, percent: false },
    { key: 'critDMG_', label: '暴击伤害', text: '18.7%', value: 18.7, percent: true },
    { key: 'atk_', label: '攻击力', text: '5.8%', value: 5.8, percent: true },
    { key: 'critRate_', label: '暴击率', text: '6.6%', value: 6.6, percent: true },
  ],
  score: scoreArtifact({
    rarity: 5,
    subs: [
      { key: 'def', value: 44 },
      { key: 'critDMG_', value: 18.7 },
      { key: 'atk_', value: 5.8 },
      { key: 'critRate_', value: 6.6 },
    ],
  }),
}
const pub = publicArtifact(artifact)
check('publicArtifact carries the total roll count', pub.rollsTotal === 8, pub.rollsTotal)
check('publicArtifact infers three initial substats', pub.initialSubstats === 3, pub.initialSubstats)
check('publicArtifact flags exactness per substat', pub.subStats.every((sub) => typeof sub.rollsExact === 'boolean'), JSON.stringify(pub.subStats.map((s) => s.rollsExact)))

if (failures) {
  console.log(`rolls: ${checks - failures}/${checks} checks passed`)
  process.exit(1)
}
console.log(`rolls: ${checks}/${checks} checks passed`)
