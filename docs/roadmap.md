# Roadmap: from Vault Viewer to Vaultwright

This document says where the project is going and why. It is a statement of direction, not a schedule: nothing here has a date, and the order of the items is not a promise.

## Where this is going

Vault Viewer started as a reader: it takes Obsidian vaults from disk and publishes them, faithfully rendered, behind accounts and per-vault permissions. Everything was written in Obsidian and only read here.

The project is turning into **Vaultwright**: a manager for vaults, not only a reader of them. The goal is a home-made, self-hosted Notion: a place where people read, discuss and eventually write notes in the browser, with no third-party service in the loop.

Two principles hold through that change:

- **The vault stays the source of truth.** Whatever the app writes is a plain markdown file with frontmatter inside the vault folder. It stays readable and editable in Obsidian, by a script or by an agent, and it survives the app. There is no second database holding content.
- **Self-hosted, on your own machine.** No feature may depend on somebody else's service to work.

## What is already in

The first steps away from a read-only viewer:

- **Child notes.** A note with a recognized `note_type` and a `parent` pointing at another note belongs to that note. It is left out of the tree, the search and the graph, so a note can have satellites without cluttering the vault's navigation. Membership is by `parent` alone; the folder is only a habit.
- **Tabs.** A child note with `note_type: tab` is a page of its own, reached through a tab bar that its mother and all its sibling tabs share. Each tab has its own URL.
- **Comments.** A note with a Properties block gets a comment strip between its properties and its body, on vaults that turn the `comments` option on. People who can see the vault can comment and reply (one level of replies), edit their own comments and delete them; an admin can delete any comment. Each comment is a markdown file under `_comments/` in the vault, rendered through a restricted pipeline (no raw HTML, no Dataview execution, no images). This is the first time the app writes into a vault.
- **Display names.** A user can have a display name, shown next to the username on comments. For now only an admin can set it.

## What comes next

### Writing notes

- **Editor mode.** Creating and editing notes in the browser. This is the step that turns the reader into a manager, and the largest one: it needs a write path for notes as careful as the one comments have (atomic writes, conflict detection against changes made in Obsidian, nothing written outside the vault).
- **`note_type: section`.** A third kind of child note in the same note format, next to tabs and comments. It is not recognized yet: a note with that type is shown as an ordinary note.

### People

- **Profile page.** Let users edit their own display name instead of asking an admin.
- **Username validation in the admin.** Usernames are not validated on creation today. Leading or trailing spaces and control characters should be refused, since a comment's author is matched by the exact username.
- **Reusing a username.** Authorship is the username written in the comment file. A new account created with the username of a deleted one inherits the old account's comments, with the right to edit and delete them. This needs either a stable author id or a rule against reusing usernames.

### Comments

- **Reactions** on a comment.
- **Notifications** when someone replies to you or comments on a note you follow.
- **Real time.** Today a comment reaches other people after the vault's next build, through the open tab that refreshes itself. A live channel would deliver it at once.
- **Deeper reply threads.** Replies have one level; a reply to a reply is stored under the conversation's first comment.
- **Search in comments.** Comments are left out of the search on purpose today.
- **Comments in Obsidian.** The files are already in the vault, but Obsidian shows them as loose notes in a folder. Something on the Obsidian side should show them on the note they belong to.
- **Orphan cleanup.** A comment whose note was renamed or deleted stays on disk and shows up nowhere. There should be a way to list such comments and to re-attach or remove them.
- **Rate limiting.** Nothing limits how fast a user can post comments, and each write scans the vault and asks for a build.
- **Idempotency key on comment creation.** A request that times out after the file was written can be sent again and create the same comment twice.
- **Strip state while the global graph is open.** Opening the global graph resets the comment strip, so a comment being typed is lost.
- **Ghost comment in a hidden tab.** If a user posts a comment and switches browser tabs before the page refreshes, and meanwhile the build publishes that comment and someone else deletes it, the strip still shows it when the user comes back, until a reload. Editing it fails with "no longer exists". Telling "not built yet" from "built and then deleted" needs information the page output doesn't carry today.

### The rename

- **Vaultwright everywhere.** The repository, the package name, the process name under the process manager and the local dashboard entry still say Vault Viewer. They change together, in one step, once the app does enough to deserve the new name.
