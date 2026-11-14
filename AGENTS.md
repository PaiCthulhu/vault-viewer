<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md

Guidance for AI coding agents (Codex, Cursor, Copilot, Antigravity, Claude Code, etc.) working in this repository. Claude Code reads `CLAUDE.md`, which mirrors this file. (The note above about the recent, breaking-change Next.js applies — read `node_modules/next/dist/docs/` before writing framework code.)

## Commands

```bash
npm run dev            # Next.js dev server (http://localhost:3000)
npm run build          # production build of the web app
npm run start          # serve the production build
npm run lint           # eslint

npm test               # vitest (watch)
npm run test:run       # vitest once (CI-style)
npx vitest run tests/builder/plugins/callouts.test.ts   # a single test file
npx vitest run -t "callout"                              # tests matching a name

# Vault rendering (ahead-of-time builder — NOT part of `next build`)
npx tsx builder/index.ts --vault <slug>   # build one vault
npx tsx builder/index.ts --all            # build every vault in vaults.config.json

npx tsx scripts/seed-admin.ts <user> <pass>   # create the first admin (creates users.db)
```

After ANY change under `builder/`, rebuild **every** vault (`--all`) — build output is per-vault and goes stale silently otherwise.

## Architecture

This is **two programs** sharing one repo:

1. **The builder** (`builder/`) — an ahead-of-time renderer run from the CLI (`npx tsx builder/index.ts`). It reads an Obsidian vault folder from disk and writes prebuilt output to `data/<slug>/`, copying images to `public/vault-assets/<slug>/`.
2. **The Next.js viewer** (`app/`, `components/`, `lib/`) — at request time it only **reads** that prebuilt `data/<slug>/` output; it does no markdown rendering. So content changes are invisible until the vault is rebuilt.

