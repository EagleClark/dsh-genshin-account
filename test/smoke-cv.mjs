/**
 * CV 评分与评级。
 *
 * 对照表由用户给定：每个部位的 CV 门槛不同，理之冠还因为主词条可能是双暴而整体
 * 抬高；五件套合计另有一套门槛（默认带双暴头）。
 */
import { cvGradeOf, scoreArtifact, scoreBuild, totalCvGradeOf } from '../lib/score.js'

let failures = 0
let checks = 0
function check(label, ok, detail) {
  checks += 1
  if (!ok) {
    failures += 1
    console.log('  FAILED: ' + label + (detail ? ' :: ' + String(detail).slice(0, 240) : ''))
  }
}

function piece(slot, subs, main) {
  return scoreArtifact({ slot, rarity: 5, level: 21, main: main || null, subs })
}

// --- CV 只算副词条（非冠）--------------------------------------------------
const flower = piece('flower', [{ key: 'critRate_', value: 6.6 }, { key: 'critDMG_', value: 18.7 }])
check('flower CV is crit rate x2 + crit damage', flower.cv === 31.9, flower.cv)
check('flower 31.9 is 及格 (30-34)', flower.cvGrade === '及格', flower.cvGrade)

// --- 理之冠：双暴主词条计入 -------------------------------------------------
const critRateCirclet = piece('circlet', [{ key: 'critDMG_', value: 18.7 }], { key: 'critRate_', value: 31.1, percent: true })
check('circlet counts a crit-rate main', critRateCirclet.cv === 80.9, critRateCirclet.cv)
check('crit-rate circlet is 大毕业 (80-94)', critRateCirclet.cvGrade === '大毕业', critRateCirclet.cvGrade)

const critDmgCirclet = piece('circlet', [{ key: 'critRate_', value: 6.6 }], { key: 'critDMG_', value: 62.2, percent: true })
check('circlet counts a crit-damage main', critDmgCirclet.cv === 75.4, critDmgCirclet.cv)
check('crit-damage circlet 75.4 is 小毕业 (70-79)', critDmgCirclet.cvGrade === '小毕业', critDmgCirclet.cvGrade)

const defenseCirclet = piece('circlet', [{ key: 'critDMG_', value: 18.7 }], { key: 'def_', value: 58.3, percent: true })
check('a non-crit circlet main is ignored', defenseCirclet.cv === 18.7, defenseCirclet.cv)
check('non-crit circlet is 拉完了 (<50)', defenseCirclet.cvGrade === '拉完了', defenseCirclet.cvGrade)

// 花的主词条永远不是双暴，不应被计入
const flowerWithMain = piece('flower', [{ key: 'critDMG_', value: 18.7 }], { key: 'hp', value: 4780, percent: false })
check('flower main never counts toward CV', flowerWithMain.cv === 18.7, flowerWithMain.cv)

// --- 单件门槛（按部位）-----------------------------------------------------
const boundaries = [
  ['flower', [29.9, 30, 35, 40, 45, 50], ['拉完了', '及格', '良好', '小毕业', '大毕业', '传家宝']],
  ['plume', [29.9, 30, 35, 40, 45, 50], ['拉完了', '及格', '良好', '小毕业', '大毕业', '传家宝']],
  ['sands', [19.9, 20, 25, 30, 35, 40], ['拉完了', '及格', '良好', '小毕业', '大毕业', '传家宝']],
  ['goblet', [19.9, 20, 25, 30, 35, 40], ['拉完了', '及格', '良好', '小毕业', '大毕业', '传家宝']],
  ['circlet', [49.9, 50, 60, 70, 80, 95], ['拉完了', '及格', '良好', '小毕业', '大毕业', '传家宝']],
]
for (const [slot, values, labels] of boundaries) {
  const actual = values.map((value) => cvGradeOf(slot, value))
  check(slot + ' thresholds match the table', JSON.stringify(actual) === JSON.stringify(labels), JSON.stringify(actual))
}

// --- 五件套总 CV ------------------------------------------------------------
const totalBoundaries = [149.9, 150, 180, 210, 240, 275]
const totalLabels = ['拉完了', '及格', '良好', '小毕业', '大毕业', '传家宝']
check('total thresholds match the table', JSON.stringify(totalBoundaries.map(totalCvGradeOf)) === JSON.stringify(totalLabels), JSON.stringify(totalBoundaries.map(totalCvGradeOf)))

// 一套"传家宝"：花羽沙杯各 50/48/38/38 + 冠 77 = 251（这里只验证汇总与评级）
const build = scoreBuild([
  { score: piece('flower', [{ key: 'critDMG_', value: 50 }]) },
  { score: piece('plume', [{ key: 'critDMG_', value: 48 }]) },
  { score: piece('sands', [{ key: 'critDMG_', value: 38 }]) },
  { score: piece('goblet', [{ key: 'critDMG_', value: 38 }]) },
  { score: piece('circlet', [{ key: 'critDMG_', value: 15 }], { key: 'critRate_', value: 31.1, percent: true }) },
])
check('build CV sums the five pieces', build.cv === 251.2, build.cv)
check('251.2 total is 大毕业 (240-274)', build.cvGrade === '大毕业', build.cvGrade)
check('build keeps the efficiency grade too', typeof build.grade === 'string' && build.grade.length === 1, build.grade)


// 五件都卡在各自档位下限时，总评必须与单件档位一致
const floors = {
  '及格': [30, 30, 20, 20, 50],
  '良好': [35, 35, 25, 25, 60],
  '小毕业': [40, 40, 30, 30, 70],
  '大毕业': [45, 45, 35, 35, 80],
  '传家宝': [50, 50, 40, 40, 95],
}
for (const [label, pieces] of Object.entries(floors)) {
  const sum = pieces.reduce((a, b) => a + b, 0)
  check('piece floors for ' + label + ' sum to the same tier', totalCvGradeOf(sum) === label, sum + ' -> ' + totalCvGradeOf(sum))
}

if (failures) {
  console.log('cv: ' + (checks - failures) + '/' + checks + ' checks passed')
  process.exit(1)
}
console.log('cv: ' + checks + '/' + checks + ' checks passed')
