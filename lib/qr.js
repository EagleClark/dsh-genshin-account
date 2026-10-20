/**
 * A small, dependency-free QR encoder (byte mode, error-correction level M).
 *
 * Why hand-rolled: the plugin's only runtime dependency was `qrcode`, and every
 * `dsh plugin add` has to fetch it from a registry. A plugin whose install can
 * fail because a CDN is slow is a bad plugin, and the only thing we need a QR
 * for is the login screen — one URL, one image. So the encoder lives here.
 *
 * Implements the parts of ISO/IEC 18004 that matter for short byte payloads:
 *   - versions 1..10, EC level M (enough for ~200 bytes of URL)
 *   - byte mode, padding, Reed-Solomon over GF(256)
 *   - all eight masks, chosen by the standard penalty rules
 *   - format information with its BCH code
 *
 * The test suite compares the produced matrix against the `qrcode` package for
 * several payloads, so "it looks like a QR" is not the bar — bit equality is.
 */

const EC_LEVEL_M = 0

/** Per version (1..10) at EC level M: [ecCodewordsPerBlock, ...blockDataSizes]. */
const BLOCKS_M = {
  1: [10, 16],
  2: [16, 28],
  3: [26, 44],
  4: [18, 32, 32],
  5: [24, 43, 43],
  6: [16, 27, 27, 27, 27],
  7: [18, 31, 31, 31, 31],
  8: [22, 38, 38, 39, 39],
  9: [22, 36, 36, 37, 37],
  10: [26, 43, 43, 43, 43, 44],
}

/** Alignment-pattern centre coordinates per version. */
const ALIGNMENT = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
}

// --- GF(256) arithmetic ----------------------------------------------------
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]
})()

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

/** Generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree) {
  let poly = [1]
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j]
      next[j + 1] ^= mul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

/** Reed-Solomon remainder of `data` divided by the generator. */
function ecCodewords(data, ecLength) {
  const gen = generatorPoly(ecLength)
  const out = new Array(ecLength).fill(0)
  for (const byte of data) {
    const factor = byte ^ out[0]
    out.shift()
    out.push(0)
    if (factor !== 0) {
      for (let i = 0; i < ecLength; i += 1) out[i] ^= mul(gen[i + 1], factor)
    }
  }
  return out
}

// --- bit buffer ------------------------------------------------------------
class Bits {
  constructor() {
    this.bits = []
  }
  push(value, length) {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1)
  }
  get length() {
    return this.bits.length
  }
  toBytes() {
    const bytes = []
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (this.bits[i + j] || 0)
      bytes.push(byte)
    }
    return bytes
  }
}

/** Total data codewords available for a version at EC level M. */
function dataCodewordCount(version) {
  const table = BLOCKS_M[version]
  if (!table) throw new Error(`QR version ${version} is not supported`)
  return table.slice(1).reduce((sum, size) => sum + size, 0)
}

/** Pick the smallest version whose data capacity fits `byteLength` bytes. */
export function pickVersion(byteLength) {
  for (let version = 1; version <= 10; version += 1) {
    const capacity = dataCodewordCount(version)
    // 4 bits mode + 8/16 bits length + payload + up to 4 terminator bits.
    const lengthBits = version < 10 ? 8 : 16
    const needed = Math.ceil((4 + lengthBits + byteLength * 8) / 8)
    if (needed <= capacity) return version
  }
  throw new Error('内容太长，超出内置二维码编码器的支持范围（版本 1-10）')
}

/** Build the full sequence of data + EC codewords, interleaved per block. */
function buildCodewords(text, version) {
  const [ecLength, ...blockSizes] = BLOCKS_M[version]
  const totalData = dataCodewordCount(version)
  const bytes = Buffer.from(text, 'utf8')

  const bits = new Bits()
  bits.push(4, 4) // byte mode
  bits.push(bytes.length, version < 10 ? 8 : 16)
  for (const byte of bytes) bits.push(byte, 8)
  // Terminator, up to four zero bits.
  const capacityBits = totalData * 8
  const terminator = Math.min(4, capacityBits - bits.length)
  if (terminator > 0) bits.push(0, terminator)
  // Pad to a byte boundary, then alternate 0xEC / 0x11.
  while (bits.length % 8 !== 0) bits.push(0, 1)
  let data = bits.toBytes()
  const pads = [0xec, 0x11]
  let padIndex = 0
  while (data.length < totalData) {
    data.push(pads[padIndex % 2])
    padIndex += 1
  }

  // Split into blocks, compute EC per block.
  const blocks = []
  let offset = 0
  for (const size of blockSizes) {
    const chunk = data.slice(offset, offset + size)
    offset += size
    blocks.push({ data: chunk, ec: ecCodewords(chunk, ecLength) })
  }

  // Interleave data codewords, then EC codewords.
  const out = []
  const maxData = Math.max(...blocks.map((block) => block.data.length))
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i])
  }
  for (let i = 0; i < ecLength; i += 1) {
    for (const block of blocks) out.push(block.ec[i])
  }
  return out
}

