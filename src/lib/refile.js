// One operation that keeps a file's THREE representations of "where it lives"
// in sync: its physical Drive folder, its `properties` metadata, and its
// filename. Before this existed, each entry point updated a different subset —
// Marking Mode wrote properties but never moved/renamed the file; the Explorer
// drag moved the file but never updated its metadata — so the two drifted
// apart silently. Everything that changes a file's placement should route
// through here.
//
// This is the single-file distillation of mergeSave.js's pristine-file branch
// (resolve/create the Archive Capture — Collection / Box n / Folder m chain →
// setProperties → rename → move), plus the local-corpus-tree bookkeeping so
// the Explorer/Marking/Filing views reflect the move without a full reload.
import { buildFileName, nextNumber } from './naming.js';
import { serializeProps } from './metadata.js';

const ROOT_PREFIX = 'Archive Capture — ';

function findChildFolderByName(nodes, parentId, name) {
  const parent = parentId == null ? null : nodes.get(parentId);
  if (!parent?.children) return null;
  for (const cid of parent.children) {
    const c = nodes.get(cid);
    if (c?.isFolder && c.name === name) return c.id;
  }
  return null;
}

// Resolve-or-create a child folder, syncing Drive and the local tree.
async function ensureChildFolder(backend, nodes, parentId, name, rootId) {
  const existing = findChildFolderByName(nodes, parentId, name);
  if (existing) return existing;
  const id = await backend.createFolder(name, parentId);
  nodes.set(id, { id, name, isFolder: true, parentId, rootId, children: [], parsed: null });
  const parent = parentId == null ? null : nodes.get(parentId);
  if (parent) parent.children.push(id);
  return id;
}

// Resolve-or-create the `Archive Capture — <collection>` root among the loaded
// roots. A brand-new collection becomes a new top-level root (pushed into the
// shared `roots` array so the Explorer picks it up on the next render).
async function ensureCollectionRoot(backend, nodes, roots, collection) {
  const rootName = `${ROOT_PREFIX}${collection}`;
  for (const r of roots) {
    const n = nodes.get(r.id);
    if (n && n.name === rootName) return n.id;
  }
  const id = await backend.createFolder(rootName, null);
  nodes.set(id, {
    id,
    name: rootName,
    isFolder: true,
    parentId: null,
    rootId: id,
    children: [],
    parsed: null,
  });
  roots.push({ id, name: rootName });
  return id;
}

// Re-file one existing file so location, properties, and filename all agree.
// `parsed` is the full new metadata for the file (box/folder/collection/
// archiveName/title plus everything else). Mutates `nodes` (and possibly
// `roots`) in place; returns the new filename. Caller is responsible for
// triggering a re-render / highlight refresh afterward.
//
// A file with no collection isn't filable under the naming convention, so it's
// left physically where it is and only its properties are updated.
export async function refileFile({ backend, nodes, roots, fileId, parsed }) {
  const node = nodes.get(fileId);
  if (!node) throw new Error('refileFile: unknown file id');

  const collection = (parsed.collection || '').trim();
  if (!collection) {
    await backend.setProperties(fileId, serializeProps(parsed));
    node.parsed = parsed;
    return node.name;
  }

  const archiveName = (parsed.archiveName || '').trim();
  const box = (parsed.box || '').trim();
  const folder = (parsed.folder || '').trim();
  const title = (parsed.title || '').trim();

  // A blank level below a filled one is a deliberate skip — stamp it so a
  // later reload reads it as a flat placement, not "unknown yet" (a ? bucket),
  // matching Filing Mode's save semantics.
  parsed.skippedLevels = [!box && 'box', !folder && 'folder'].filter(Boolean);

  const rootId = await ensureCollectionRoot(backend, nodes, roots, collection);
  let destId = rootId;
  if (box) destId = await ensureChildFolder(backend, nodes, destId, `Box ${box}`, rootId);
  if (folder) destId = await ensureChildFolder(backend, nodes, destId, `Folder ${folder}`, rootId);

  // A titled file uses the title in place of the number, so it doesn't consume
  // a counter value at the destination.
  let number = 0;
  if (!title) {
    const existing = await backend.listChildren(destId);
    number = nextNumber(existing.map((e) => e.name));
  }
  const name = buildFileName({
    archiveName,
    collection,
    box,
    folder,
    number,
    title,
    omg: (parsed.omgPages?.length || 0) > 0,
  });

  await backend.setProperties(fileId, serializeProps(parsed));
  await backend.rename(fileId, name);
  if (node.parentId !== destId) await backend.move(fileId, destId, node.parentId);

  // Sync the local corpus tree: unlink from old parent, relink under dest.
  const oldParent = node.parentId != null ? nodes.get(node.parentId) : null;
  if (oldParent) oldParent.children = oldParent.children.filter((c) => c !== fileId);
  node.parentId = destId;
  node.rootId = rootId;
  node.name = name;
  node.parsed = parsed;
  const dest = nodes.get(destId);
  if (dest && !dest.children.includes(fileId)) dest.children.push(fileId);

  return name;
}
