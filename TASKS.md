# Tasks — Archive Review (Phase 2 Review UI)

## Session 2026-07-10 — git housekeeping (merge, test, deploy)
- [x] Merged `fable/structural-fixes` into `main` (fast-forward), then
      `filing-system-round1` into `main` (fast-forward) — no conflicts.
- [x] On `main`: 112 tests green, lint clean, build OK.
- [x] Deleted stale local branch `filing-system-round2`.
- [x] Pushed `main` to origin; deployed via `npm run deploy` —
      https://clshot-gif.github.io/Librarian/ confirmed live (verified
      served HTML points at the freshly built asset hashes).
- [x] In archive-capture: merged its `fable/structural-fixes` into `master`
      (regular merge, CLAUDE.md auto-merged, no conflicts); 9 tests green
      incl. the cross-repo driveProps byte-identical check; pushed to origin.
      `eas update` NOT run (Carter ships that himself).

## Session 2026-07-10 (Fable) — filing system round 1 on branch `filing-system-round1`
Built from `../handoff-filing-system-round1.md` (off `fable/structural-fixes`).
This SUPERSEDES the 2026-07-08 "Drive root convention" checkpoint: with a
destination archive chosen, filing goes to `Archive Scans/<archive>/<collection>/
Box n/Folder m` (bare collection names); the legacy `Archive Capture — <Collection>`
behavior remains only when no destination is selected. 112 tests green, lint
clean, build OK; full sample-mode walkthrough done (accept-all → save migrated
14 files into the archive → reconverged to 0-to-write; Explorer drag renamed/
retagged/moved a file and Undo move restored it exactly; Box card dragged onto
Raw tore down to 14 pages; Ctrl+Z restored).
- [x] Canonical Archive Scans root: picked once via Picker (drive.file grant),
      persisted in localStorage, changeable (⚙); archives listed in-app via
      one listChildren — the Picker never chooses destinations.
- [x] Per-archive `Contents/manifest.json` fetched on archive selection
      (replaces the bundled seed for real use; the seed now feeds demo data).
      Manifest-less archives file with blank columns. Read-only.
- [x] Source picks inside Archive Scans warn (confirm dialog), never block.
- [x] Destination mode: placement follows physical location; tagged files
      elsewhere become 💡 suggestions; "Accept all suggested" places clean
      matches, buckets partial ones, leaves unknowns loose. Save migrates
      accepted files into the archive (props+rename+move, no re-upload).
- [x] Explorer drag routes through refileFile when the target is inside a
      recognizable structure (archive root ancestry, or legacy root by name);
      physical-only move elsewhere. Filing board rebuilds on corpus changes.
      "↩ Undo move" (Explorer header) restores name/props/location exactly,
      repeatable to the last reload. TASKS' "NEXT UP: Explorer drag also
      syncs metadata" is DONE.
- [x] Drag-down explode: drop a File/Folder/Box card on any lower column to
      decompose to that level in one motion (PDF onto Raw = single pages).
- [x] Datalist name suggestions (manifest + corpus established names) on all
      Box/Folder/Collection/Archive inputs (MetadataPanel + board cards).
- [x] Merged into `main` (2026-07-10 git housekeeping, see above).
- [ ] Pick up next: real-Drive smoke test — create Archive Scans + an
      archive + Contents/manifest.json by hand, pick it once, file a
      practice batch in. Watch: first save into a brand-new archive, and
      the Picker key config on the live site.
- Known gaps left on purpose: folder drags in Explorer stay physical-only
  (descendant metadata not rewritten); `?`-bucket placements are working
  state, not saved — they reappear as suggestions after reload; a corpus
  folder can't enter the board as one unexploded unit (files are flattened
  by design — noted as the judgment call, deferred); non-PDF thumbnail bug
  unchanged (Contents/ is excluded from loading, so manifest.json never
  becomes a card unless the archive folder itself is picked as a source).

## Session 2026-07-09 (Fable) — structural fixes landed on branch `fable/structural-fixes`
Branch off `origin/main`, awaiting Carter's review/merge (not deployed).
Handoff items 1, 2 (bounds check only), 3, 4, 5, 7 done; 6 done in
archive-capture (its branch `fable/structural-fixes` off
`feature/live-camera-scanner`). Items 8 and 9 deliberately not done — see the
session report. 84 tests green, lint clean, build OK.
- [x] Shared `src/lib/driveProps.js` contract file, byte-identical in both
      repos (cross-repo equality test in each suite): lossless chunking,
      stale-continuation cleanup on updates, ~30-property ceiling guard
      (throws; sidecar design still an open product question),
      MAX_FILENAME_LENGTH single-sourced.
