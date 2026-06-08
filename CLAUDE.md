# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

(A tool-agnostic copy of this guide lives in `AGENTS.md` for other AI coding agents.)

## This is NOT the Next.js you know

This repo runs a recent Next.js (App Router, v16) with breaking changes — APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code, and heed deprecation notices.

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
- **`obsidian-compat.ts`** handles Obsidian-permissive markdown. For emphasis with inner spaces (`**x **`, `** x**`) it **normalizes the markdown** (moves the space outside the marker) and lets remark do the pairing, rather than emitting `<strong>` itself — emitting HTML breaks pairing in chains with links. Adjacency rules run after normalization and must not cross `[]()`.
- **`callouts.ts`** renders callout titles via the full `renderInner` (so titles support markdown/links), and tracks fenced-code regions so example callouts inside code blocks stay literal.
- **`properties.ts`** emits the frontmatter "Properties" block; its label is a `data-i18n` span relabeled client-side (see i18n).

### Viewer (`components/viewer/`)
Three panes: `SidebarPanel` (tree/search) · `ContentPanel` (page) · `GraphPanel` (local graph + ToC + backlinks, collapsible, state persisted in-memory across navigation).
- `lib/parse-html-segments.ts` splits `page.html` into `HtmlSegment[]` (extracting the banner as its own segment and splitting at `.dataview-result` placeholders); `ContentPanel` renders them and **memoizes** them so unrelated re-renders (lightbox, hover preview) don't reset native `<details>` state.
- `ContentPanel` also does plain-DOM enhancement: SPA link interception, external links → new tab, image/banner lightbox, mermaid render, the Notion-style gallery filter bar, and relabeling `[data-i18n]` nodes.
- cytoscape graphs (`GraphCanvas`, `GlobalGraph`) cannot use CSS variables — colors are resolved at runtime via `getComputedStyle`.

### Auth, data, config
- Auth: JWT (`jose`) in the `vault_session` cookie, bcrypt passwords, `better-sqlite3` at `users.db` (schema auto-created in `lib/db.ts`). Users have admin/reader roles; non-admins get per-vault permissions (`vault_permissions`); admins see all.
- `vaults.config.json` (gitignored — copy from `vaults.config.example.json`) defines vaults; read via `lib/vault-config.ts` with an **mtime-aware cache** (re-reads when the file changes, so the admin UI and routes stay consistent without a restart). Per-vault `titleProperty` / `coverProperty` / `homePage` drive the builder.
- The admin UI (`/admin`) edits users and vaults and can trigger a rebuild by spawning the builder (`app/api/admin/vaults/[slug]/rebuild`).
- `.viewerignore` (gitignore syntax) at a vault root hides files/folders from the build — applied in `builder/scanner.ts` via `builder/vault-ignore.ts`.

### i18n (`lib/i18n/`)
Flat dictionaries per locale (`en.ts`, `pt-BR.ts`); add a language by copying a file and registering it in `index.ts` `LOCALES`. The active locale is resolved in `app/layout.tsx` from the `vault_locale` cookie or `Accept-Language` (fallback `en`). Client components use `useI18n().t(...)`; server components use `await getT()`. Strings the builder bakes into HTML carry a `data-i18n` attribute and are relabeled client-side, so locale switching needs no rebuild.

## Testing
Vitest, node environment (jsdom is available for DOM-dependent tests). Tests in `tests/` mirror `builder/` and `lib/`. Builder plugins are pure functions tested directly; prefer adding a focused test next to the plugin you change.
