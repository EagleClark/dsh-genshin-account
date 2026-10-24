/**
 * 有效词条评分：系数与收益权重。
 *
 * 系数来自用户提供的官方公式表；权重以阿蕾奇诺为样板（大生命0% / 大攻击70% /
 * 大防御0% / 暴击率100% / 暴击伤害100% / 精通50% / 充能0%）。
 */
import { COEFFICIENTS, CHARACTER_WEIGHTS, EFF_LABELS, ROLES, hasTableWeights, pieceGradeOf, roleOf, scorePiece, scoreSub, totalGradeOf, weightOf, weightsFor } from '../lib/roles.js'

let failures = 0
let checks = 0
function check(label, ok, detail) {
  checks += 1
  if (!ok) {
    failures += 1
    console.log('  FAILED: ' + label + (detail ? ' :: ' + String(detail).slice(0, 240) : ''))
  }
}

// --- 系数与官方表一致 --------------------------------------------------------
check('crit rate coefficient is 2', COEFFICIENTS.critRate_ === 2, COEFFICIENTS.critRate_)
check('crit damage coefficient is 1', COEFFICIENTS.critDMG_ === 1, COEFFICIENTS.critDMG_)
check('elemental mastery coefficient is 0.33', COEFFICIENTS.eleMas === 0.33, COEFFICIENTS.eleMas)
check('energy recharge coefficient is 1.1979', COEFFICIENTS.enerRech_ === 1.1979, COEFFICIENTS.enerRech_)
check('atk% / hp% coefficient is 1.33', COEFFICIENTS.atk_ === 1.33 && COEFFICIENTS.hp_ === 1.33, 'atk/hp')
check('def% coefficient is 1.06', COEFFICIENTS.def_ === 1.06, COEFFICIENTS.def_)
check('flat atk coefficient is 0.398 x 0.5', Math.abs(COEFFICIENTS.atk - 0.398 * 0.5) < 1e-9, COEFFICIENTS.atk)
check('flat hp coefficient is 0.026 x 0.66', Math.abs(COEFFICIENTS.hp - 0.026 * 0.66) < 1e-9, COEFFICIENTS.hp)
check('flat def coefficient is 0.335 x 0.66', Math.abs(COEFFICIENTS.def - 0.335 * 0.66) < 1e-9, COEFFICIENTS.def)
check('elemental damage bonus uses the atk% coefficient', COEFFICIENTS.pyro_dmg_ === 1.33 && COEFFICIENTS.cryo_dmg_ === 1.33, 'elemental')

// 一次满档强化：除爆伤外都落在 7.7-7.8（官方“等预算”）
const maxRoll = { critRate_: 3.89, critDMG_: 7.77, eleMas: 23.31, enerRech_: 6.48, atk_: 5.83, hp_: 5.83, def_: 7.29 }
for (const [key, value] of Object.entries(maxRoll)) {
  const points = value * COEFFICIENTS[key]
  check('one max roll of ' + key + ' is about 7.7 points', points > 7.6 && points < 7.9, points.toFixed(2))
}

// --- 官方权重表：阿蕾奇诺 ----------------------------------------------------
const arle = weightsFor('阿蕾奇诺')
check('阿蕾奇诺 has table weights', hasTableWeights('阿蕾奇诺'), hasTableWeights('阿蕾奇诺'))
check('阿蕾奇诺 still maps to the crit template', roleOf('阿蕾奇诺') === 'crit', roleOf('阿蕾奇诺'))
check('hp weight is 0', arle.hp === 0, arle.hp)
check('atk weight is 0.7', arle.atk === 0.7, arle.atk)
check('def weight is 0', arle.def === 0, arle.def)
check('crit rate weight is 1', arle.critRate === 1, arle.critRate)
check('crit damage weight is 1', arle.critDMG === 1, arle.critDMG)
check('mastery weight is 0.5', arle.em === 0.5, arle.em)
check('energy recharge weight is 0', arle.er === 0, arle.er)

// 抽查表里其他几个角色
const tableChecks = [
  ['那维莱特', { hp: 1, atk: 0, def: 0, critRate: 1, critDMG: 1, em: 0, er: 0.3, heal: 0 }],
  ['班尼特', { hp: 1, atk: 0.5, def: 0, critRate: 0.5, critDMG: 0.5, em: 0, er: 1, heal: 1 }],
  ['芭芭拉', { hp: 1, atk: 0.5, def: 0, critRate: 1, critDMG: 1, em: 0, er: 0.55, heal: 1 }],
  ['诺艾尔', { hp: 0, atk: 0.5, def: 1, critRate: 1, critDMG: 1, em: 0, er: 0.55, heal: 0.99 }],
]
for (const [name, expected] of tableChecks) {
  const actual = weightsFor(name)
  check(name + ' weights match the table', JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify(actual))
}
check('the table covers over 100 characters', Object.keys(CHARACTER_WEIGHTS).length >= 100, Object.keys(CHARACTER_WEIGHTS).length)

