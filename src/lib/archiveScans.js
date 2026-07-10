// The canonical "Archive Scans" Drive root — one hand-made folder whose
// direct children (one folder per physical archive) are the only valid
// filing destinations. The app NEVER creates Archive Scans or an archive
// folder itself; it only lists, reads, and files into them.
//
// Because of the drive.file OAuth scope, a folder ID hardcoded in config
// would work for one user's token but grant nothing to another's — each
// user picks Archive Scans once via the existing Picker (which grants their
// token access), and the ID is persisted locally so they aren't re-picking
// every session. localStorage, same pattern as tagStore.js.
import { parseManifest } from './findingAid.js';

const LS_KEY = 'reviewui.archiveScansRoot';

export function getStoredArchiveScans() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    return v && v.id ? v : null;
  } catch {
    return null;
  }
}

export function setStoredArchiveScans(folder) {
  localStorage.setItem(LS_KEY, JSON.stringify({ id: folder.id, name: folder.name }));
}

export function clearStoredArchiveScans() {
  localStorage.removeItem(LS_KEY);
}

// The filing destinations: Archive Scans' direct child folders. Any folder
// directly under it is valid — no marker file, no manifest requirement.
export async function listArchives(backend, scansId) {
  const children = await backend.listChildren(scansId);
  return children
    .filter((c) => c.isFolder)
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// Is this folder Archive Scans itself, or anywhere inside it? Used to warn
// (not block) when a *source* pick overlaps the filing structure — there's a
// real case for re-opening an already-filed folder as material to fix.
// Walks the parents chain up to Archive Scans or the Drive root.
export async function isInsideArchiveScans(backend, folderId, scansId, { maxDepth = 30 } = {}) {
  if (!scansId) return false;
  let cur = folderId;
  for (let i = 0; i <= maxDepth && cur; i++) {
    if (cur === scansId) return true;
    const parents = await backend.getParents(cur);
    cur = parents?.[0] || null;
  }
  return false;
}

// Fetch <archive folder>/Contents/manifest.json if present and parse it into
// finding aids. Returns null when the archive has no Contents folder or no
// manifest.json in it (a manifest-less archive is still a valid destination —
// its columns just start blank). Throws when the file exists but isn't valid
// manifest JSON, so the caller can surface a warning instead of silently
// showing blank columns. Anything else sitting in Contents (the finding-aid
// email, pasted inventory text the JSON was derived from) is deliberately
// ignored — provenance for humans, not input for the app.
export async function fetchArchiveManifest(backend, archiveFolderId) {
  const children = await backend.listChildren(archiveFolderId);
  const contents = children.find((c) => c.isFolder && c.name.trim().toLowerCase() === 'contents');
  if (!contents) return null;
  const inner = await backend.listChildren(contents.id);
  const mf = inner.find((c) => !c.isFolder && c.name.trim().toLowerCase() === 'manifest.json');
  if (!mf) return null;
  // getPdfBytes is a plain alt=media download — the name is historical, it
  // fetches any file's bytes.
  const bytes = await backend.getPdfBytes(mf.id);
  const text = new TextDecoder().decode(bytes);
  return parseManifest(JSON.parse(text));
}
