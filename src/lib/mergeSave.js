// Filing Mode's save step: turns the workspace arrangement (buildSavePlan in
// filingModel.js) into real Drive structure matching what the mobile app
// would have produced — same folder nesting (Collection root / Box n /
// Folder m), same filename convention, metadata carried page-wise.
//
// The core is buildDocumentPdf: it assembles a new PDF from *page
// references* — whole files or individual pages of exploded files — which
// makes merge-up and split/rebuild the same operation. Splitting correctly
// reverses what merging did: page-indexed fields (comments, OMG flags,
// backup indexes) are re-based to the new document, each marked page's
// clean backup is located positionally in its source and carried along, and
// the source's notes page is never copied (it's rebuilt fresh on save, same
// as before).
import { PDFDocument } from 'pdf-lib';
import { buildFileName, nextNumber } from './naming.js';
import { serializeProps } from './metadata.js';
import { rebuildNotesPage } from './notesPage.js';

// refs: [{fileId, pageIndex|null}] in output order; pageIndex null expands
// to all content pages of that file. Returns {bytes, parsed, usedPages:
// Map(fileId → Set(pageIndex))}.
export async function buildDocumentPdf(backend, nodes, refs, title) {
  const out = await PDFDocument.create();
  const combined = {
    box: '',
    folder: '',
    collection: '',
    archiveName: '',
    title: title || '',
    tags: [],
    important: false,
    hasMarkup: false,
    capturedAt: '',
    pageCount: 0,
    omgPages: [],
    unmarkedBackupPages: [],
    comments: [],
    tagLog: [],
    omgLog: [],
    notesPageIndex: null,
  };

  // Load each source once, however many of its pages are referenced.
  const sources = new Map(); // fileId → {src, parsed}
  const getSource = async (fileId) => {
    if (!sources.has(fileId)) {
      const bytes = await backend.getPdfBytes(fileId);
      sources.set(fileId, {
        src: await PDFDocument.load(bytes),
        parsed: nodes.get(fileId).parsed,
      });
    }
    return sources.get(fileId);
  };

  // Expand whole-file refs to their content pages (never the notes page or
  // the backup pages riding at the back — those are handled separately).
  const pageRefs = [];
  for (const ref of refs) {
    const { parsed } = await getSource(ref.fileId);
    if (ref.pageIndex === null || ref.pageIndex === undefined) {
      for (let i = 0; i < parsed.pageCount; i++) pageRefs.push({ fileId: ref.fileId, pageIndex: i });
    } else {
      pageRefs.push(ref);
    }
  }

  // Content pages, in workspace order. Page-indexed metadata re-bases from
  // the source page index to the new document's index.
  const backupsToCopy = []; // {fileId, sourcePos, newIndex}
  const usedPages = new Map();
  for (const { fileId, pageIndex } of pageRefs) {
    const { src, parsed } = await getSource(fileId);
    if (pageIndex >= src.getPageCount()) continue; // defensive: malformed source
    const newIndex = combined.pageCount;
    const [copied] = await out.copyPages(src, [pageIndex]);
    out.addPage(copied);
    combined.pageCount++;
    if (!usedPages.has(fileId)) usedPages.set(fileId, new Set());
    usedPages.get(fileId).add(pageIndex);

    for (const c of parsed.comments.filter((c) => (c.page || 0) === pageIndex)) {
      combined.comments.push({ ...c, page: newIndex });
    }
    for (const e of parsed.omgLog.filter((e) => (e.page || 0) === pageIndex)) {
      combined.omgLog.push({ ...e, page: newIndex });
    }
    if (parsed.omgPages.includes(pageIndex)) combined.omgPages.push(newIndex);
    if (parsed.unmarkedBackupPages.includes(pageIndex)) {
      // Source layout: content pages, then the notes page (when present),
      // then one clean backup per entry of unmarked_backup_pages, in that
      // array's order — locate this page's backup positionally.
      const ordinal = parsed.unmarkedBackupPages.indexOf(pageIndex);
      const notesShift = parsed.notesPageIndex !== null ? 1 : 0;
      backupsToCopy.push({
        fileId,
        sourcePos: parsed.pageCount + notesShift + ordinal,
        newIndex,
      });
    }
  }

  // Backups ride at the back of the new document too.
  for (const b of backupsToCopy) {
    const { src } = await getSource(b.fileId);
    if (b.sourcePos < src.getPageCount()) {
      const [copy] = await out.copyPages(src, [b.sourcePos]);
      out.addPage(copy);
      combined.unmarkedBackupPages.push(b.newIndex);
    }
  }

  // Document-level fields combine once per involved source: tags union,
  // tag log concatenation, earliest captured_at.
  const tagSet = new Set();
  for (const { parsed } of sources.values()) {
    parsed.tags.forEach((t) => tagSet.add(t));
    combined.tagLog.push(...parsed.tagLog);
    if (!combined.capturedAt || (parsed.capturedAt && parsed.capturedAt < combined.capturedAt)) {
      combined.capturedAt = parsed.capturedAt;
    }
  }
  combined.tags = [...tagSet];
  combined.important = combined.omgPages.length > 0;
  // Markup is per-page (every marked page has a backup), so a split piece is
  // only "marked up" if one of *its* pages is — not if its source was.
  combined.hasMarkup = combined.unmarkedBackupPages.length > 0;

  return { bytes: await out.save(), parsed: combined, usedPages };
}