- [x] parseProps never silently swallows corrupted JSON: salvages complete
      entries, logs with filename, records `parsed.parseWarnings`.
- [x] Filing Save is failure-safe: stops at first failed write, only trashes
      sources with confirmed replacements, reports what did/didn't complete,
      always reloads the board. Fault-injection tests.
- [x] Picker hang fixed: 30s load timeout (cancelled on LOADED), constructor
      catch, dismissible error banner in the work screens.
- [x] Resumable Drive uploads >4MB (both repos) — NOT verified against live
      Drive (no OAuth this session); mocked-fetch tests pin the protocol.
      Watch the first save of a big merged PDF.
- [ ] Pick up next: Carter reviews/merges both branches, ships archive-capture
      via eas update, then a real-Drive smoke test (Filing save, a >5MB
      upload, and a file with chunked properties round-tripping between apps).

## STRUCTURAL BUG-FIX PHASE (2026-07-08, handed to Fable)
**Read `../handoff-fable-structural-fixes.md` first.** Nine cross-repo structural
issues (archive-capture + review-ui), ranked by how much silent damage each can do —
led by a live data-loss path where the two repos handle Drive's 124-byte property
limit differently (one lossy, one lossless) and a bad value can silently vanish on
read. Do not merge `archive-capture`'s `fix/pixel7a-blank-pages` branch as part of this
— it's a separate, unrelated fix awaiting Hannah's on-device confirmation.

## Done (2026-07-07 — first pass built and verified in sample mode)
- [x] Scaffold Vite+React app, git repo, launch.json entry
- [x] Folder selection: Google Picker (multi-folder) + sample-archive mode
- [x] File explorer: both corpus shapes, marking-density highlight tiers,
      badges, drag-to-move (writes through backend)
- [x] Marking Mode: pdf.js viewer (buttons/on-canvas arrows/swipe, zoom/pinch),
      pen+highlighter markup with undo, bake with banner + clean-original
      backup convention, metadata fields, per-collection tags with autocomplete,
      attributed comments/OMG, notes-page rebuild, citations with placeholders
- [x] Filing Mode: drag-to-merge (file→doc→folder→box) with ghost/pop/chime,
      multi-select merge by captured_at, undo/reset, invalid-merge feedback,
      Save → real structure with convention filenames + merged PDFs
- [x] End-to-end verification in sample mode (see CLAUDE.md "Verified working")
- [x] Picker API key filled in and committed
- [x] ESLint + Prettier set up (`npm run lint` / `lint:fix`) — see CLAUDE.md
      "Linting" section

## In progress — Filing Mode redesign (branch: `filing-mode-redesign`)
Carter's real-Drive first run (2026-07-07) surfaced that the current Filing
Mode save step doesn't match how he actually wants to file things. Captured
here verbatim-ish so the redesign starts from the right brief, not a rebuild
of what's already there:

1. **Stop forcing everything into a new `Archive Capture — <Collection>`
   folder.** Today `saveFiling()` (`src/lib/mergeSave.js`) always creates or
   reuses exactly that name as the root. Carter wants the save step to let
   him **choose an existing Drive folder** to file into, or **create a new
   one** only when nothing appropriate exists yet — not auto-generate a
   collection folder every time.
2. **New folders should nest under a "Categorized" parent**, with subfolders
   under that — not live as siblings to the `Unprocessed <date>` trees the
   way `Archive Capture — X` currently does. This is a real structural
   change from the "two shapes of corpus" convention in
   `archive-capture-context-for-phase2.md` (Shape 1 is
   `Archive Capture — [Collection] / Box / Folder`) — worth an explicit
   conversation about whether Categorized *replaces* that convention for
   Drive-side filing done through this tool, or sits alongside it, since it
   affects `naming.js`'s filename convention too (Box/Folder-based) and any
   future compatibility with what the mobile app itself produces.
