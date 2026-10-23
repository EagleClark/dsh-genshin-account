/**
 * Exact substat roll counting.
 *
 * The API never reports "this substat rolled 3 times" — only the final value. But
 * the game rolls from four fixed magnitudes per stat, which are 70/80/90/100% of
 * that stat's maximum roll (the well-known "2.7 / 3.1 / 3.5 / 3.9" table is those
 * four numbers printed rounded down). So a value can be decomposed into the set
 * of legal roll counts that could produce it.
 *
 * A single stat is usually unique on its own. When it is not, the artifact's own
 * total decides: a 5★ +20 piece carries 9 rolls if it started with four
 * substats and 8 if it started with three (one upgrade went into creating the
 * fourth). Solving the four substats together therefore yields both the per-stat
 * counts and the initial substat count.
 *
 * All comparisons happen in the precision the payload prints: percentages to one
 * decimal, flat stats as integers. That keeps float noise out of the matching.
 */
import { STATS } from './stats.js'

const MAX_ROLLS = 6

const round1 = (value) => Math.round(value * 10) / 10

/** The four legal magnitudes for one roll of `key`, at a given rarity. */
function tiersOf(key, rarity) {
  const meta = STATS[key]
  if (!meta || !meta.maxRoll) return null
  const scale = rarity >= 5 ? 1 : 0.8
  return [0.7, 0.8, 0.9, 1].map((step) => meta.maxRoll * step * scale)
}

/** How far a legal total may sit from the printed value for this stat kind. */
function toleranceOf(percent) {
  // Percentages print to one decimal; flat stats print as integers.
  return percent ? 0.06 : 0.55
}

/** Every raw total a run of `count` rolls can reach (no intermediate rounding). */
function reachableSums(tiers, count) {
  let sums = new Set([0])
  for (let i = 0; i < count; i += 1) {
    const next = new Set()
    for (const sum of sums) {
      for (const tier of tiers) next.add(Math.round((sum + tier) * 1000) / 1000)
    }
    sums = next
  }
  return sums
}

/** Which roll counts can print `value` for this stat (may be several). */
export function candidateRolls(key, value, rarity = 5) {
  const meta = STATS[key]
  const tiers = tiersOf(key, rarity)
  if (!meta || !tiers || !Number.isFinite(Number(value))) return []
  const target = Number(value)
  const tolerance = toleranceOf(meta.percent)
  const out = []
  for (let count = 1; count <= MAX_ROLLS; count += 1) {
    for (const sum of reachableSums(tiers, count)) {
      if (Math.abs(sum - target) <= tolerance) {
        out.push(count)
        break
      }
    }
  }
  return out
}

/** How many upgrades an artifact at this API level has received (level is 1-based). */
export function upgradesOf(level) {
  return Math.max(0, Math.min(5, Math.floor((Number(level) - 1) / 4)))
}

/**
 * Solve one artifact's substats together.
 *
 * Returns per-substat counts (exact when unique), the total roll count, and the
 * substat count the artifact started with (3 or 4, null when ambiguous).
 */
export function solveRolls(subStats, { rarity = 5, level = 21 } = {}) {
  const list = (subStats || []).filter((sub) => sub && Number.isFinite(Number(sub.value)))
  if (!list.length) return { perStat: [], total: 0, initial: null, exact: false }

  const five = rarity >= 5
  const upgrades = upgradesOf(level)
  const options = list.map((sub) => {
    const candidates = candidateRolls(sub.key, Number(sub.value), rarity)
    if (candidates.length) return candidates
    // No legal decomposition (a table we do not have, or a value we cannot
    // explain): fall back to the average roll, which is what the old estimate did.
    const meta = STATS[sub.key]
    const average = (meta && meta.avgRoll ? meta.avgRoll : 1) * (five ? 1 : 0.8)
    return [Math.max(1, Math.round(Number(sub.value) / average))]
  })

  const legalTotals = [4 + upgrades, 3 + upgrades]
  const solutions = []
  const walk = (index, picked) => {
    if (index === options.length) {
      const total = picked.reduce((sum, value) => sum + value, 0)
      if (legalTotals.includes(total)) solutions.push([...picked])
      return
    }
    for (const count of options[index]) {
      picked.push(count)
      walk(index + 1, picked)
      picked.pop()
    }
  }
  walk(0, [])

  // Several assignments can add up to a legal total; prefer the one closest to the
  // average-roll expectation, which is what a real roll spread looks like.
  let chosen = null
  if (solutions.length) {
    let best = Infinity
    for (const candidate of solutions) {
      const score = candidate.reduce((sum, count, index) => {
        const meta = STATS[list[index].key]
        const average = (meta && meta.avgRoll ? meta.avgRoll : 1) * (five ? 1 : 0.8)
        return sum + Math.abs(count - Number(list[index].value) / average)
      }, 0)
      if (score < best) {
        best = score
        chosen = candidate
      }
    }
  }

  const decidedByTotal = solutions.length === 1
  const perStat = list.map((sub, index) => ({
    key: sub.key,
    label: sub.label,
    rolls: chosen ? chosen[index] : Math.min(...options[index]),
    // Exact when the value admits a single count, or when the total constraint
    // narrows the whole artifact to one legal assignment.
    exact: options[index].length === 1 || decidedByTotal,
  }))
  const total = perStat.reduce((sum, entry) => sum + entry.rolls, 0)
  const initial = chosen ? total - upgrades : null
  return {
    perStat,
    total,
    initial: initial === 3 || initial === 4 ? initial : null,
    exact: Boolean(chosen) && perStat.every((entry) => entry.exact),
  }
}
