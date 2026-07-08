# Archive Review (Phase 2 Review UI) — Project Reference

Built 2026-07-07 from `../handoff-phase2-review-ui.md` — read that for intent,
this file for what actually shipped and how it works.

## What it is

A local web app (Vite + React) that opens Google Drive folders produced by the
mobile app (`../archive-capture/`) or the batch uploader (`../batch-uploader/`)
and turns them into a review/organize/file interface. Two modes:

- **Marking Mode** — PDF viewer (pdf.js) with pen/highlighter markup + undo,
  editable metadata, per-collection tags with master-pool autocomplete,
  attributed comments/OMG flags, generated citations (footnote + bibliography,
  with explicit `[box?]`-style placeholders when fields are missing).
- **Filing Mode** — drag-to-merge card table: files merge into multi-page
  documents, documents into Folders, Folders into Boxes (iOS-folder-style
  animation + WebAudio chime; invalid merges shake + low buzz). Everything is
  local + undoable until an explicit Save writes real structure to Drive.

Two data backends behind one interface (`src/lib/backend.js`):
- **DriveBackend** — real Drive REST calls (port of batch-uploader's drive.js).
- **DemoBackend** — the "sample archive": an in-memory corpus with both tree
  shapes and real generated PDFs (`src/lib/demoData.js` + `demoPdf.js`), so
  every feature is exercisable with zero Google setup. All app code above the
  backend is identical in both modes.

## Run it

```
wsl.exe -e bash -lc "cd ~/projects/Organizer_Archives/review-ui && npm run dev"
```
then http://localhost:5173. Port 5173 is pinned (`strictPort`) because it's the
OAuth client's only authorized local origin. There is also a `review-ui` entry
in `../.claude/launch.json`.

## One-time setup still needed for real Drive mode

Sample mode works immediately. Real mode needs (instructions also at the top
of `src/config.js`):
1. **Picker API key** — Cloud project `526107030062`: enable "Google Picker
   API", create an API key, paste into `PICKER_API_KEY` in `src/config.js`.
   The "Sign in with Google" button stays disabled (with a note) until then.
2. OAuth reuses the batch uploader's web client ID (localhost:5173 already
   authorized) — any user must be an OAuth **test user** on the consent screen
   (Hannah + Justina already are).
3. Scopes: `drive.file` + `userinfo.profile/email` (profile is new vs. the
   uploader — used to attribute comments/tags; users will see a re-consent).
   `drive.file` visibility is per-Cloud-project, so files created by the
   mobile app / uploader (same project) are readable here; the Picker grants
   access to anything else the user explicitly picks.

## Schema additions (beyond ../archive-capture/docs/metadata-schema.md)

This tool reads/writes the mobile app's `properties` schema unchanged, plus
(see `src/lib/metadata.js`):
- `comment_log` — JSON `[{page,text,user,ts}]`; `typed_comments` is kept in
  sync (same entries minus attribution) so mobile-app conventions still hold.
- `tag_log` — JSON `[{tag,user,ts}]`; `omg_log` — JSON `[{page,user,ts}]`.
- `title` — free-text File Title (used in citations, display names).
- `notes_page_index` — where the human-readable Notes page sits in the PDF.
  The Notes page (attributed comments/tags/OMG rendered as text) is rebuilt on
  every save, inserted after content pages, before backup pages.

Known constraint inherited from the schema: Drive property values cap at ~124
bytes — long comment logs can exceed this. The mobile app has the same
unguarded issue; punted here on purpose (first pass, matches existing risk).

## Conventions honored (do not re-derive)

- Filename: `Archive <n> - Collection <n> - Box <n> - Folder <n> - NNNNNN[ - OMG].pdf`,
  missing fields skipped, six-digit counter per Box+Folder scope starting after
  what's already in the destination folder (`src/lib/naming.js`).
- Markup bake = mobile-app convention: marked page gets a yellow warning
  banner, clean original appended at the PDF's back, `unmarked_backup_pages`
  updated (`src/lib/markupBake.js`). Strokes are recorded in PDF-point
  coordinates directly (viewer wrapper matches page aspect exactly, so there
  is no letterbox offset to correct — the web analogue of MarkupScreen's
  computeContentRect fix).
