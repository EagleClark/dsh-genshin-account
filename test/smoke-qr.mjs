/**
 * QR encoder test — compares against golden matrices that were produced by the
 * reference `qrcode` package (byte mode, EC level M) and are stored as a fixture,
 * so this test needs no encoder to compare against and no network.
 *   node test/smoke-qr.mjs
 */
import { readFileSync } from 'node:fs'
import { encode, pickVersion, toSvg } from '../lib/qr.js'

const fails = []
const check = (name, condition, detail) => {
  if (!condition) fails.push(name + (detail ? ' :: ' + detail : ''))
}

const fixtures = JSON.parse(readFileSync(new URL('./fixture-qr.json', import.meta.url), 'utf8'))

for (const fixture of fixtures) {
  const got = encode(fixture.text)
  check(`size for ${fixture.text.slice(0, 18)}`, got.size === fixture.size, `${got.size} vs ${fixture.size}`)
  if (got.size !== fixture.size) continue
  let diff = 0
  let firstDiff = null
  for (let row = 0; row < fixture.size; row += 1) {
    for (let col = 0; col < fixture.size; col += 1) {
      const expected = fixture.rows[row][col] === '#'
      const actual = Boolean(got.modules[row][col])
      if (expected !== actual) {
        diff += 1
        if (!firstDiff) firstDiff = [row, col]
      }
    }
  }
  check(`matrix matches the reference for ${fixture.text.slice(0, 18)}`, diff === 0, `${diff} cells differ, first at ${JSON.stringify(firstDiff)}`)
}

// Version selection: byte mode, EC M capacities 16/28/44/64/86/108/124/154/182/216.
check('1 byte fits version 1', pickVersion(1) === 1, String(pickVersion(1)))
// v1 holds 16 data codewords = 128 bits; 12 of them are the header.
check('14 bytes fits version 1', pickVersion(14) === 1, String(pickVersion(14)))
check('15 bytes needs version 2', pickVersion(15) === 2, String(pickVersion(15)))
check('100 bytes needs version 6', pickVersion(100) === 6, String(pickVersion(100)))
check('oversized payloads are refused', (() => {
  try {
    pickVersion(400)
    return false
  } catch {
    return true
  }
})())

// The SVG we hand to the login panel must be self-contained and scoped.
const svg = toSvg('https://example.com/', { scale: 4, margin: 2 })
check('svg is a single svg element', svg.startsWith('<svg') && svg.endsWith('</svg>'), svg.slice(0, 40))
check('svg carries a viewBox', svg.includes('viewBox="0 0 29 29"'), svg.slice(0, 120))
check('svg references nothing external', !svg.includes('<image') && !svg.includes('href=') && !svg.includes('url('), svg.slice(0, 120))
check('svg draws dark modules as paths', (svg.match(/M\d+ \d+h1v1h-1z/g) || []).length > 50, String((svg.match(/M\d+ \d+h1v1h-1z/g) || []).length))

if (fails.length) {
  console.error('\nFAILED:\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
