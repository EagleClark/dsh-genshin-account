/**
 * Artifact scoring.
 *
 * Two numbers, both deliberately explainable rather than a black box:
 *
 * - `cv` (暴击值 / crit value) — the community standard `critRate * 2 + critDmg`
 *   of an artifact's **substats**. It says nothing about a character's needs.
 * - `efficiency` — how many "perfect rolls" the substats carry, i.e. every
 *   substat value divided by that stat's highest 5★ roll, summed and divided by
 *   the roll budget of the artifact (9 for a 5★ +20, 7 for a 4★ +16). This is
 *   role-independent: 100% means every substat roll was a max roll.
 *
 * Neither is a replacement for a per-character damage model; they are the two
 * numbers a `genshin optimizer` user reads before deciding to keep a piece.
 */
import { STATS } from './stats.js'

const ROLL_BUDGET = { 5: 9, 4: 7 }

/**
 * CV 评级。
 *
 * 每个部位的 CV 门槛不同：花羽只看副词条，沙杯的副词条上限更低，而理之冠的
 * 主词条本身可能就是双暴（暴击率 31.1% ×2 或暴伤 62.2%），所以门槛整体抬高。
 * 一套双暴头的五件套总 CV 大致落在 180–290 之间。
 */
export const CV_LABELS = ['拉完了', '及格', '良好', '小毕业', '大毕业', '传家宝']

const CV_TIERS = {
  flower: [30, 35, 40, 45, 50],
  plume: [30, 35, 40, 45, 50],
  sands: [20, 25, 30, 35, 40],
  goblet: [20, 25, 30, 35, 40],
  circlet: [50, 60, 70, 80, 95],
}

/**
 * 五件套总 CV 的门槛（默认带双暴头）。
 *
 * 直接取「五件各自档位下限之和」，这样单件评级和总评才是同一套标尺：
 *   及格   30+30+20+20+50 = 150
 *   良好   35+35+25+25+60 = 180
 *   小毕业 40+40+30+30+70 = 210
 *   大毕业 45+45+35+35+80 = 240
 *   传家宝 50+50+40+40+95 = 275
 */
const TOTAL_CV_TIERS = [150, 180, 210, 240, 275]

function tierLabel(tiers, value) {
  let index = 0
  for (const tier of tiers) {
    if (value >= tier) index += 1
    else break
  }
  return CV_LABELS[index]
}

/** 单个部位的 CV 评级（部位不同门槛不同）。 */
export function cvGradeOf(slot, cv) {
  return tierLabel(CV_TIERS[slot] || CV_TIERS.flower, Number(cv) || 0)
}

/** 五件套总 CV 的评级。 */
export function totalCvGradeOf(cv) {
  return tierLabel(TOTAL_CV_TIERS, Number(cv) || 0)
}

/** Multiply the 5★ max roll by the rarity's roll scale (4★ rolls are 0.8x). */
const rollScale = (rarity) => (rarity >= 5 ? 1 : 0.8)

/**
 * Crit value of one artifact.
 *
 * Substats always count. A 理之冠 whose **main** stat is crit rate or crit damage
 * counts it too — that main stat is the single biggest crit source on the piece
 * (31.1% rate → 62.2 CV, or 62.2% damage → 62.2 CV), and leaving it out made every
 * crit circlet look worse than a flower.
 */
export function scoreArtifact(artifact) {
  const subs = Array.isArray(artifact.subs) ? artifact.subs : []
  const rarity = Number(artifact.rarity) || 5
  let cv = 0
  const main = artifact.main || null
  if (main && artifact.slot === 'circlet') {
    const value = Number(main.value) || 0
    if (main.key === 'critRate_') cv += value * 2
    else if (main.key === 'critDMG_') cv += value
  }
  let rolls = 0
  let counted = 0
  for (const sub of subs) {
    const meta = STATS[sub.key]
    const value = Number(sub.value)
    if (!Number.isFinite(value)) continue
    if (sub.key === 'critRate_') cv += value * 2
    if (sub.key === 'critDMG_') cv += value
    if (meta && meta.maxRoll > 0) {
      rolls += value / (meta.maxRoll * rollScale(rarity))
      counted += 1
    }
  }
  const budget = ROLL_BUDGET[rarity >= 5 ? 5 : 4]
  const efficiency = budget > 0 ? Math.min(100, (rolls / budget) * 100) : 0
  const cvValue = Math.round(cv * 10) / 10
  return {
    cv: cvValue,
    cvGrade: cvGradeOf(artifact.slot, cvValue),
    efficiency: Math.round(efficiency),
    grade: gradeOf(cv, efficiency),
    rolls: Math.round(rolls * 100) / 100,
    substats: counted,
  }
}

/** A coarse label so the agent can say "这件是极品" without inventing thresholds. */
function gradeOf(cv, efficiency) {
  if (cv >= 40 || efficiency >= 85) return '极品'
  if (cv >= 30 || efficiency >= 70) return '优秀'
  if (cv >= 20 || efficiency >= 55) return '可用'
  return '一般'
}

/** Crit value of one substat pair, exposed for the "why" explanation. */
export function critValueOf(substats) {
  let cv = 0
  for (const sub of substats || []) {
    if (sub.key === 'critRate_') cv += Number(sub.value || 0) * 2
    if (sub.key === 'critDMG_') cv += Number(sub.value || 0)
  }
  return Math.round(cv * 10) / 10
}

/**
 * Score a whole equipped build (the five pieces on one character).
 *
 * Same two inputs as a single piece, aggregated honestly: total CV, average
 * efficiency, and the average CV per piece — the last one is what makes a
 * five-piece comparison fair when a character only has four pieces shown.
 *
 * The letter grade is deliberately coarse. CV is only the *crit* dimension: a
 * build that stacks crit but ignores the character's real needs (EM for a
 * reaction team, ER for a burst-dependent one) still scores high here. The
 * grade says "how good are these rolls", not "is this the right build".
 */
export function scoreBuild(artifacts) {
  const list = (artifacts || []).filter((artifact) => artifact && artifact.score)
  if (!list.length) return null
  const totalCv = list.reduce((sum, artifact) => sum + artifact.score.cv, 0)
  const totalEfficiency = list.reduce((sum, artifact) => sum + artifact.score.efficiency, 0)
  const cv = Math.round(totalCv * 10) / 10
  const efficiency = Math.round(totalEfficiency / list.length)
  const averageCv = Math.round((totalCv / list.length) * 10) / 10
  let grade = 'C'
  let label = '待提升'
  if (averageCv >= 35 || efficiency >= 85) {
    grade = 'S'
    label = '顶级'
  } else if (averageCv >= 28 || efficiency >= 70) {
    grade = 'A'
    label = '优秀'
  } else if (averageCv >= 20 || efficiency >= 55) {
    grade = 'B'
    label = '可用'
  }
  return {
    count: list.length,
    cv,
    // 五件套总 CV 的评级（默认按带双暴头的情况定的门槛）
    cvGrade: totalCvGradeOf(cv),
    efficiency,
    averageCv,
    grade,
    label,
  }
}
