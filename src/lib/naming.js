// The mobile app's filename convention — mirror of buildFileBaseName in
// archive-capture/src/screens/ConfirmationScreen.js, which is the source of
// truth (fixed 2026-07-08 after a real production incident; see the cap note
// below). Bare values only, no "Archive"/"Collection"/"Box"/"Folder" label
// words in the filename itself (Drive *subfolder* names do get "Box "/
// "Folder " prefixes — that's separate):
//   Archive - Collection - Box - Folder - Number[ - OMG].pdf
// Missing fields are skipped entirely, never left as empty placeholders.

// Strip characters that are invalid in file/folder names if this Drive
// content is ever mirrored onto a real filesystem (same set the mobile app
// strips).
function sanitize(value) {
  return String(value)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '');
}

// Confirmed real incident (2026-07-08, mobile app): a long Collection name
// pushed the combined filename long enough that Drive's file upload silently
// and permanently failed — folders kept getting created fine (separate,
// short-named call), so it looked exactly like a network/sync bug. The
// filename is used as Drive's own `name` field and as a local file path, so
// it must be capped at the source. The cap itself lives in driveProps.js —
// the shared contract file both repos carry byte-identical copies of — so
// the two apps can no longer drift apart on it.
import { MAX_FILENAME_LENGTH } from './driveProps.js';

// The final segment is the human title when the file has one, otherwise the
// zero-padded auto-counter. Carter's call (2026-07-08): a title he typed
// should stand in for the number — "title should always replace the number."
// This is a deliberate extension of the mobile app's number-only convention;
// both coexist fine since everything downstream reads the `title` *property*,
// not the filename. A blank/whitespace title falls back to the number.
export function buildFileName({ archiveName, collection, box, folder, number, title, omg }) {
  const parts = [];
  if (archiveName) parts.push(sanitize(archiveName));
  if (collection) parts.push(sanitize(collection));
  if (box) parts.push(sanitize(box));
  if (folder) parts.push(sanitize(folder));
  parts.push(title && String(title).trim() ? sanitize(title) : String(number).padStart(6, '0'));
  const joined = parts.join(' - ');
  const base = joined.length > MAX_FILENAME_LENGTH ? joined.slice(0, MAX_FILENAME_LENGTH) : joined;
  return (omg ? `${base} - OMG` : base) + '.pdf';
}

// The zero-padded number is a per-Box+Folder counter. Given the filenames
// already in the destination folder, the next number is max+1.
export function nextNumber(existingNames) {
  let max = 0;
  for (const name of existingNames) {
    const m = name.match(/(\d{6})(?: - OMG)?\.pdf$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

// Short display label for the explorer: filed files show their number (+
// title if set); unfiled files show their original name.
export function displayName(fileName, parsed) {
  if (parsed?.title) return parsed.title;
  const m = fileName.match(/(\d{6})(?: - OMG)?\.pdf$/i);
  if (m) return `#${parseInt(m[1], 10)}`;
  return fileName.replace(/\.pdf$/i, '');
}
