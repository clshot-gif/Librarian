// The pure data model behind the redesigned Filing Mode: a six-level
// hierarchy (raw page → file → folder → box → collection → archive) where
// *placement is metadata* — a card's box/folder/collection/archive values
// are derived from where it sits, not typed into a form afterwards.
//
// Three distinct placement states, and the win logic depends on telling
// them apart:
//   • nested (parentId set, bucket=false, parent exactly one level up) —
//     fully resolved at that level.
//   • deliberate skip (parentId set, bucket=false, parent 2+ levels up) —
//     e.g. a file dropped straight onto a Collection: box/folder are
//     *intentionally* flat, and that counts as resolved.
//   • unresolved (parentId set, bucket=true) — the `?` bucket: "known to
//     belong under this parent, not yet given a slot at the level(s)
//     between". Blocks the win state until resolved.
//   • loose (parentId null) — not yet pointed anywhere at all.
//
// Everything here is plain JSON-serializable data (undo works by snapshot)
// and pure functions — no React, no backend. The component clones state
// before mutating; these functions mutate the clone in place.

export const KINDS = ['raw', 'file', 'folder', 'box', 'collection', 'archive'];
export const LEVEL = { raw: 0, file: 1, folder: 2, box: 3, collection: 4, archive: 5 };
export const KIND_LABEL = {
  raw: 'Page',
  file: 'File',
  folder: 'Folder',
  box: 'Box',
  collection: 'Collection',
  archive: 'Archive',
};

export function createState() {
  const state = { seq: 1, nodes: {} };
  // The always-present deliberate-skip target at the top: collections
  // dropped here are intentionally archive-less (the mobile app treats
  // Archive Name as optional), distinct from a collection left loose
  // (undecided, blocks the win state).
  addNode(state, { kind: 'archive', name: 'No archive', special: 'noArchive' });
  return state;
}

export function addNode(state, fields) {
  const id = `n${state.seq++}`;
  const node = {
    id,
    kind: fields.kind,
    parentId: fields.parentId ?? null,
    bucket: fields.bucket ?? false,
    order: state.seq,
    name: fields.name ?? '',
    expected: fields.expected ?? false,
    special: fields.special,
    title: fields.title ?? '',
    source: fields.source,
    materialized: fields.materialized ?? false,
    ref: fields.ref,
    origin: fields.origin ?? null,
    hint: fields.hint,
    meta: fields.meta,
  };
  state.nodes[id] = node;
  return node;
}

export function childrenOf(state, parentId, { buckets = false } = {}) {
  return Object.values(state.nodes)
    .filter((n) => n.parentId === parentId && n.bucket === buckets)
    .sort((a, b) => a.order - b.order);
}

// Archives are top-level by nature — parentId null is their home, not a
// "loose, needs placing" state — so they're never in this list.
export function looseNodes(state) {
  return Object.values(state.nodes)
    .filter((n) => n.parentId === null && n.kind !== 'archive')
    .sort((a, b) => a.order - b.order);
}

// Where should a rebuilt file's "I came from here" pointer aim? Raw pages
// spilled from a file shell point at the shell; the container that misses
// them is the shell's parent — or, when the shell was itself spilled loose
// (folder exploded first, then the file), whatever the shell still owes
// itself to. Files/folders spilled from a container point at the container.
function inheritedOrigin(state, items) {
  for (const item of items) {
    if (!item.origin) continue;
    if (item.kind === 'raw') {
      const shell = state.nodes[item.origin];
      if (shell?.parentId) return shell.parentId;
      if (shell?.origin) return shell.origin;
    } else {
      return item.origin;
    }
  }
  return null;
}

export function isNamed(node) {
  return Boolean(node.special) || node.name.trim() !== '';
}

