#!/usr/bin/env node
/**
 * Pull @printroom/onboarding from the staff portal.
 *
 * Defaults to dry-run. Pass --apply to actually copy.
 * Source: $STAFF_PORTAL_DIR or ../print-room-staff-portal
 */
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

const APPLY = process.argv.includes('--apply')
const SOURCE_REL = process.env.STAFF_PORTAL_DIR ?? '../print-room-staff-portal'
const SOURCE = resolve(SOURCE_REL, 'vendor/print-room-onboarding')
const DEST = resolve('vendor/print-room-onboarding')
const EXCLUDE = new Set(['node_modules', 'tsconfig.tsbuildinfo'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

if (!existsSync(SOURCE)) {
  console.error(`Source not found: ${SOURCE}`)
  console.error(`Set STAFF_PORTAL_DIR or clone the staff portal as a sibling.`)
  process.exit(1)
}

const files = walk(SOURCE)
const changes = []
for (const src of files) {
  const rel = src.slice(SOURCE.length + 1)
  const dst = join(DEST, rel)
  let dirty = !existsSync(dst)
  if (!dirty) {
    const srcStat = statSync(src)
    const dstStat = statSync(dst)
    if (srcStat.size !== dstStat.size || srcStat.mtimeMs > dstStat.mtimeMs) dirty = true
  }
  if (dirty) changes.push({ src, dst, rel })
}

console.log(`Source: ${SOURCE}`)
console.log(`Dest:   ${DEST}`)
console.log(`Files scanned: ${files.length}`)
console.log(`Files to copy: ${changes.length}`)

if (changes.length === 0) {
  console.log('Up to date. Nothing to do.')
  process.exit(0)
}

for (const c of changes) console.log(`  ${APPLY ? 'COPY' : 'DRY '}  ${c.rel}`)

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.')
  process.exit(0)
}

for (const c of changes) {
  mkdirSync(dirname(c.dst), { recursive: true })
  copyFileSync(c.src, c.dst)
}
console.log(`\nCopied ${changes.length} files.`)
console.log('Now run: npm install && npm run build')