// --- matrix ----------------------------------------------------------------
const SIZE_OF = (version) => version * 4 + 17

function placeFinder(matrix, size, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r
      const cc = col + c
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6
      const ring = (r === 0 || r === 6 || c === 0 || c === 6) && inside
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4
      matrix[rr][cc] = ring || core ? 1 : 0
    }
  }
}

function placeAlignment(matrix, size, version) {
  const centres = ALIGNMENT[version] || []
  for (const row of centres) {
    for (const col of centres) {
      // Skip the three corners occupied by finder patterns.
      if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const ring = Math.max(Math.abs(r), Math.abs(c))
          matrix[row + r][col + c] = ring === 2 || ring === 0 ? 1 : 0
        }
      }
    }
  }
}

const formatBits = (mask) => {
  // 5 data bits (000 = M, 3 = mask) + BCH(15,5), then XOR 0x5412.
  const data = (EC_LEVEL_M << 3) | mask
  let value = data << 10
  for (let i = 4; i >= 0; i -= 1) {
    if ((value >>> (i + 10)) & 1) value ^= 0x537 << i
  }
  return ((data << 10) | value) ^ 0x5412
}

/**
 * Version information block — required for versions 7 and up.
 * 18 bits: the 6-bit version number plus a BCH(18,6) check, mirrored into two
 * 3x6 areas beside the finder patterns. Omitting it makes every version >= 7
 * matrix wrong, which is exactly what the reference comparison caught.
 */
function placeVersionInfo(matrix, size, version) {
  if (version < 7) return
  let bits = version << 12
  for (let i = 11; i >= 0; i -= 1) {
    if ((bits >>> (i + 12)) & 1) bits ^= 0x1f25 << i
  }
  bits = (version << 12) | bits
  for (let i = 0; i < 18; i += 1) {
    const bit = (bits >>> i) & 1
    const a = size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    matrix[b][a] = bit
    matrix[a][b] = bit
  }
}

function placeFormat(matrix, size, mask) {  const bits = formatBits(mask)
  const bit = (index) => ((bits >>> index) & 1) === 1

  // The spec writes these as (x, y) = (column, row); matrix is [row][column].
  for (let i = 0; i <= 5; i += 1) matrix[i][8] = bit(i) ? 1 : 0
  matrix[7][8] = bit(6) ? 1 : 0
  matrix[8][8] = bit(7) ? 1 : 0
  matrix[8][7] = bit(8) ? 1 : 0
  for (let i = 9; i < 15; i += 1) matrix[8][14 - i] = bit(i) ? 1 : 0

  for (let i = 0; i < 8; i += 1) matrix[8][size - 1 - i] = bit(i) ? 1 : 0
  for (let i = 8; i < 15; i += 1) matrix[size - 15 + i][8] = bit(i) ? 1 : 0
  matrix[size - 8][8] = 1 // dark module
}

const maskFn = (mask, row, col) => {
  switch (mask) {
    case 0: return (row + col) % 2 === 0
    case 1: return row % 2 === 0
    case 2: return col % 3 === 0
    case 3: return (row + col) % 3 === 0
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0
  }
}

/** Exposed for tests: the data+EC codeword stream for a payload. */
export function debugCodewords(text, version) {
  return buildCodewords(String(text), version || pickVersion(Buffer.from(String(text), 'utf8').length))
}

/** Apply a mask to the data region (function patterns keep their values). */
function applyMask(matrix, reserved, size, mask) {
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (reserved[row][col]) continue
      if (maskFn(mask, row, col)) matrix[row][col] ^= 1
    }
  }
}

/** Standard penalty score, used to choose the mask. */
function penalty(matrix, size) {
  let score = 0
  // Rule 1: runs of five or more same-coloured modules.
  for (let i = 0; i < size; i += 1) {
    for (const horizontal of [true, false]) {
      let run = 1
      let prev = horizontal ? matrix[i][0] : matrix[0][i]
      for (let j = 1; j < size; j += 1) {
        const value = horizontal ? matrix[i][j] : matrix[j][i]
        if (value === prev) {
          run += 1
        } else {
          if (run >= 5) score += run - 2
          run = 1
          prev = value
        }
      }
      if (run >= 5) score += run - 2
    }
  }
  // Rule 2: 2x2 blocks of one colour.
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const value = matrix[row][col]
      if (value === matrix[row][col + 1] && value === matrix[row + 1][col] && value === matrix[row + 1][col + 1]) {
        score += 3
      }
    }
  }
  // Rule 3: finder-like patterns 1011101 with four light modules beside them.
  const pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
  const reversed = pattern.slice().reverse()
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= size - 11; j += 1) {
      let horizontal = true
      let horizontalRev = true
      let vertical = true
      let verticalRev = true
      for (let k = 0; k < 11; k += 1) {
        if (matrix[i][j + k] !== pattern[k]) horizontal = false
        if (matrix[i][j + k] !== reversed[k]) horizontalRev = false
        if (matrix[j + k][i] !== pattern[k]) vertical = false
        if (matrix[j + k][i] !== reversed[k]) verticalRev = false
      }
      if (horizontal) score += 40
      if (horizontalRev) score += 40
      if (vertical) score += 40
      if (verticalRev) score += 40
    }
  }
  // Rule 4: dark/light balance.
  let dark = 0
  for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) dark += matrix[row][col]
  const ratio = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10
  return score
}

