// Production start wrapper.
//
// `next start` reads the listen port from `process.env.PORT` at the moment it
// parses CLI args — which happens BEFORE Next loads the `.env*` files. So a bare
// `next start` ignores `PORT` set in `.env.local`. This wrapper closes that gap:
// it resolves the port from the env files first, puts it on `process.env`, then
// hands off to the Next CLI in-process (no extra child process to supervise).
//
// Precedence: an explicit `PORT` in the real environment wins, then `.env.local`,
// then `.env`, then 3000.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)

function resolvePort() {
  if (process.env.PORT) return process.env.PORT
  for (const name of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(join(here, '..', name), 'utf8')
      const m = txt.match(/^\s*PORT\s*=\s*"?(\d+)"?\s*$/m)
      if (m) return m[1]
    } catch {
      /* file not present — try the next one */
    }
  }
  return '3000'
}

process.env.PORT = resolvePort()

// Run the Next.js CLI as if invoked as `next start` (commander reads process.argv).
const nextBin = nodeRequire.resolve('next/dist/bin/next')
process.argv = [process.argv[0], nextBin, 'start']
await import(pathToFileURL(nextBin).href)
