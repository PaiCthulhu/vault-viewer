import fs from 'fs'
import path from 'path'
import ignore from 'ignore'

// A matcher over vault-relative paths (forward-slashed, with file extension).
export interface VaultIgnore {
  // True when the file at `relPath` should be excluded from the build.
  ignores(relPath: string): boolean
  // True when the directory at `relDir` should be skipped entirely.
  ignoresDir(relDir: string): boolean
}

const NOOP: VaultIgnore = { ignores: () => false, ignoresDir: () => false }

// Loads a `.viewerignore` file (gitignore syntax) from the vault root. Files and
// folders matching its patterns are hidden from the build. Returns a no-op
// matcher when the file is absent or unreadable.
export function loadVaultIgnore(vaultPath: string): VaultIgnore {
  const file = path.join(vaultPath, '.viewerignore')
  if (!fs.existsSync(file)) return NOOP
  try {
    const ig = ignore().add(fs.readFileSync(file, 'utf-8'))
    return {
      ignores: rel => rel !== '' && ig.ignores(rel),
      // Test both `dir` and `dir/` so patterns like `Foo` and `Foo/` both match.
      ignoresDir: rel => rel !== '' && (ig.ignores(rel) || ig.ignores(rel + '/')),
    }
  } catch {
    return NOOP
  }
}