/**
 * Encode `text` and return the module matrix (1 = dark).
 * @returns {{ size: number, modules: number[][] }}
 */
export function encode(text) {
  const value = String(text)
  const version = pickVersion(Buffer.from(value, 'utf8').length)
  const size = SIZE_OF(version)
  const codewords = buildCodewords(value, version)

  const matrix = Array.from({ length: size }, () => new Array(size).fill(0))
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false))

  // Function patterns.
  placeFinder(matrix, size, 0, 0)
  placeFinder(matrix, size, 0, size - 7)
  placeFinder(matrix, size, size - 7, 0)
  for (let i = 8; i < size - 8; i += 1) {
    matrix[6][i] = i % 2 === 0 ? 1 : 0
    matrix[i][6] = i % 2 === 0 ? 1 : 0
  }
  placeAlignment(matrix, size, version)
  placeVersionInfo(matrix, size, version)
  placeFormat(matrix, size, 0)

  // Mark function areas as reserved. Exact rectangles: a finder plus its
  // separator is 8x8, and the format strip is row/column 8 — marking one row or
  // column too many silently steals data modules and shifts every following bit.
  const mark = (row, col) => {
    if (row >= 0 && row < size && col >= 0 && col < size) reserved[row][col] = true
  }
  for (const [rowFrom, rowTo, colFrom, colTo] of [
    [0, 7, 0, 7], // top-left finder + separator
    [0, 7, size - 8, size - 1], // top-right
    [size - 8, size - 1, 0, 7], // bottom-left
  ]) {
    for (let row = rowFrom; row <= rowTo; row += 1) {
      for (let col = colFrom; col <= colTo; col += 1) mark(row, col)
    }
  }
  for (let i = 0; i < size; i += 1) {
    mark(6, i)
    mark(i, 6)
  }
  const centres = ALIGNMENT[version] || []
  for (const row of centres) {
    for (const col of centres) {
      if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue
      for (let r = -2; r <= 2; r += 1) for (let c = -2; c <= 2; c += 1) mark(row + r, col + c)
    }
  }
  // Version-info areas (versions 7+): 3x6 block at top-right and bottom-left.
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      mark(b, a)
      mark(a, b)
    }
  }
  // Format strips: row 8 (left and right) and column 8 (top and bottom).
  for (let i = 0; i < 9; i += 1) {
    mark(8, i)
    mark(i, 8)
  }
  for (let i = 0; i < 8; i += 1) {
    mark(8, size - 1 - i)
    mark(size - 1 - i, 8)
  }

  // Data placement: two-column zigzag from the bottom-right, skipping column 6.
  let bitIndex = 0
  const totalBits = codewords.length * 8
  const nextBit = () => {
    if (bitIndex >= totalBits) return 0
    const byte = codewords[bitIndex >> 3]
    const bit = (byte >>> (7 - (bitIndex & 7))) & 1
    bitIndex += 1
    return bit
  }
  let upward = true
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue
        matrix[row][c] = nextBit()
      }
    }
    upward = !upward
  }

  // Choose the mask with the lowest penalty.
  let best = null
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = matrix.map((row) => row.slice())
    applyMask(candidate, reserved, size, mask)
    placeVersionInfo(candidate, size, version)
    placeFormat(candidate, size, mask)
    const score = penalty(candidate, size)
    if (!best || score < best.score) best = { mask, score, matrix: candidate }
  }

  return { size, modules: best.matrix, version, mask: best.mask }
}

/**
 * Render as a standalone SVG string (what the login panel embeds).
 * @param {string} text
 * @param {{ scale?: number, margin?: number }} options
 */
export function toSvg(text, { scale = 6, margin = 2 } = {}) {
  const { size, modules } = encode(text)
  const full = size + margin * 2
  const parts = []
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!modules[row][col]) continue
      parts.push(`M${col + margin} ${row + margin}h1v1h-1z`)
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${full * scale}" height="${full * scale}" ` +
    `viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges">` +
    `<rect width="${full}" height="${full}" fill="#fff"/>` +
    `<path d="${parts.join('')}" fill="#000"/></svg>`
  )
}