// Find a loaded corpus child folder by exact name (so saves reuse the real
// Box/Folder Drive folders files were loaded from instead of duplicating).
function findLoadedChild(nodes, parentId, name) {
  const parent = nodes.get(parentId);
  if (!parent?.children) return null;
  for (const cid of parent.children) {
    const c = nodes.get(cid);
    if (c?.isFolder && c.name === name) return c.id;
  }
  return null;
}

// plan: buildSavePlan(state) output — {units:[{archiveName, collection,
// box, folder, files:[{title, refs, pristineFileId}]}], skipped}.
// roots: the loaded root folders [{id, name}].
export async function saveFiling({ backend, nodes, roots, plan, onProgress }) {
  const say = (msg) => onProgress?.(msg);
  const results = { filed: 0, merged: 0, unchanged: 0, trashed: 0, kept: 0 };

  // Every content page consumed into a new document → source is superseded
  // and gets trashed. Any page still unplaced → source is kept (with a log
  // note), so nothing the user hasn't finished filing can be lost.
  const consumed = new Map(); // fileId → Set(pageIndex)
  const keptInPlace = new Set(); // fileIds saved/kept as themselves

  const collectionRoots = new Map(); // collection name → drive folder id
  const folderIds = new Map(); // "rootId/Box X[/Folder Y]" → drive id
  const counters = new Map(); // drive folder id → next number

  const getCollectionRoot = async (collection) => {
    if (collectionRoots.has(collection)) return collectionRoots.get(collection);
    const rootName = `Archive Capture — ${collection}`;
    let id = null;
    for (const r of roots) {
      const n = nodes.get(r.id);
      if (n && n.name === rootName) id = n.id;
    }
    if (!id) {
      say(`Creating collection folder “${rootName}”…`);
      id = await backend.createFolder(rootName, null);
    }
    collectionRoots.set(collection, id);
    return id;
  };

  const getDestFolder = async (rootId, box, folder) => {
    let parentId = rootId;
    let key = rootId;
    for (const [prefix, label] of [
      ['Box', box],
      ['Folder', folder],
    ]) {
      if (!label) continue;
      const name = `${prefix} ${label}`;
      key = `${key}/${name}`;
      if (!folderIds.has(key)) {
        const existing = findLoadedChild(nodes, parentId, name);
        if (existing) {
          folderIds.set(key, existing);
        } else {
          say(`Creating ${name}…`);
          folderIds.set(key, await backend.createFolder(name, parentId));
        }
      }
      parentId = folderIds.get(key);
    }
    return parentId;
  };

  const getNumber = async (folderId) => {
    if (!counters.has(folderId)) {
      const existing = await backend.listChildren(folderId);
      counters.set(folderId, nextNumber(existing.map((e) => e.name)));
    }
    const n = counters.get(folderId);
    counters.set(folderId, n + 1);
    return n;
  };

  for (const unit of plan.units) {
    const { archiveName, collection, box, folder } = unit;
    // Folders are only created once a file actually needs writing — a unit
    // whose every file turns out unchanged must not touch Drive at all.
    let destIdCached = null;
    const destFor = async () => {
      if (!destIdCached) {
        const rootId = await getCollectionRoot(collection);
        destIdCached = await getDestFolder(rootId, box, folder);
      }
      return destIdCached;
    };

    for (const entry of unit.files) {
      if (entry.pristineFileId) {
        const node = nodes.get(entry.pristineFileId);
        const p = node.parsed;
        const unchanged =
          p.box === box &&
          p.folder === folder &&
          p.collection === collection &&
          p.archiveName === archiveName &&
          (p.title || '') === (entry.title || '');
        if (unchanged) {
          results.unchanged++;
          keptInPlace.add(entry.pristineFileId);
          continue;
        }
        // Placement or title changed but the PDF itself didn't: update in
        // place (props + rename + move), no re-upload.
        const destId = await destFor();
        const parsed = { ...p, box, folder, collection, archiveName, title: entry.title };
        const name = buildFileName({
          archiveName,
          collection,
          box,
          folder,
          number: await getNumber(destId),
          omg: parsed.omgPages.length > 0,
        });
        say(`Filing ${name}…`);
        await backend.setProperties(entry.pristineFileId, serializeProps(parsed));
        await backend.rename(entry.pristineFileId, name);
        await backend.move(entry.pristineFileId, destId, node.parentId);
        keptInPlace.add(entry.pristineFileId);
        results.filed++;
        continue;
      }

      // Composed document — merged from whole files, rebuilt from exploded
      // pages, or any mix.
      say(
        `Assembling ${entry.refs.length} ${entry.refs.length === 1 ? 'part' : 'parts'} into one document…`,
      );
      const built = await buildDocumentPdf(backend, nodes, entry.refs, entry.title);
      built.parsed.box = box;
      built.parsed.folder = folder;
      built.parsed.collection = collection;
      built.parsed.archiveName = archiveName;

      const withNotes = await rebuildNotesPage(built.bytes, built.parsed);
      built.parsed.notesPageIndex = withNotes.notesPageIndex;

      const destId = await destFor();
      const name = buildFileName({
        archiveName,
        collection,
        box,
        folder,
        number: await getNumber(destId),
        omg: built.parsed.omgPages.length > 0,
      });
      say(`Uploading ${name}…`);
      await backend.createFile({
        name,
        parentId: destId,
        properties: serializeProps(built.parsed),
        bytes: withNotes.bytes,
      });
      for (const [fid, pages] of built.usedPages) {
        if (!consumed.has(fid)) consumed.set(fid, new Set());
        for (const p of pages) consumed.get(fid).add(p);
      }
      results.merged++;
      results.filed++;
    }
  }

  // Trash sources whose every content page landed in a saved document.
  for (const [fid, pages] of consumed) {
    if (keptInPlace.has(fid)) continue;
    const total = nodes.get(fid)?.parsed?.pageCount ?? 0;
    if (pages.size >= total) {
      await backend.trash(fid);
      results.trashed++;
    } else {
      results.kept++;
      say(
        `Kept “${nodes.get(fid)?.name}” — ${total - pages.size} of its ${total} page${
          total === 1 ? '' : 's'
        } aren't placed yet (its used pages are now duplicated until you file the rest).`,
      );
    }
  }

  say('Done.');
  return results;
}