// 治疗列（第 8 项）来自 Miao 表
check('莉奈娅 carries a heal weight', weightsFor('莉奈娅').heal === 0.99, weightsFor('莉奈娅').heal)
check('班尼特 carries a heal weight', weightsFor('班尼特').heal === 1, weightsFor('班尼特').heal)
check('阿蕾奇诺 has no heal weight', weightsFor('阿蕾奇诺').heal === 0, weightsFor('阿蕾奇诺').heal)
check('兹白 uses the defence template', weightsFor('兹白').def === 1 && weightsFor('兹白').critRate === 1, JSON.stringify(weightsFor('兹白')))
check('丝柯克 uses the attack crit template', weightsFor('丝柯克').atk === 1 && weightsFor('丝柯克').em === 0, JSON.stringify(weightsFor('丝柯克')))
check('an unknown character falls back to a template', weightsFor('不存在的角色') === ROLES.generic.weights, 'fallback')

// --- 用她的真实生之花验算 ----------------------------------------------------
// 生命值 4780(主) / 攻击 27 / 精通 21 / 暴击率 9.3 / 暴伤 22.5
const flower = {
  slot: 'flower',
  main: { key: 'hp', value: 4780 },
  subs: [
    { key: 'atk', value: 27 },
    { key: 'eleMas', value: 21 },
    { key: 'critRate_', value: 9.3 },
    { key: 'critDMG_', value: 22.5 },
  ],
}
// 只算副词条：攻击 3.8 + 精通 3.5 + 暴击 18.6 + 爆伤 22.5
check('阿蕾奇诺 flower scores 48.3', scorePiece(flower, 'crit') === 48.3, scorePiece(flower, 'crit'))
check('a zero-weight stat contributes nothing', scoreSub('hp', 4780, 'crit') === 0, scoreSub('hp', 4780, 'crit'))

// 只有理之冠的主词条计入；其它部位主词条不计
const gobletA = { slot: 'goblet', main: { key: 'pyro_dmg_', value: 46.6 }, subs: [{ key: 'critRate_', value: 7.4 }] }
const gobletB = { slot: 'goblet', main: { key: 'def_', value: 58.3 }, subs: [{ key: 'critRate_', value: 7.4 }] }
check('a goblet main stat does not score', scorePiece(gobletA, 'crit') === 14.8, scorePiece(gobletA, 'crit'))
check('changing a goblet main stat changes nothing', scorePiece(gobletA, 'crit') === scorePiece(gobletB, 'crit'), [scorePiece(gobletA, 'crit'), scorePiece(gobletB, 'crit')])

// 理之冠例外：双暴主词条要计入
const circlet = { slot: 'circlet', main: { key: 'critDMG_', value: 62.2 }, subs: [{ key: 'critRate_', value: 7.8 }] }
check('a circlet crit-damage main counts', scorePiece(circlet, 'crit') === 77.8, scorePiece(circlet, 'crit'))
const circletHp = { slot: 'circlet', main: { key: 'hp_', value: 46.6 }, subs: [{ key: 'critRate_', value: 7.8 }] }
check('a hp circlet main is worth nothing for a crit role', scorePiece(circletHp, 'crit') === 15.6, scorePiece(circletHp, 'crit'))

// 换定位分数会变
check('the same flower scores lower for a support role', scorePiece(flower, 'support') < scorePiece(flower, 'crit'), [scorePiece(flower, 'support'), scorePiece(flower, 'crit')])


// --- 六档评级（单件 / 合计）--------------------------------------------------
const pieceBands = [22.9, 23, 31, 39, 47, 54]
check('piece bands map to the six labels', JSON.stringify(pieceBands.map(pieceGradeOf)) === JSON.stringify(['拉完了', '及格', '良好', '小毕业', '大毕业', '传家宝']), JSON.stringify(pieceBands.map(pieceGradeOf)))
const totalBands = [115.9, 116, 155, 194, 232, 271]
check('total bands map to the six labels', JSON.stringify(totalBands.map(totalGradeOf)) === JSON.stringify(['拉完了', '及格', '良好', '小毕业', '大毕业', '传家宝']), JSON.stringify(totalBands.map(totalGradeOf)))
check('six labels are used for both scales', EFF_LABELS.length === 6, EFF_LABELS.length)

if (failures) {
  console.log('roles: ' + (checks - failures) + '/' + checks + ' checks passed')
  process.exit(1)
}
console.log('roles: ' + checks + '/' + checks + ' checks passed')
