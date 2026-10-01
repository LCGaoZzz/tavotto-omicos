/**
 * Make the emitted declarations resolvable OUTSIDE this repository.
 *
 * `tsc` keeps import specifiers verbatim, so every `@/x` in the sources
 * survives into `dist-lib/**.d.ts` — and a consumer has no `@` alias, so
 * TypeScript would report the package as untyped (or worse, silently `any`).
 * The JS bundle has no such problem: Vite resolved the aliases at build time.
 *
 * This rewrites `@/x` to the correct relative path and drops the CSS imports,
 * which mean nothing in a declaration file. It is idempotent: a second run
 * finds no `@/` left.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, relative, dirname, sep } from 'node:path'

const ROOT = new URL('../dist-lib/', import.meta.url).pathname

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.d.ts')) out.push(p)
  }
  return out
}

let rewritten = 0
let cssDropped = 0
for (const file of walk(ROOT)) {
  const before = readFileSync(file, 'utf8')
  let after = before.replace(/(['"])@\/([^'"]+)\1/g, (_m, q, rest) => {
    let rel = relative(dirname(file), join(ROOT, rest)).split(sep).join('/')
    if (!rel.startsWith('.')) rel = './' + rel
    return `${q}${rel}${q}`
  })
  // `import './index.css'` in a .d.ts: tsc cannot type it and the host already
  // imports the stylesheet through the package's `./style.css` export.
  after = after.replace(/^\s*import\s+['"][^'"]+\.css['"];?\s*$/gm, '')
  if (after !== before) {
    writeFileSync(file, after)
    rewritten += 1
    if (/\.css['"]/.test(before)) cssDropped += 1
  }
}

const left = walk(ROOT).filter(f => /['"]@\//.test(readFileSync(f, 'utf8')))
if (left.length) {
  console.error(`fix-lib-dts: ${left.length} file(s) still carry an '@/' specifier`)
  process.exit(1)
}
console.log(`fix-lib-dts: rewrote ${rewritten} declaration file(s), dropped ${cssDropped} css import(s)`)