3. **Use the title typed on the merge card.** Filing Mode already collects a
   free-text title per merged document (`item.title` in `FilingMode.jsx`,
   the "Title (optional)…" input shown right after a merge) — Carter
   referred to this as "the title that I gave it manually on the screen
   where I combined files." Right now it only lands in the file's `title`
   metadata property; it doesn't influence folder naming or destination
   choice at all. Likely wants it usable as the folder-name candidate when
   creating a new category.
4. **Add an actual "pick a destination folder" step** — currently the save
   modal only has free-text Collection/Archive Name fields with a datalist
   of already-loaded collection names (`FilingMode.jsx`'s save modal). A
   real folder browser/picker for the destination (reusing the same Google
   Picker approach as the initial folder-selection step, or a tree browser
   of what's already loaded) is probably part of the fix for #1.

None of this has been implemented — by design, so the conversation about
scope happens before code does. Branch is created and ready.

## Known bug — Picker API key shows "invalid" on first Drive attempt
Carter's first real sign-in attempt showed a "developer key is invalid"
error from the Picker, but hitting back and retrying let him through to his
real files. The key itself is committed and confirmed restricted in Cloud
Console (see git history on `src/config.js`), so it's not a wrong key.
Likely causes worth checking first, not yet diagnosed:
- The **"Google Picker API" library itself may not be enabled** on the
  Cloud project (separate step from creating the key — see the setup note
  in `src/config.js`). An unrestricted-but-key-valid vs.
  library-not-enabled error can look similar from the Picker's error text.
- The website-restriction pattern may not exactly match the request's
  origin/referrer (e.g. trailing slash or protocol mismatch on
  `http://localhost:5173/*`).
- Possible a timing issue — `picker.js` calls `.setDeveloperKey()` before
  `gapi.load('picker', ...)` has fully settled in some race, and a retry
  just wins the race the second time.
Not fixed — flagged for whenever Drive-mode work resumes.

## Next up
- [ ] Scope and implement the Filing Mode redesign above (new branch is
      ready; needs a real design conversation first, not a quick patch)
- [ ] Diagnose the Picker "invalid key" bug for real (see above)
- [ ] Decide hosting (GitHub Pages like PDF-dream?) — needs the new origin
      added to the OAuth client + Picker key restrictions
- [ ] Let Hannah/Justina react before building more polish elsewhere

## Blockers / watch-outs discovered
- Drive `properties` 124-byte-per-value cap: comment_log can exceed it on
  chatty documents; mobile app shares the risk. Revisit if real data hits it.
- Filing Mode loads *all* descendant files of the scoped folder as cards;
  a 2,000-file collection will need pagination/virtualization eventually.
- **Two dev instances working in this folder at once caused real chaos**
  (2026-07-07 evening): duplicate `vite` processes fighting over port 5173
  (which both this tool and the batch uploader need specifically, for OAuth
  origin reasons), one from a totally separate checkout at `~/projects/
  PDF-dream`. Worth being deliberate about only running one session's dev
  server at a time in this folder tree going forward.

## Session 2026-07-08 (second) — Filing Mode redesign VERIFIED ✅
- [x] Diagnosed the "pdf.js render hangs in preview" mystery: not a pdf.js
      bug — 'display' intent schedules on requestAnimationFrame, which never
      fires in a hidden tab. Thumbnails now render with 'print' intent
      (immediate); also makes thumbnails robust in real background tabs.
- [x] Removed the temporary [thumb] debug lines.
- [x] Full definition-of-done walk in sample mode — every checklist item
      from the CONTINUE handoff passed, including save (bare-value
      filenames, OMG suffix, skipped levels omitted, corpus reconverges).
- [x] Found + fixed a real model bug the walk surfaced: exploding the folder
      FIRST and then its loose file broke the origin chain — rebuilt files
      lost their debt to the source folder, so the win fired on the first
      drop instead of the last. `inheritedOrigin` now falls back to the
      loose shell's own origin. Regression test added (34 green).
- [x] Deliberate skips are now visible: skipped pages/files render as cards
      in their own column with struck-through chips (they were silently
      invisible after the drop before). Plus: ⟲ origin badges on spilled
      file/folder cards, "2 boxes" pluralization, filingModel.js NUL byte
      → ' ' escape (file read as binary by git/grep before).

### Checkpoints resolved by Carter (2026-07-08)
1. **Drive root convention** — Carter: not worth more deliberation. Keeping
   `Archive Capture — <Collection>` roots (reuse existing, create only when
   none exists). The "Categorized" idea (items 1–2 above) is closed unless
   he raises it again; items 3–4 above landed in the redesign.
2. **Deliberate-skip round-trip** — Carter OK'd a metadata field. Implemented
   as `skipped_levels` (see CLAUDE.md Schema additions): save stamps it,
   reload honors it, never rendered in the UI. Round-trip verified live +
   pinned by tests (36 green).

Repo pushed to GitHub: https://github.com/clshot-gif/Librarian

- [x] **Picker API key rotated** by Carter (2026-07-08). Code reads it from
      `.env.local` (gitignored) via `VITE_PICKER_API_KEY`; the exposed old key
      is deleted. The old key remains in git history but is dead — history
      scrub deemed unnecessary.

### Deployment — GitHub Pages (live 2026-07-08)
The app is deployed to GitHub Pages at **https://clshot-gif.github.io/Librarian/**.
- `vite.config.js` sets `base: '/Librarian/'` for the production build only
  (dev stays at `/`). `npm run deploy` runs `scripts/deploy.sh`, which builds
  and force-pushes ONLY `dist/` (plus a `.nojekyll`) to the `gh-pages` branch
  as a single orphan commit. (Do NOT reintroduce the `gh-pages` npm tool — it
  leaked source dotfiles onto the branch; see the deploy commit message.)
- The build bakes the origin-restricted Picker key into the public JS bundle.
  That's expected for a browser Picker app; the key is protected by its origin
  restrictions, not by secrecy.

- [x] GitHub Pages enabled by Carter (gh-pages branch) — site is live at
      https://clshot-gif.github.io/Librarian/ and Sample mode works there.
      (Gotcha he hit: the gh-pages branch is in the *Librarian* repo, not
      archive-capture — its Pages settings are a separate repo.)

## BUG-FIX PHASE — start here next session
**Read `../handoff-bugfixes-CONTINUE.md` first.** The redesign is done; the
next work is bug fixes.

### BLOCKING: Google Picker "The API developer key is invalid"
Carter hits this on the live site (and previously on localhost) when the folder
Picker opens after sign-in. Two problems, both need fixing:
1. **Config** — likely the Google Picker API isn't enabled on project
   526107030062, and/or the Picker *key's* Website restriction doesn't include
   `https://clshot-gif.github.io/*` (distinct from the OAuth JS-origin setting).
   Diagnosis order + isolation test are in the handoff. Cloud Console = Carter's
   actions.
2. **App trap (real code bug)** — when the Picker fails it fires no PICKED/CANCEL
   and never throws, so `pickFolders` (`src/lib/picker.js`) hangs and
   `startDrive`/`switchFolders` (`src/App.jsx` ~61–72, ~85–89) leave the user
   stuck with no way back. Needs an escape hatch (timeout/cancel + surfaced
   error) so a Picker failure is always recoverable. This is why Carter couldn't
   navigate away this time.

Note: the app is public-loadable (public repo Pages), but no Drive data is
reachable without each user signing in as themselves (drive.file scope only).
Sign-in only works for OAuth test users (Carter/Hannah/Justina) until the
consent screen is published — fine for testing.

Pick up next: real-Drive smoke test of the new save path (needs the Picker
"invalid key" bug looked at too), then let Hannah react to the new Filing
Mode before more polish.

## Session 2026-07-08 (third) — Filing Mode UX batch (branch: `filing-preview-and-fixes`)
Carter's feedback, all done + verified in sample mode (DOM-inspected; screenshots
skipped — the preview browser hangs rendering pdf.js at full size, a known gotcha):
- [x] **Double-click to enlarge / drill-down.** Double-click any card → an
      enlarged preview overlay. Containers show contents as a grid you click
      into (one level down at a time, breadcrumb to go back); files show pages
      scrollable; a lone page shows itself. `src/components/FilingMode.jsx`
      (`preview` stack state + `renderPreviewBody`/`renderPreviewTile`),
      styles in `src/styles.css` (`.preview-*`).
- [x] **💥 a page out of a document → Unclassified.** In the file (document)
      view each page has a 💥 that separates it back to the Unclassified column
      as a standalone single-page PDF. New model op `separatePage()` in
      `filingModel.js` (materializes a pristine file so the remainder rebuilds
      on save). First use shows the confirm Carter specified ("This page will be
      separated…") with a session-scoped "don't show again" (module-level flag,
      resets on full browser reload, survives data reloads/mode switches).
- [x] **Rename "Page" column → "Unclassified"** (`KIND_LABEL.raw`).
- [x] **Drag a single page into the File column.** New "+ new file (drop a
      page)" slot (drop-only) + `dropOperation` 'newSingleFile' — promotes one
      page to a standalone file without merging first.