// Case-insensitive find-or-create of a container child. Loading a real file
// into a finding-aid "expected" slot claims it (expected → real).
function ensureChild(state, parentId, kind, name, { expected = false } = {}) {
  const match = Object.values(state.nodes).find(
    (n) =>
      n.kind === kind &&
      n.parentId === parentId &&
      !n.bucket &&
      n.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (match) {
    if (!expected) match.expected = false;
    return match;
  }
  return addNode(state, { kind, parentId, name: name.trim(), expected });
}

function ensureArchive(state, name, { expected = false } = {}) {
  const match = Object.values(state.nodes).find(
    (n) =>
      n.kind === 'archive' &&
      !n.special &&
      n.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (match) {
    if (!expected) match.expected = false;
    return match;
  }
  return addNode(state, { kind: 'archive', name: name.trim(), expected });
}

export function noArchiveNode(state) {
  return Object.values(state.nodes).find((n) => n.kind === 'archive' && n.special === 'noArchive');
}

// ── Building the workspace from the loaded corpus ─────────────────────────
//
// Placement rules for already-tagged files (metadata → position):
//   collection+box+folder → fully nested (resolved).
//   collection+box, no folder → Box's `?` bucket (folder unresolved — the
//     mobile app always asks for box/folder, so a blank one reads as
//     "not filled in yet", which is exactly what the bucket means).
//   collection only → Collection's `?` bucket (box+folder unresolved).
//   archive_name blank on an otherwise-filed file → under "No archive"
//     (the mobile app treats Archive Name as genuinely optional, so a blank
//     one on a *filed* file was a deliberate choice, not an omission).
//   nothing at all → loose; single-page scans enter as raw pages (they're
//     photos of pages, waiting to be built into documents), multi-page PDFs
//     as files.
export function buildModel(corpusNodes, scopeIds) {
  const state = createState();
  const files = [];
  const walk = (id) => {
    const n = corpusNodes.get(id);
    if (!n) return;
    if (!n.isFolder) {
      files.push(n);
      return;
    }
    n.children.forEach(walk);
  };
  for (const sid of scopeIds) walk(sid);
  files.sort((a, b) => (a.parsed?.capturedAt || '').localeCompare(b.parsed?.capturedAt || ''));

  for (const n of files) {
    const p = n.parsed;
    const hint = {
      archiveName: p.archiveName,
      collection: p.collection,
      box: p.box,
      folder: p.folder,
    };
    const unfiled = !p.collection && !p.box && !p.folder && !p.archiveName && !p.title;
    if (unfiled && p.pageCount === 1) {
      addNode(state, {
        kind: 'raw',
        ref: { fileId: n.id, pageIndex: null },
        meta: rawMeta(p, 0, n.name),
        hint,
      });
      continue;
    }
    let parentId = null;
    let bucket = false;
    if (p.collection) {
      const arch = p.archiveName ? ensureArchive(state, p.archiveName) : noArchiveNode(state);
      const coll = ensureChild(state, arch.id, 'collection', p.collection);
      if (p.box) {
        const box = ensureChild(state, coll.id, 'box', p.box);
        if (p.folder) {
          parentId = ensureChild(state, box.id, 'folder', p.folder).id;
        } else {
          parentId = box.id;
          bucket = true;
        }
      } else {
        parentId = coll.id;
        bucket = true;
      }
    }
    addNode(state, {
      kind: 'file',
      parentId,
      bucket,
      title: p.title,
      source: { fileId: n.id },
      hint,
      meta: { capturedAt: p.capturedAt, pageCount: p.pageCount, omg: p.omgPages.length > 0 },
    });
  }
  return state;
}

function rawMeta(parsed, pageIndex, label) {
  return {
    capturedAt: parsed.capturedAt,
    omg: parsed.omgPages.includes(pageIndex),
    hasBackup: parsed.unmarkedBackupPages.includes(pageIndex),
    commentCount: parsed.comments.filter((c) => (c.page || 0) === pageIndex).length,
    label,
  };
}

// Finding-aid slots become *expected* containers — named drop targets
// waiting to be filled, rendered dashed. Existing real containers with the
// same name are reused, never duplicated.
export function applyFindingAid(state, aid) {
  let archId = null;
  if (aid.archiveName) {
    const existing = Object.values(state.nodes).find(
      (n) =>
        n.kind === 'archive' &&
        !n.special &&
        n.name.trim().toLowerCase() === aid.archiveName.trim().toLowerCase(),
    );
    archId = (existing || ensureArchive(state, aid.archiveName, { expected: true })).id;
  }
  const coll = ensureChild(state, archId, 'collection', aid.collectionTitle, { expected: true });
  for (const b of aid.boxes) {
    const box = ensureChild(state, coll.id, 'box', b.name, { expected: true });
    for (const f of b.folders) {
      ensureChild(state, box.id, 'folder', f, { expected: true });
    }
  }
  return coll.id;
}

// ── Drag → drop legality ───────────────────────────────────────────────────
// target: {type:'node', id} | {type:'bucket', parentId} | {type:'new', kind}
// Returns an operation name or null (invalid).
export function dropOperation(state, dragId, target) {
  const drag = state.nodes[dragId];
  if (!drag) return null;
  if (target.type === 'new') {
    if (LEVEL[target.kind] <= LEVEL[drag.kind]) return null;
    if (target.kind === 'archive') return null; // archives come from finding aids / typing, not drops
    return 'newContainer';
  }
  if (target.type === 'bucket') {
    const parent = state.nodes[target.parentId];
    if (!parent) return null;
    // A bucket drop must leave at least one level genuinely unresolved
    // between the card and the parent — otherwise dropping on the parent
    // itself is the same statement, minus the question mark.
    if (LEVEL[parent.kind] - LEVEL[drag.kind] < 2) return null;
    if (drag.parentId === parent.id && drag.bucket) return null; // already there
    return 'nestBucket';
  }
  const node = state.nodes[target.id];
  if (!node || node.id === dragId) return null;
  if (drag.kind === 'raw' && node.kind === 'raw') {
    // Onto a page that's already inside a file = join that file.
    const parent = node.parentId && state.nodes[node.parentId];
    if (parent?.kind === 'file') return parent.id === drag.parentId ? null : 'addPage';
    return 'newFile';
  }
  if (drag.kind === 'raw' && node.kind === 'file') {
    return node.parentId === drag.id ? null : drag.parentId === node.id ? null : 'addPage';
  }
  if (drag.kind === 'file' && node.kind === 'file') return 'mergeFiles';
  if (LEVEL[node.kind] > LEVEL[drag.kind]) {
    // Archives only take collections directly — anything lower would skip
    // the Collection level, and a file with no collection can't be saved
    // under the naming convention at all. (The archive's `?` bucket is the
    // right home for "in this archive, collection TBD".)
    if (node.kind === 'archive' && drag.kind !== 'collection') return null;
    if (drag.parentId === node.id && !drag.bucket) return null; // no-op
    return 'nest';
  }
  return null;
}

// Resolve the raw target node for addPage (the file, even when the drop
// landed on a page inside it).
function addPageTargetFile(state, target) {
  const node = state.nodes[target.id];
  if (node.kind === 'file') return node;
  return state.nodes[node.parentId];
}

// Turn a pristine (whole-Drive-file) file node into materialized raw page
// children, one per *content* page. Backup pages and the notes page are
// bookkeeping that rides along at save time — they never become cards.
export function materializeFile(state, fileNode, getParsed) {
  if (!fileNode.source) return;
  const parsed = getParsed(fileNode.source.fileId);
  for (let i = 0; i < parsed.pageCount; i++) {
    addNode(state, {
      kind: 'raw',
      parentId: fileNode.id,
      ref: { fileId: fileNode.source.fileId, pageIndex: i },
      meta: rawMeta(parsed, i, `p.${i + 1}`),
      hint: fileNode.hint,
    });
  }
  fileNode.materialized = true;
  delete fileNode.source;
}

// Apply one drop. Returns {op, focusId} — focusId is a node whose name/title
// input should be focused (the "drag is the data entry" moment for brand-new
// containers).
export function applyDrop(state, dragId, target, getParsed) {
  const op = dropOperation(state, dragId, target);
  if (!op) return null;
  const drag = state.nodes[dragId];
  let focusId = null;

  if (op === 'newFile') {
    const other = state.nodes[target.id];
    const file = addNode(state, { kind: 'file', materialized: true, hint: drag.hint });
    // A file rebuilt from spilled pages remembers which container its pieces
    // came from — that's what keeps the source folder "in progress" until
    // every rebuilt file lands somewhere, and what makes its win fire on the
    // last drop rather than the first.
    file.origin = inheritedOrigin(state, [other, drag]);
    for (const [i, page] of [other, drag].entries()) {
      page.parentId = file.id;
      page.bucket = false;
      page.origin = null;
      page.order = state.seq + i;
    }
    state.seq += 2;
    file.meta = { capturedAt: earliestCapturedAt([other, drag]) };
    focusId = file.id;
  } else if (op === 'addPage') {
    const file = addPageTargetFile(state, target);
    if (file.source) materializeFile(state, file, getParsed);
    if (file.parentId === null && !file.origin) {
      file.origin = inheritedOrigin(state, [drag]);
    }
    drag.parentId = file.id;
    drag.bucket = false;
    drag.origin = null;
    drag.order = state.seq++;
  } else if (op === 'mergeFiles') {
    const into = state.nodes[target.id];
    if (into.source) materializeFile(state, into, getParsed);
    if (drag.source) materializeFile(state, drag, getParsed);
    for (const page of childrenOf(state, drag.id)) {
      page.parentId = into.id;
      page.order = state.seq++;
    }
    if (!into.title && drag.title) into.title = drag.title;
    delete state.nodes[drag.id];
  } else if (op === 'nest') {
    const node = state.nodes[target.id];
    drag.parentId = node.id;
    drag.bucket = false;
    drag.origin = null;
    drag.order = state.seq++;
    if (node.expected) node.expected = false;
  } else if (op === 'nestBucket') {
    drag.parentId = target.parentId;
    drag.bucket = true;
    drag.origin = null;
    drag.order = state.seq++;
  } else if (op === 'newContainer') {
    const container = addNode(state, { kind: target.kind, name: '' });
    drag.parentId = container.id;
    drag.bucket = false;
    drag.origin = null;
    focusId = container.id;
  }
  cleanupShells(state);
  return { op, focusId };
}

function earliestCapturedAt(items) {
  return items.reduce((min, n) => {
    const t = n.meta?.capturedAt || '';
    return t && (!min || t < min) ? t : min;
  }, '');
}

// Merge several selected raws/files into one file, ordered by captured_at —
// the existing multi-select gesture, kept.
export function mergeSelection(state, ids, getParsed) {
  const items = ids.map((id) => state.nodes[id]).filter(Boolean);
  if (items.length < 2) return null;
  if (!items.every((i) => i.kind === 'raw' || i.kind === 'file')) return null;
  const capturedAt = (n) => n.meta?.capturedAt || '';
  const ordered = [...items].sort((a, b) => capturedAt(a).localeCompare(capturedAt(b)));
  const file = addNode(state, {
    kind: 'file',
    materialized: true,
    hint: ordered[0].hint,
    meta: { capturedAt: earliestCapturedAt(items) },
  });
  file.origin = inheritedOrigin(state, ordered);
  for (const item of ordered) {
    if (item.kind === 'raw') {
      item.parentId = file.id;
      item.bucket = false;
      item.origin = null;
      item.order = state.seq++;
    } else {
      if (item.source) materializeFile(state, item, getParsed);
      for (const page of childrenOf(state, item.id)) {
        page.parentId = file.id;
        page.order = state.seq++;
      }
      if (!file.title && item.title) file.title = item.title;
      delete state.nodes[item.id];
    }
  }
  cleanupShells(state);
  return file.id;
}

// Explode: decompose exactly one level down. File → its raw pages, Folder →
// its files, Box → its folders. Spilled children go loose with an `origin`
// pointer back to the shell, which is what drives the "exploded/in-progress"
// rendering and the win when everything comes back resolved.
export function explodeNode(state, id, getParsed) {
  const node = state.nodes[id];
  if (!node || !['file', 'folder', 'box'].includes(node.kind)) return [];
  if (node.kind === 'file' && node.source) materializeFile(state, node, getParsed);
  const spilled = childrenOf(state, id);
  for (const child of spilled) {
    child.parentId = null;
    child.bucket = false;
    child.origin = id;
  }
  return spilled.map((c) => c.id);
}

// Put every still-loose spilled child back where it came from.
export function gatherBack(state, id) {
  const returned = [];
  for (const n of Object.values(state.nodes)) {
    if (n.parentId === null && n.origin === id && state.nodes[id]) {
      n.parentId = id;
      n.bucket = false;
      n.origin = null;
      returned.push(n.id);
    }
  }
  cleanupShells(state);
  return returned;
}

// A materialized file with no pages left is a spent shell. Keep it while
// loose pages still point back to it (the user may gather them); once every
// page has a new home, the shell's identity is gone — remove it.
export function cleanupShells(state) {
  const originIds = new Set(
    Object.values(state.nodes)
      .filter((n) => n.parentId === null && n.origin)
      .map((n) => n.origin),
  );
  for (const n of Object.values(state.nodes)) {
    if (
      n.kind === 'file' &&
      n.materialized &&
      childrenOf(state, n.id).length === 0 &&
      !originIds.has(n.id)
    ) {
      delete state.nodes[n.id];
    }
  }
}

export function removeContainer(state, id) {
  const node = state.nodes[id];
  if (!node || LEVEL[node.kind] < 2 || node.special) return false;
  const hasChildren =
    childrenOf(state, id).length > 0 || childrenOf(state, id, { buckets: true }).length > 0;
  if (hasChildren) return false;
  // Anything still loose that spilled from this container loses its way home.
  for (const n of Object.values(state.nodes)) {
    if (n.origin === id) n.origin = null;
  }
  delete state.nodes[id];
  return true;
}

// ── Derived placement info (ancestry chips, save values) ──────────────────
// Walk up from a node and report each level above it as resolved (a name),
// skipped (deliberate gap), unresolved (bucket gap), or unplaced (loose).
export function ancestry(state, id) {
  const node = state.nodes[id];
  const out = [];
  let cur = node;
  while (cur) {
    if (cur.parentId === null) {
      for (let lv = LEVEL[cur.kind] + 1; lv <= 5; lv++) {
        out.push({ kind: KINDS[lv], state: 'unplaced' });
      }
      break;
    }
    const parent = state.nodes[cur.parentId];
    for (let lv = LEVEL[cur.kind] + 1; lv < LEVEL[parent.kind]; lv++) {
      out.push({ kind: KINDS[lv], state: cur.bucket ? 'unresolved' : 'skipped' });
    }
    out.push({
      kind: parent.kind,
      state: cur.bucket ? 'unresolved-parent' : 'resolved',
      name: parent.special ? '—' : parent.name || '(unnamed)',
      unnamed: !isNamed(parent),
    });
    cur = parent;
  }
  return out;
}

// ── Completeness / win state ───────────────────────────────────────────────
export function computeCompleteness(state) {
  const nodes = Object.values(state.nodes);
  const byParent = new Map();
  for (const n of nodes) {
    if (n.parentId !== null) {
      if (!byParent.has(n.parentId)) byParent.set(n.parentId, []);
      byParent.get(n.parentId).push(n);
    }
  }
  const looseOrigins = new Set(
    nodes.filter((n) => n.parentId === null && n.origin).map((n) => n.origin),
  );

  const fileOk = (f) => Boolean(f.source) || (byParent.get(f.id) || []).some((c) => !c.bucket);

  const resolvedUp = (n) => {
    let cur = n;
    while (cur) {
      if (cur.kind === 'archive') return true;
      if (cur.parentId === null || cur.bucket) return false;
      cur = state.nodes[cur.parentId];
    }
    return false;
  };

  // clean = nothing unresolved anywhere in the subtree; content = holds at
  // least one actual document/page.
  const cleanCache = new Map();
  const contentCache = new Map();
  const subtree = (id, fn, cache) => {
    if (cache.has(id)) return cache.get(id);
    const v = fn(id);
    cache.set(id, v);
    return v;
  };
  const hasContent = (id) =>
    subtree(
      id,
      (i) => {
        const kids = (byParent.get(i) || []).filter((c) => !c.bucket);
        return kids.some(
          (c) => c.kind === 'raw' || (c.kind === 'file' && fileOk(c)) || hasContent(c.id),
        );
      },
      contentCache,
    );
  const isClean = (id) =>
    subtree(
      id,
      (i) => {
        const node = state.nodes[i];
        if (looseOrigins.has(i)) return false;
        const kids = byParent.get(i) || [];
        if (kids.some((c) => c.bucket)) return false;
        for (const c of kids.filter((k) => !k.bucket)) {
          if (c.kind === 'raw') continue;
          if (c.kind === 'file') {
            if (!fileOk(c)) return false;
            if (!isClean(c.id)) return false;
            continue;
          }
          if (!isNamed(c)) return false;
          if (!isClean(c.id)) return false;
        }
        return node ? true : false;
      },
      cleanCache,
    );

  const complete = new Set();
  for (const n of nodes) {
    if (LEVEL[n.kind] < 2) continue; // per-level wins are for folder and up
    if (n.expected && !(byParent.get(n.id) || []).length) continue;
    if (isNamed(n) && hasContent(n.id) && isClean(n.id) && resolvedUp(n)) {
      complete.add(n.id);
    }
  }

  // Global win: every document has landed in an archive (resolved or
  // deliberately flat), nothing loose, nothing in a `?` bucket, nothing
  // mid-explode. Empty expected slots don't block it — they're invitations,
  // not debts.
  const contentNodes = nodes.filter((n) => n.kind === 'raw' || n.kind === 'file');
  const blockers = {
    loose: nodes.filter(
      (n) =>
        n.parentId === null &&
        n.kind !== 'archive' &&
        // Empty containers (expected slots, freshly created ones) are
        // invitations, not debts — they never block the win.
        !(LEVEL[n.kind] >= 2 && !(byParent.get(n.id) || []).length),
    ).length,
    buckets: nodes.filter((n) => n.bucket).length,
    unnamed: nodes.filter((n) => LEVEL[n.kind] >= 2 && !isNamed(n) && hasContent(n.id)).length,
    shells: nodes.filter((n) => n.kind === 'file' && !fileOk(n)).length,
  };
  const global =
    contentNodes.length > 0 &&
    contentNodes.every((n) => (n.kind === 'file' ? fileOk(n) : true) && resolvedUp(n)) &&
    blockers.loose === 0 &&
    blockers.buckets === 0 &&
    blockers.unnamed === 0 &&
    blockers.shells === 0;

  return { complete, global, blockers };
}

// ── Suggestions: metadata already on a card lights up matching targets ────
export function suggestTargets(state, dragId) {
  const drag = state.nodes[dragId];
  const hint = drag?.hint;
  const out = new Set();
  if (!hint) return out;
  const eq = (a, b) => a && b && a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const n of Object.values(state.nodes)) {
    if (LEVEL[n.kind] <= LEVEL[drag.kind]) continue;
    if (n.kind === 'folder' && eq(n.name, hint.folder)) {
      const box = n.parentId && state.nodes[n.parentId];
      if (!hint.box || (box?.kind === 'box' && eq(box.name, hint.box))) out.add(n.id);
    }
    if (n.kind === 'box' && eq(n.name, hint.box)) out.add(n.id);
    if (n.kind === 'collection' && eq(n.name, hint.collection)) out.add(n.id);
    if (n.kind === 'archive' && !n.special && eq(n.name, hint.archiveName)) out.add(n.id);
  }
  return out;
}

// ── Save plan: what the arrangement means in Drive terms ───────────────────
// Only fully-determinate placements are written: bucket (`?`) items and
// loose cards stay untouched, files under unnamed containers wait for a
// name. Deliberate skips save with the skipped fields empty — exactly the
// existing filename convention's "missing fields are skipped".
export function buildSavePlan(state) {
  const units = new Map(); // key → {archiveName, collection, box, folder, files:[]}
  const skipped = { unresolved: 0, loose: 0, unnamed: 0, noCollection: 0, shells: 0 };

  const fileEntry = (node) => {
    if (node.kind === 'raw') {
      return { nodeId: node.id, title: '', refs: [node.ref], pristineFileId: null };
    }
    if (node.source) {
      return {
        nodeId: node.id,
        title: node.title,
        refs: [{ fileId: node.source.fileId, pageIndex: null }],
        pristineFileId: node.source.fileId,
      };
    }
    const pages = childrenOf(state, node.id);
    if (!pages.length) {
      skipped.shells++;
      return null;
    }
    return {
      nodeId: node.id,
      title: node.title,
      refs: pages.map((p) => p.ref),
      pristineFileId: null,
    };
  };

  const addFile = (node, ctx) => {
    const entry = fileEntry(node);
    if (!entry) return;
    // NUL separator: can't collide with anything a user can type in a name.
    const key = [ctx.archiveName, ctx.collection, ctx.box, ctx.folder].join('\u0000');
    if (!units.has(key)) units.set(key, { ...ctx, files: [] });
    units.get(key).files.push(entry);
  };

  const countSubtreeFiles = (id) => {
    let n = 0;
    const walkAll = (pid) => {
      for (const c of Object.values(state.nodes)) {
        if (c.parentId !== pid) continue;
        if (c.kind === 'raw' || c.kind === 'file') n++;
        else walkAll(c.id);
      }
    };
    walkAll(id);
    return n;
  };

  const walk = (containerId, ctx) => {
    const container = state.nodes[containerId];
    // Bucket children are unresolved — left alone, counted for the modal.
    skipped.unresolved += childrenOf(state, containerId, { buckets: true }).reduce(
      (acc, c) => acc + (c.kind === 'raw' || c.kind === 'file' ? 1 : countSubtreeFiles(c.id) || 1),
      0,
    );
    for (const child of childrenOf(state, containerId)) {
      if (child.kind === 'raw' || child.kind === 'file') {
        addFile(child, ctx);
      } else if (!isNamed(child)) {
        skipped.unnamed += countSubtreeFiles(child.id);
      } else if (child.kind === 'folder') {
        walk(child.id, { ...ctx, folder: child.name.trim() });
      } else if (child.kind === 'box') {
        walk(child.id, { ...ctx, box: child.name.trim() });
      } else if (child.kind === 'collection') {
        walk(child.id, { ...ctx, collection: child.name.trim() });
      }
    }
    return container;
  };

  for (const arch of Object.values(state.nodes).filter(
    (n) => n.kind === 'archive' && n.parentId === null,
  )) {
    const archiveName = arch.special ? '' : arch.name.trim();
    if (!arch.special && !isNamed(arch)) continue;
    skipped.unresolved += childrenOf(state, arch.id, { buckets: true }).reduce(
      (acc, c) => acc + (c.kind === 'raw' || c.kind === 'file' ? 1 : countSubtreeFiles(c.id) || 1),
      0,
    );
    for (const coll of childrenOf(state, arch.id)) {
      if (coll.kind !== 'collection') {
        // Files/folders can't sit directly under an archive (no collection →
        // unsavable); dropOperation prevents it, but count defensively.
        skipped.noCollection += countSubtreeFiles(coll.id) || 1;
        continue;
      }
      if (!isNamed(coll)) {
        skipped.unnamed += countSubtreeFiles(coll.id);
        continue;
      }
      walk(coll.id, { archiveName, collection: coll.name.trim(), box: '', folder: '' });
    }
  }

  // Loose content (and anything under a loose collection — undecided at the
  // archive level) is untouched by Save, same spirit as before.
  for (const n of looseNodes(state)) {
    if (n.kind === 'raw' || n.kind === 'file') skipped.loose++;
    else if (n.kind !== 'archive') skipped.loose += countSubtreeFiles(n.id);
  }

  return { units: [...units.values()], skipped };
}
