// The mobile app's filename convention (fixed 2026-07-07):
//   Archive <name> - Collection <name> - Box <n> - Folder <n> - Number[ - OMG].pdf
// Missing fields are skipped entirely, never left as empty placeholders.

function sanitize(value) {
  // Drive filenames tolerate most characters; strip slashes so a name can
  // never read as a path, and collapse the separator sequence " - " which
  // would break parsing.
  return String(value).replace(/[/\\]/g, '-').replace(/ - /g, ' – ').trim();
}

export function buildFileName({ archiveName, collection, box, folder, number, omg }) {
  const parts = [];
  if (archiveName) parts.push(`Archive ${sanitize(archiveName)}`);
  if (collection) parts.push(`Collection ${sanitize(collection)}`);
  if (box) parts.push(`Box ${sanitize(box)}`);
  if (folder) parts.push(`Folder ${sanitize(folder)}`);
  parts.push(String(number).padStart(6, '0'));
  if (omg) parts.push('OMG');
  return parts.join(' - ') + '.pdf';
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
