/**
 * 把 amCharts 5 打成一个自包含的 ESM 文件，交给 host 的静态路由发给页面。
 *
 * 为什么要打包：amCharts 的 `index.js` 用的是没有扩展名的相对导入
 * （`./.internal/core/Root`），浏览器直接 import 解析不了，必须先在本地
 * 打成一个单文件。
 *
 * 授权：amCharts 5 是 linkware——可以随产品分发、可以商用，条件是
 * **不能去掉它自带的品牌链接**，并把原 LICENSE 一起分发。
 * 所以随包带上 `client/vendor/amcharts5.LICENSE.md`。
 *
 *   node scripts/build-vendor.mjs
 */
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outdir = join(root, 'client', 'vendor')
mkdirSync(outdir, { recursive: true })

// 按 CDN 上的用法导出命名空间：am5 / am5xy / am5percent / am5themes_Animated
const entry = `
  import * as core from '@amcharts/amcharts5'
  import * as xy from '@amcharts/amcharts5/xy'
  import * as percent from '@amcharts/amcharts5/percent'
  import Animated from '@amcharts/amcharts5/themes/Animated'
  export const am5 = core
  export const am5xy = xy
  export const am5percent = percent
  export const am5themes_Animated = Animated
`

const outfile = join(outdir, 'amcharts5.js')
await build({
  stdin: { contents: entry, resolveDir: root, loader: 'js' },
  bundle: true,
  format: 'esm',
  minify: true,
  target: ['chrome110'],
  outfile,
  legalComments: 'none',
})

const license = join(root, 'node_modules', '@amcharts', 'amcharts5', 'LICENSE')
copyFileSync(license, join(outdir, 'amcharts5.LICENSE.md'))

const size = statSync(outfile).size
console.log('写入', outfile, Math.round(size / 1024) + ' KB')
console.log('写入', join(outdir, 'amcharts5.LICENSE.md'))