### Build output contract (`data/<slug>/`)
- `pages/<path>.json` — a `PageMeta` (final HTML + frontmatter + outlinks + per-page CSS).
- `pages-index.json` — `PageSummary[]` (path, title, **file** [basename], tags) for sidebar/search.
- `tree.json` — the sidebar tree, prebuilt with folder-notes already absorbed (built at build time so the client doesn't recompute 700+ nodes per navigation).
- `graph.json` — `BuildGraph` (nodes + edges; self-loops removed).
- `index.json` — page/folder counts + `builtAt`.

Types live in `builder/types.ts` and `types/index.ts`.

### Builder pipeline (`builder/pipeline.ts`)
Per page: dataviewjs/DQL are extracted, then a **recursive `renderBody`** runs in this order: dataview → `renderColumns` → `renderCallouts` → `applyObsidianCompat` → `renderCaptions` → wikilinks → `renderMarkdown` (remark/rehype). It's recursive (callouts/columns call `renderBody` on their stripped inner content) which is why dataview/columns/callouts nest correctly. **Order is load-bearing** — e.g. columns before callouts (fences are stronger boundaries than blockquotes); dataview inside `renderBody` so blocks nested in callouts/columns are reached after their `> `/fence prefixes are removed. Plugins are in `builder/plugins/`.

Notable plugin behaviors:
- **`dataview.ts`** runs vault DataviewJS in a Node `vm` with a mini-DOM shim (an `El` class, `dv.container`, `document`, `app`). Everything appends to ONE ordered `container` — do not reintroduce a separate output buffer (it scrambles section/gallery order). DQL and `dv.table/list` emit `.dataview-result` placeholder divs that the client hydrates into interactive tables.
  - `executeDataviewJS` is async. As in Dataview, a block containing `await` runs inside an async function, and `renderBody` replaces blocks one at a time (`replaceAsync` in `pipeline.ts`) so captured CSS keeps block order. Output is serialized once, so un-awaited `dv.view`/`dv.io.load` calls are awaited before serializing; the whole thing has a deadline (`timeoutMs`, default 30 s) because a promise that never settles would drain the event loop and make the builder exit 0 without writing anything.
  - `dv.view(name, input)` loads `<name>.js`, then `<name>/view.js`, compiles it **in the block's vm context** (same globals) and passes `(dv, input)`; `<name>/view.css` goes to the page CSS (once per page, even if the view throws). `dv.view` never rejects: every failure becomes an inline `.dataview-error`, so an un-awaited call can't become an unhandled rejection. `dv.io.load(path)` reads a vault-relative file and returns `undefined` when it is missing or resolves outside the vault (as in Obsidian, such a file doesn't exist). Both need `vaultRoot` in `executeDataviewJS`'s options.
  - DOM fidelity that shared renderers rely on: DOM properties that mirror attributes (`href`, `src`, `title`, `value`, …) and boolean ones (`open`, `disabled`, …) are accessors over `attrs`; `classList`; `document.createElementNS` (SVG serialized as-is). `dv.container` is serialized as an element **only** when the script touched it (class/id/attribute), so `.root .x` CSS works and untouched blocks keep their old output. `p.file.frontmatter` is the raw frontmatter; `Date` and `URL` come from the builder's realm so `instanceof Date` matches gray-matter dates.
  - There is no `window` in the context, on purpose: a script shared with Obsidian checks `typeof window` to leave out controls that only work with live events (e.g. a shared gallery renderer drops its reorder buttons and filter pills that way). A gallery participates in the viewer's filter bar by marking `.dv-gallery` / `.dv-card` with an `internal-link` (`data-href` = page path) inside the card.
- **`obsidian-compat.ts`** handles Obsidian-permissive markdown. For emphasis with inner spaces (`**x **`, `** x**`) it **normalizes the markdown** (moves the space outside the marker) and lets remark do the pairing, rather than emitting `<strong>` itself — emitting HTML breaks pairing in chains with links. Adjacency rules run after normalization and must not cross `[]()`.
- **`callouts.ts`** renders callout titles via the full `renderInner` (so titles support markdown/links), and tracks fenced-code regions so example callouts inside code blocks stay literal.
- **`properties.ts`** emits the frontmatter "Properties" block; its label is a `data-i18n` span relabeled client-side (see i18n).

### Viewer (`components/viewer/`)
Three panes: `SidebarPanel` (tree/search) · `ContentPanel` (page) · `GraphPanel` (local graph + ToC + backlinks, collapsible, state persisted in-memory across navigation).
- `lib/parse-html-segments.ts` splits `page.html` into `HtmlSegment[]` (extracting the banner as its own segment and splitting at `.dataview-result` placeholders); `ContentPanel` renders them and **memoizes** them so unrelated re-renders (lightbox, hover preview) don't reset native `<details>` state.
- `ContentPanel` also does plain-DOM enhancement: SPA link interception, external links → new tab, image/banner lightbox, mermaid render, the Notion-style gallery filter bar (a gallery left empty hides with its group title, or with the `<details>` group whose body is only that gallery — `lib/gallery-group.ts` — and the bar is inserted above that group, never inside it), and relabeling `[data-i18n]` nodes.
- A note's `cssclasses` (list or space/comma string, `lib/css-classes.ts`) become classes on every `.vault-article`, as in Obsidian. Its width is `max-width: var(--file-line-width, 72ch)`, so a cssclass that sets `--file-line-width: 100%` in page CSS widens the page; `wide-page` still does too.
- Vault CSS written for Obsidian (a DataviewJS `view.css`, a gallery script's `<style>`) works because `app/globals.css` aliases Obsidian's variable names (`--background-secondary`, `--background-modifier-border`, `--text-normal`, `--interactive-accent`, `--font-ui-small`, …) to the viewer theme, and `ContentPanel` mirrors the next-themes theme onto `body.theme-dark` / `body.theme-light`.
- cytoscape graphs (`GraphCanvas`, `GlobalGraph`) cannot use CSS variables — colors are resolved at runtime via `getComputedStyle`.

### Auth, data, config
- Auth: JWT (`jose`) in the `vault_session` cookie, bcrypt passwords, `better-sqlite3` at `users.db` (schema auto-created in `lib/db.ts`). Users have admin/reader roles; non-admins get per-vault permissions (`vault_permissions`); admins see all.
- Vault images live in `public/`, which Next serves straight from disk, so `proxy.ts` is the only gate: `/vault-assets/<slug>/…` needs a session and, for readers, permission on that vault (`lib/asset-guard.ts`, checked on the decoded path with a case-insensitive `/vault-assets/` prefix — the host filesystem is case-insensitive — and the slug as written, since grants hold the configured slug). **The proxy matcher must not exclude images or `vault-assets`**: until 2026-11-13 it did, and every vault's images were public. `images.unoptimized` keeps `/_next/image` (unused) from serving them by another route.
- `better-sqlite3` ≥ 13 is N-API, so its binary survives Node upgrades; 12.x was tied to one Node ABI and broke login (HTTP 500) when the host's Node changed. Its install script is denied in `allowScripts` on purpose: the package ships prebuilt binaries, and the script would only recompile from source.
- Builds run through `lib/rebuild.ts` (`runRebuild`): the builder is spawned as `process.execPath --import tsx builder/index.ts`, without a shell (`spawn(cmd, args, { shell: true })` is deprecated, DEP0190), one build at a time per vault; requests arriving during a build coalesce into ONE extra build (`wait: true`, used by the admin route, resolves with that extra build's result).
- `POST /api/internal/rebuild/<slug>` (header `X-Rebuild-Key` = `INTERNAL_REBUILD_KEY`) lets the external sync service trigger a rebuild. `proxy.ts` lets `/api/internal/` through without a session, so the route authenticates itself, in this order: `cf-connecting-ip`/`forwarded`/`x-real-ip` present, or `x-forwarded-for` with a non-loopback IP (Next injects it with the socket address on every request, so its mere presence proves nothing) → 403; `Host` not loopback (`127.0.0.1`, `localhost`, `[::1]`, any port) → 403; env var unset → 404; wrong/missing key → 401 (SHA-256 digests + `timingSafeEqual`); invalid slug → 400; vault not in `vaults.config.json` → 404; else 202 without waiting for the build. Security depends on: the viewer listening on loopback only; the reverse proxy forwarding the original `Host` (a `header_up Host` rewrite defeats the check); and the caller using `127.0.0.1`/`localhost`.
- `vaults.config.json` (gitignored — copy from `vaults.config.example.json`) defines vaults; read via `lib/vault-config.ts` with an **mtime-aware cache** (re-reads when the file changes, so the admin UI and routes stay consistent without a restart). Per-vault `titleProperty` / `coverProperty` / `homePage` drive the builder.
- The admin UI (`/admin`) edits users and vaults and can trigger a rebuild by spawning the builder (`app/api/admin/vaults/[slug]/rebuild`).
- `.viewerignore` (gitignore syntax) at a vault root hides files/folders from the build — applied in `builder/scanner.ts` via `builder/vault-ignore.ts`.

### i18n (`lib/i18n/`)
Flat dictionaries per locale (`en.ts`, `pt-BR.ts`); add a language by copying a file and registering it in `index.ts` `LOCALES`. The active locale is resolved in `app/layout.tsx` from the `vault_locale` cookie or `Accept-Language` (fallback `en`). Client components use `useI18n().t(...)`; server components use `await getT()`. Strings the builder bakes into HTML carry a `data-i18n` attribute and are relabeled client-side, so locale switching needs no rebuild.

## Testing
Vitest, node environment (jsdom is available for DOM-dependent tests). Tests in `tests/` mirror `builder/` and `lib/`. Builder plugins are pure functions tested directly; prefer adding a focused test next to the plugin you change.
