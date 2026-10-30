/**
 * 等级来源：计算器封顶 90，展柜带真实等级。
 *
 * 角色移出展柜后，计算器会把它报回 90，等级与概览的等级分布就一起错了。
 * 这组断言锁住兜底逻辑：展柜见过的等级记下来，逐次取大值复用。
 */
import { applyLevelHints, levelHintsOf } from '../lib/model.js'

let failures = 0
let checks = 0
function check(label, ok, detail) {
  checks += 1
  if (!ok) {
    failures += 1
    console.log('  FAILED: ' + label + (detail ? ' :: ' + String(detail).slice(0, 240) : ''))
  }
}

// --- 记录：只有带 levelFromShowcase 的等级才算「展柜报过的真实等级」 ---
check(
  'levelHintsOf keeps showcase levels',
  JSON.stringify(levelHintsOf({ characters: [{ id: 10000002, level: 95, levelFromShowcase: true }] })) === '{"10000002":95}',
  JSON.stringify(levelHintsOf({ characters: [{ id: 10000002, level: 95, levelFromShowcase: true }] })),
)
check(
  'levelHintsOf ignores calculator levels',
  Object.keys(levelHintsOf({ characters: [{ id: 1, level: 90 }, { id: 2, level: 80 }] })).length === 0,
)
check('levelHintsOf tolerates an empty snapshot', JSON.stringify(levelHintsOf({})) === '{}')

// --- 套用：计算器 90 + 历史 95 → 95，并标记「不是当前展柜」 ---
const snap = { fetchedAt: 1, characters: [{ id: 10000126, name: '兹白', level: 90 }] }
applyLevelHints(snap, { 10000126: 95 })
check('hint lifts the calculator level', snap.characters[0].level === 95, snap.characters[0].level)
check('hint marks the level as historical', snap.characters[0].levelHintOnly === true)
check('hint records the source', snap.characters[0].levelFromShowcase === true)

// --- 不降级：历史等级低于计算器时不覆盖 ---
const higher = { fetchedAt: 1, characters: [{ id: 2, name: 'B', level: 95 }] }
applyLevelHints(higher, { 2: 90 })
check('hint never lowers a level', higher.characters[0].level === 95, higher.characters[0].level)
check('no stale marker when the hint is not used', higher.characters[0].levelHintOnly === undefined)

// --- 只影响被记录的角色 ---
const mixed = { fetchedAt: 1, characters: [{ id: 3, level: 90 }, { id: 4, level: 90 }] }
applyLevelHints(mixed, { 3: 95 })
check('only hinted characters change', mixed.characters[0].level === 95 && mixed.characters[1].level === 90)
check('unknown hint keys are ignored', applyLevelHints({ characters: [{ id: 5, level: 1 }] }, { 9: 95 }).characters[0].level === 1)
check('null hints are a no-op', applyLevelHints({ characters: [{ id: 6, level: 1 }] }, null).characters[0].level === 1)

console.log(failures === 0 ? `  ${checks} checks passed` : `  ${failures}/${checks} failed`)
if (failures) process.exit(1)
