/**
 * 有效词条评分：系数与收益权重。
 *
 * 系数来自用户提供的官方公式表；权重以阿蕾奇诺为样板（大生命0% / 大攻击70% /
 * 大防御0% / 暴击率100% / 暴击伤害100% / 精通50% / 充能0%）。
 */
import { COEFFICIENTS, ROLES, roleOf, scorePiece, scoreSub, weightOf } from '../lib/roles.js'

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
check('crit damage coefficient is 2', COEFFICIENTS.critDMG_ === 2, COEFFICIENTS.critDMG_)
check('elemental mastery coefficient is 0.33', COEFFICIENTS.eleMas === 0.33, COEFFICIENTS.eleMas)
check('energy recharge coefficient is 1.1979', COEFFICIENTS.enerRech_ === 1.1979, COEFFICIENTS.enerRech_)
check('atk% / hp% coefficient is 1.33', COEFFICIENTS.atk_ === 1.33 && COEFFICIENTS.hp_ === 1.33, 'atk/hp')
check('def% coefficient is 1.06', COEFFICIENTS.def_ === 1.06, COEFFICIENTS.def_)
check('flat atk coefficient is 0.398 x 0.5', Math.abs(COEFFICIENTS.atk - 0.398 * 0.5) < 1e-9, COEFFICIENTS.atk)
check('flat hp coefficient is 0.026 x 0.66', Math.abs(COEFFICIENTS.hp - 0.026 * 0.66) < 1e-9, COEFFICIENTS.hp)
check('flat def coefficient is 0.335 x 0.66', Math.abs(COEFFICIENTS.def - 0.335 * 0.66) < 1e-9, COEFFICIENTS.def)
check('elemental damage bonus uses the atk% coefficient', COEFFICIENTS.pyro_dmg_ === 1.33 && COEFFICIENTS.cryo_dmg_ === 1.33, 'elemental')

// 一次满档强化：除爆伤外都落在 7.7-7.8（官方“等预算”）
const maxRoll = { critRate_: 3.89, eleMas: 23.31, enerRech_: 6.48, atk_: 5.83, hp_: 5.83, def_: 7.29 }
for (const [key, value] of Object.entries(maxRoll)) {
  const points = value * COEFFICIENTS[key]
  check('one max roll of ' + key + ' is about 7.7 points', points > 7.6 && points < 7.9, points.toFixed(2))
}

// --- 阿蕾奇诺的权重 ----------------------------------------------------------
const arle = ROLES[roleOf('阿蕾奇诺')]
check('阿蕾奇诺 maps to the crit template', roleOf('阿蕾奇诺') === 'crit', roleOf('阿蕾奇诺'))
check('hp weight is 0', arle.weights.hp === 0, arle.weights.hp)
check('atk weight is 0.7', arle.weights.atk === 0.7, arle.weights.atk)
check('def weight is 0', arle.weights.def === 0, arle.weights.def)
check('crit rate weight is 1', arle.weights.critRate === 1, arle.weights.critRate)
check('crit damage weight is 1', arle.weights.critDMG === 1, arle.weights.critDMG)
check('mastery weight is 0.5', arle.weights.em === 0.5, arle.weights.em)
check('energy recharge weight is 0', arle.weights.er === 0, arle.weights.er)

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
check('阿蕾奇诺 flower scores 70.8', scorePiece(flower, 'crit') === 70.8, scorePiece(flower, 'crit'))
check('a zero-weight stat contributes nothing', scoreSub('hp', 4780, 'crit') === 0, scoreSub('hp', 4780, 'crit'))

// 元素伤害主词条要算进杯子
const goblet = {
  slot: 'goblet',
  main: { key: 'pyro_dmg_', value: 46.6 },
  subs: [{ key: 'critRate_', value: 7.4 }],
}
check('an elemental goblet main counts', scorePiece(goblet, 'crit') === 58.2, scorePiece(goblet, 'crit'))

// 换定位分数会变
check('the same flower scores lower for a support role', scorePiece(flower, 'support') < scorePiece(flower, 'crit'), [scorePiece(flower, 'support'), scorePiece(flower, 'crit')])

if (failures) {
  console.log('roles: ' + (checks - failures) + '/' + checks + ' checks passed')
  process.exit(1)
}
console.log('roles: ' + checks + '/' + checks + ' checks passed')
