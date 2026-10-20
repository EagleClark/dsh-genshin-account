/**
 * Account-level extras that are NOT behind the geetest gate.
 *
 * Verified against a live account (no verification needed):
 *   - `card/wapi/getGameRecordCard` → 活跃天数 / 成就达成数 / 深境螺旋 / 幻想剧诗
 *   - `hard_challenge`             → 幻想真境剧诗 progress (difficulty, time)
 *   - `role_combat`                → 幽境危战 progress (difficulty, medals)
 *
 * `spiralAbyss` does answer 1034, so 深境螺旋 only appears on the card.
 * Every piece is optional: a failure returns null instead of breaking the sync.
 */
import { callCalc } from './miyoushe.js'

/** Pull the record card for this exact role (the account can hold several). */
async function readCard(creds) {
  const card = await callCalc('/getGameRecordCard', creds, {
    host: 'card',
    params: { uid: creds.uid },
  })
  const roles = Array.isArray(card && card.list) ? card.list : []
  const exact = roles.find((row) => String(row.game_role_id) === String(creds.uid) && row.has_role !== false) || null
  // The card lists every role bound to the miHoYo account. If the role we are
  // reading is not among them, the metrics are still useful but the nickname
  // and level are somebody else's — so they are dropped rather than shown wrong.
  const role = exact || roles.find((row) => row.has_role !== false) || null
  if (!role) return null
  const metrics = {}
  for (const entry of Array.isArray(role.data) ? role.data : []) {
    if (entry && entry.name) metrics[String(entry.name)] = String(entry.value == null ? '' : entry.value)
  }
  return {
    matched: Boolean(exact),
    nickname: exact ? role.nickname || '' : '',
    level: exact && role.level != null ? Number(role.level) : null,
    regionName: exact ? role.region_name || '' : '',
    activeDays: metrics['活跃天数'] || '',
    achievements: metrics['成就达成数'] || '',
    abyss: metrics['深境螺旋'] || '',
    theater: metrics['幻想剧诗'] || '',
  }
}

async function readHardChallenge(creds) {
  const hard = await callCalc('/hard_challenge', creds, {
    host: 'record',
    params: { role_id: creds.uid, server: creds.server, need_detail: 'false' },
  })
  const row = (Array.isArray(hard && hard.data) ? hard.data : [])[0]
  if (!row || !row.schedule) return null
  return {
    name: row.schedule.name || '',
    end: row.schedule.end_time ? Number(row.schedule.end_time) * 1000 : 0,
    difficulty: row.single && row.single.best ? Number(row.single.best.difficulty) || 0 : 0,
    seconds: row.single && row.single.best ? Number(row.single.best.second) || 0 : 0,
  }
}

async function readRoleCombat(creds) {
  const combat = await callCalc('/role_combat', creds, {
    host: 'record',
    params: { role_id: creds.uid, server: creds.server, need_detail: 'false', active: '1' },
  })
  const row = (Array.isArray(combat && combat.data) ? combat.data : [])[0]
  if (!row || !row.stat) return null
  return {
    difficulty: Number(row.stat.difficulty_id) || 0,
    maxRound: Number(row.stat.max_round_id) || 0,
    medals: Number(row.stat.medal_num) || 0,
    heraldry: Number(row.stat.heraldry) || 0,
    end: row.schedule && row.schedule.end_time ? Number(row.schedule.end_time) * 1000 : 0,
  }
}

/**
 * @param {{ uid: string, server: string, salt: string, appVersion: string, cookie: string }} creds
 * @returns {{ card: object|null, hardChallenge: object|null, roleCombat: object|null }}
 */
export async function fetchExtras(creds) {
  const extras = { card: null, hardChallenge: null, roleCombat: null }
  const tasks = [
    ['card', readCard],
    ['hardChallenge', readHardChallenge],
    ['roleCombat', readRoleCombat],
  ]
  for (const [key, read] of tasks) {
    try {
      extras[key] = await read(creds)
    } catch {
      extras[key] = null
    }
  }
  return extras
}