- Filing save (`src/lib/mergeSave.js`): merged docs = content pages of each
  source in order (backups re-appended + re-indexed, notes page rebuilt), tags
  union, page-indexed fields offset per source, earliest `captured_at`,
  sources trashed. Single files are filed in place (props + rename + move, no
  re-upload). Loose unmerged files are left untouched by Save.
- Highlight gradient: score = 3·OMG + 2·comments + 2·markup + tags, percentile
  ranked within collection (unfiled trees rank against their own root), tiers
  at >90 / >75 / ≥50th percentile, folders glow as their brightest descendant.

## Verified working (sample mode, 2026-07-07)

Full click-through: tree with both corpus shapes + tiered highlights + badges;
open/mark/undo/save with bake + notes rebuild; tag autocomplete from the
master pool; attributed comments; citations incl. incomplete placeholders;
filing drags file→doc→folder→box, multi-select merge (captured_at order),
undo/reset, invalid-merge rejection, Save produced
`Archive Capture — Good Poems/Folder 1/…000001-000003.pdf` with correct merged
PDFs and metadata; explorer drag-move; switch-folders.

**Real Drive:** first sign-in attempt (2026-07-07 evening) hit a "Picker
developer key invalid" error that a retry got past — see TASKS.md's "Known
bug" section, not yet diagnosed. Once past that, Carter reached his real
files, but the Filing Mode save flow doesn't match how he actually wants to
file things — see TASKS.md's "In progress" section; a redesign is scoped
there, not yet built (branch `filing-mode-redesign`).

## Where things are

- `src/App.jsx` — stage/mode state, corpus in a mutable Map + version counter
- `src/lib/corpus.js` — tree loading (BFS), highlight tier computation
- `src/components/PdfViewer.jsx` — render + zoom/pan/pinch/swipe + stroke capture
- `src/components/MarkingMode.jsx` — save pipeline (bake → notes → props)
- `src/components/FilingMode.jsx` — card workspace, pointer-drag merge, save modal
- `src/lib/mergeSave.js` — arrangement → real Drive structure
- `src/lib/tagStore.js` — per-collection pools + master pool (localStorage +
  derived from loaded files; the mobile app's AsyncStorage pools are
  unreachable from the web, so pools rebuild from what's actually on files)

## Linting

`npm run lint` (ESLint + Prettier check) / `npm run lint:fix` (auto-fix +
format). `eslint.config.js` turns off `react-hooks/refs` deliberately —
`App.jsx`/`FilingMode.jsx` keep the corpus tree in a ref (mutated in place,
`version` state bumped to trigger re-renders) rather than `useState`, since
cloning a multi-thousand-file Map on every edit would be real cost for no
benefit. That rule assumes all ref reads during render are accidental
(it's aimed at React Compiler codebases); here they're the point. A couple
of `useMemo`s intentionally depend on `version` without reading it in the
body, for the same reason — silenced inline with
`eslint-disable-next-line react-hooks/exhaustive-deps` and a comment at each
spot, not a blanket rule disable. Prettier is scoped to code only
(`.prettierignore` excludes `*.md` — reformatting prose docs isn't the goal).

Known, deliberately unaddressed: `npm audit` flags a moderate esbuild/Vite
dev-server advisory that only clears via a Vite 5→8 major-version jump — not
worth pulling into scope for a lint pass.

## Git

Own repo, currently on branch `filing-mode-redesign` (created 2026-07-07 for
the Filing Mode destination-folder rework — see TASKS.md). No remote yet.
Same local identity as the sibling projects.

**Multi-instance lesson learned:** running more than one Claude Code session
against this folder tree at once caused real chaos on 2026-07-07 — duplicate
`vite` dev servers fighting over port 5173 (pinned for both this tool and the
batch uploader, for OAuth-origin reasons), including one from a completely
separate checkout at `~/projects/PDF-dream`. Only run one session's dev
server in this folder tree at a time.
