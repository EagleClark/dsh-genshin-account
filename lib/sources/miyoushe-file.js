/**
 * "miHoYo record JSON, supplied by the user's own browser" source (国服).
 *
 * Why this exists: the record API answers `retcode 1034` (captcha) when a
 * session created in one browser is replayed from another device — which is
 * exactly what a copied cookie is. The user's own browser, however, is a
 * legitimate client, so letting *it* make the request and handing the response
 * over sidesteps the challenge entirely: no captcha, no OCR, no third-party
 * binary.
 *
 * The accepted payload is the raw response of either endpoint:
 *   GET/POST `/index`            → account summary + every owned character
 *   POST     `/character/detail` → talents, weapon and artifacts per character
 *
 * Both may be pasted, in any order; they are merged into one stored file.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildFromResponses } from './miyoushe.js'

export const id = 'miyoushe-file'
export const label = '米游社导出（浏览器抓取）'

export function storePath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'data', 'dsh-genshin-account', 'miyoushe.json')
}

/** Strip the `{retcode, message, data}` envelope; tolerate a bare `data`. */
function unwrap(value) {
  if (!value || typeof value !== 'object') return null
  if (value.retcode !== undefined) {
    if (value.retcode !== 0) {
      const message = typeof value.message === 'string' && value.message ? value.message : '(无)'
      throw new Error(
        `这段 JSON 是一次失败的响应：retcode=${value.retcode}，服务器信息：${message}。` +
          '请在浏览器里刷新米游社战绩页，确认页面本身能正常显示角色，再复制成功的响应。',
      )
    }
    return value.data && typeof value.data === 'object' ? value.data : null
  }
  return value
}

/**
 * Classify one pasted payload.
 * - `property_map` only appears on a `/character/detail` response.
 * - `role` / `stats` only appear on an `/index` response.
 */
export function classify(value) {
  const data = unwrap(value)
  if (!data) return { kind: 'unknown' }
  const hasDetailMark = data.property_map || data.relic_property_options
  const hasIndexMark = data.role || data.stats
  if (hasDetailMark && !hasIndexMark) return { kind: 'details', data }
  if (hasIndexMark && !hasDetailMark) return { kind: 'index', data }
  if (Array.isArray(data.list) || Array.isArray(data.avatars)) {
    // Ambiguous but list-shaped: treat it as the character-detail list, which is
    // the payload that actually carries artifacts.
    return { kind: 'details', data }
  }
  return { kind: 'unknown' }
}

/** Merge one pasted payload into what is already stored. */
export async function savePasted(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text || '').trim())
  } catch (error) {
    throw new Error('这不是合法 JSON。请复制「响应」全文（以 `{"retcode":0,` 开头），而不是请求头或预览。')
  }
  const classified = classify(parsed)
  if (classified.kind === 'unknown') {
    throw new Error(
      '认不出这段 JSON。需要的是米游社战绩接口的响应体：' +
        '`game_record/app/genshin/api/index` 或 `.../character/detail`，形如 {"retcode":0,"data":{...}}。',
    )
  }
  let stored = {}
  try {
    stored = JSON.parse(await readFile(storePath(), 'utf8')) || {}
  } catch {
    stored = {}
  }
  if (classified.kind === 'index') stored.index = classified.data
  else stored.details = classified.data
  const target = storePath()
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(stored), 'utf8')
  return { kind: classified.kind, stored }
}

/** How much of the picture the stored payloads already cover. */
export function describeStored(stored) {
  const list = (stored && stored.details && (stored.details.list || stored.details.avatars)) ||
    (stored && stored.index && (stored.index.list || stored.index.avatars)) || []
  const detailed = (stored && stored.details && (stored.details.list || stored.details.avatars)) || []
  return {
    hasIndex: Boolean(stored && stored.index),
    hasDetails: Boolean(stored && stored.details),
    characters: list.length,
    withDetail: detailed.length,
  }
}

export async function fetchSnapshot(config) {
  const path = String((config && config.miyousheJsonPath) || '').trim() || storePath()
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new Error(
      '还没有可用的米游社导出文件。请在「设置」页的米游社卡片里，用浏览器抓取接口响应并粘贴/选择文件；' +
        '或者改用本地 GOOD 文件。',
    )
  }
  let stored
  try {
    stored = JSON.parse(text)
  } catch (error) {
    throw new Error(`米游社导出文件不是合法 JSON：${error && error.message ? error.message : String(error)}`)
  }
  if (!stored || (!stored.index && !stored.details)) {
    throw new Error('米游社导出文件里没有可用的接口响应（需要 index 或 character/detail）。')
  }
  const uid = String(
    (config && config.miyousheUid) ||
      (stored.index && stored.index.role && stored.index.role.game_uid) ||
      '',
  ).trim()
  const snapshot = buildFromResponses({ index: stored.index, details: stored.details, uid })
  const described = describeStored(stored)
  snapshot.note =
    '米游社导出（浏览器抓取） · 概览 ' + (described.hasIndex ? '有' : '无') +
    ' · 角色详情 ' + described.withDetail + ' 个'
  return snapshot
}