- Tests 36 → 40 green; lint clean. Not yet deployed (`npm run deploy`) — do
  that once Carter's happy with it locally.

## Session 2026-07-08 (fourth) — metadata↔structure sync (branch: `filing-preview-and-fixes`)
The big realization this session: a file's location lives in THREE places —
its physical Drive folder, its `properties` metadata, and its filename — and
each entry point was only updating a subset, so they drifted silently. Editing
a folder in Marking Mode wrote the property but never moved/renamed the file.
- [x] **`src/lib/refile.js` — the single `refileFile()` sync operation.**
      Resolve-or-create the `Archive Capture — Collection / Box n / Folder m`
      chain, move the file, rename it (new counter for the destination, or the
      title), write properties, update the local corpus tree in place. It's the
      distilled version of `mergeSave.js`'s pristine-file branch. Fully
      unit-tested (`__tests__/refile.test.js`, 6 cases).
- [x] **Marking Mode saves now re-file.** `MarkingMode.handleSave`: when
      placement or title changed and a collection exists, it calls `refileFile`
      instead of a bare `setProperties`. `App.jsx` passes `roots` through (so a
      brand-new collection can become a new root). Verified in sample mode:
      changing file #7's folder → 9 created Folder 9 under Box 3, moved the file
      in, renumbered #7 → #1.
