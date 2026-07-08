# Tasks — Archive Review (Phase 2 Review UI)

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

Pick up next: the Filing Mode redesign conversation (destination-folder
picking, Categorized structure, using the merge-title) — that's the reason
for the new branch.
