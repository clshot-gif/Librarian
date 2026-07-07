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

## Next up
- [ ] Carter: create the Picker API key (instructions in src/config.js) —
      real Drive mode is blocked on this one console step
- [ ] First real-Drive shakedown: sign in, pick a real Unprocessed folder,
      file a small batch; expect rough edges in Drive error handling
- [ ] Decide hosting (GitHub Pages like PDF-dream?) — needs the new origin
      added to the OAuth client + Picker key restrictions
- [ ] Let Hannah/Justina react before building more (that's the whole point
      of the first pass)

## Blockers / watch-outs discovered
- Drive `properties` 124-byte-per-value cap: comment_log can exceed it on
  chatty documents; mobile app shares the risk. Revisit if real data hits it.
- Filing Mode loads *all* descendant files of the scoped folder as cards;
  a 2,000-file collection will need pagination/virtualization eventually.

Pick up next: the Picker API key step, then a real-Drive session together.