- [x] **Title replaces the number in filenames** when a file has a title
      (`naming.js` `buildFileName` + both `mergeSave.js` call sites). Carter's
      rule. Titled files don't consume a counter value.
- Tests 40 → 48 green; lint clean. Not deployed yet.

### NEXT UP (agreed, not yet built): Explorer drag also syncs metadata
Carter's request #3. The Explorer ALREADY does drag-to-move in both modes
(`App.jsx` `handleMove` → `backend.move` + local tree update) — but it only
moves the physical file; it does NOT update the box/folder/collection
properties or the filename. That's the *inverse* of the old Marking-Mode
desync. The fix: after the drop, derive the destination's
archive/collection/box/folder from the drop-target folder's ancestry in the
tree, build the new `parsed`, and route through `refileFile` (same op Marking
now uses) instead of the bare `backend.move`. No save confirmation (drag is
already instant — Carter's spec).
Gotchas to handle:
- Deriving metadata from an arbitrary drop-target folder means parsing folder
  NAMES (`Archive Capture — X`, `Box N`, `Folder M`) up the ancestry. Folders
  that don't match the convention (e.g. an `Unprocessed …` batch tree) have no
  clean box/folder — decide behavior (probably: move physically, leave metadata
  blank/loose, or refuse with a hint).
- In Filing Mode, an Explorer drag changes the corpus but Filing's board is a
  snapshot (`buildModel` on mount) — it must rebuild to reflect the move.
- Duplicate-title collisions produce identical filenames (Drive tolerates it;
  a real-FS mirror wouldn't). Flagged, not solved.

### Separate repo: archive-capture Pixel 7a blank-page fix (SHIPPED 2026-07-08)
Branch `fix/pixel7a-blank-pages` in `../archive-capture` (its own repo),
**published to the `preview` EAS channel** (update group
`e977c179-7a25-4f35-b4d9-1cecf1a6b311`). Awaiting Hannah's on-device confirm:
close/reopen the app twice to apply, then scan a multi-page doc on the 7a.
Root cause: `ConfirmationScreen.js` `computePageSize` derived the single
shared PDF page height from ONE page's aspect ratio; another page resized one
pixel taller overflowed it → a blank page between images, phone-model
dependent (7a rounds unfavorably, 10a doesn't). Fixed: size the page to the
tallest page's content + safety pad; `@page margin:0`; `.page:last-child`
break→auto. Branch not yet merged to `master` — merge after she confirms.
