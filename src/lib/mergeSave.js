// Filing Mode's save step: turns the local card arrangement into real Drive
// structure that matches exactly what the mobile app would have produced —
// same folder nesting (Collection root / Box n / Folder m), same filename
// convention, metadata carried forward page-wise from the source files.
import { PDFDocument } from 'pdf-lib';
import { buildFileName, nextNumber } from './naming.js';
import { serializeProps } from './metadata.js';
import { rebuildNotesPage } from './notesPage.js';

// Merge several source files (in the given order) into one multi-page PDF,
// combining metadata page-wise: page indexes in omg_pages/comments shift by
// each source's offset, tags union, earliest captured_at wins. Backup pages
// (clean originals of marked pages) ride along at the back, re-indexed.
export async function mergeFiles(backend, nodes, fileIds, title) {
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
  const tagSet = new Set();
  const sources = [];

  for (const fid of fileIds) {
    const parsed = nodes.get(fid).parsed;
    const bytes = await backend.getPdfBytes(fid);
    const src = await PDFDocument.load(bytes);
    const offset = combined.pageCount;
    sources.push({ src, parsed, offset });

    const contentCount = Math.min(parsed.pageCount, src.getPageCount());
    const copied = await out.copyPages(src, [...Array(contentCount).keys()]);
    copied.forEach((p) => out.addPage(p));

    combined.pageCount += contentCount;
    parsed.omgPages.forEach((p) => combined.omgPages.push(p + offset));
    parsed.comments.forEach((c) => combined.comments.push({ ...c, page: (c.page || 0) + offset }));
    parsed.omgLog.forEach((e) => combined.omgLog.push({ ...e, page: (e.page || 0) + offset }));
    combined.tagLog.push(...parsed.tagLog);
    parsed.tags.forEach((t) => tagSet.add(t));
    combined.hasMarkup = combined.hasMarkup || parsed.hasMarkup;
    if (!combined.capturedAt || (parsed.capturedAt && parsed.capturedAt < combined.capturedAt)) {
      combined.capturedAt = parsed.capturedAt;
    }
  }

  // Backup pages sit after content (and after the notes page, when one
  // exists) in each source — locate by position, re-index into the merge.
  for (const { src, parsed, offset } of sources) {
    const notesShift = parsed.notesPageIndex !== null ? 1 : 0;
    for (let j = 0; j < parsed.unmarkedBackupPages.length; j++) {
      const pos = parsed.pageCount + notesShift + j;
      if (pos < src.getPageCount()) {
        const [copy] = await out.copyPages(src, [pos]);
        out.addPage(copy);
        combined.unmarkedBackupPages.push(parsed.unmarkedBackupPages[j] + offset);
      }
    }
  }

  combined.tags = [...tagSet];
  combined.important = combined.omgPages.length > 0;
  return { bytes: await out.save(), parsed: combined };
}

// plan: the Filing Mode workspace — top-level items of
//   {kind:'box', label, folders:[folderItem]} | folderItem | docItem | fileItem
//   folderItem = {kind:'folder', label, items:[docItem|fileItem]}
//   docItem    = {kind:'doc', title, pageFileIds:[fileId]}
//   fileItem   = {kind:'file', fileId}
// destination: { collection, archiveName, rootFolderId|null }
export async function saveFiling({ backend, nodes, plan, destination, onProgress }) {
  const { collection, archiveName } = destination;
  const say = (msg) => onProgress?.(msg);

  let rootId = destination.rootFolderId;
  if (!rootId) {
    say(`Creating collection folder “Archive Capture — ${collection}”…`);
    rootId = await backend.createFolder(`Archive Capture — ${collection}`, null);
  }

  // Walk boxes → folders → documents. Loose folders (not in a box) go
  // directly under the collection root; loose docs likewise (their filename
  // just skips the missing Box/Folder fields, per the naming convention).
  const units = []; // { boxLabel, folderLabel, docs:[doc|file items] }
  for (const item of plan) {
    if (item.kind === 'box') {
      for (const f of item.folders) {
        units.push({ boxLabel: item.label, folderLabel: f.label, docs: f.items });
      }
    } else if (item.kind === 'folder') {
      units.push({ boxLabel: '', folderLabel: item.label, docs: item.items });
    } else if (item.kind === 'doc') {
      units.push({ boxLabel: '', folderLabel: '', docs: [item] });
    }
    // loose 'file' items are left exactly where they are — not filed
  }

  const boxFolderIds = new Map(); // "Box 3" -> drive id
  const results = { filed: 0, merged: 0 };

  for (const unit of units) {
    let parentId = rootId;
    if (unit.boxLabel) {
      const boxName = `Box ${unit.boxLabel}`;
      if (!boxFolderIds.has(boxName)) {
        say(`Creating ${boxName}…`);
        boxFolderIds.set(boxName, await backend.createFolder(boxName, rootId));
      }
      parentId = boxFolderIds.get(boxName);
    }
    if (unit.folderLabel) {
      const folderName = `Folder ${unit.folderLabel}`;
      const key = `${unit.boxLabel}/${folderName}`;
      if (!boxFolderIds.has(key)) {
        say(`Creating ${folderName}…`);
        boxFolderIds.set(key, await backend.createFolder(folderName, parentId));
      }
      parentId = boxFolderIds.get(key);
    }

    // Per-Box+Folder counter starts after whatever is already there.
    const existing = await backend.listChildren(parentId);
    let number = nextNumber(existing.map((e) => e.name));

    for (const docItem of unit.docs) {
      const fileIds = docItem.kind === 'file' ? [docItem.fileId] : docItem.pageFileIds;
      const title = docItem.kind === 'doc' ? docItem.title || '' : '';

      if (fileIds.length === 1) {
        // Single file: keep the Drive file, update in place (props, name,
        // location) — no need to rebuild the PDF.
        const fid = fileIds[0];
        const node = nodes.get(fid);
        const parsed = {
          ...node.parsed,
          box: unit.boxLabel,
          folder: unit.folderLabel,
          collection,
          archiveName,
          title: title || node.parsed.title,
        };
        const name = buildFileName({
          archiveName,
          collection,
          box: unit.boxLabel,
          folder: unit.folderLabel,
          number,
          omg: parsed.omgPages.length > 0,
        });
        say(`Filing ${name}…`);
        await backend.setProperties(fid, serializeProps(parsed));
        await backend.rename(fid, name);
        await backend.move(fid, parentId, node.parentId);
        results.filed++;
      } else {
        say(`Merging ${fileIds.length} pages into one document…`);
        const merged = await mergeFiles(backend, nodes, fileIds, title);
        merged.parsed.box = unit.boxLabel;
        merged.parsed.folder = unit.folderLabel;
        merged.parsed.collection = collection;
        merged.parsed.archiveName = archiveName;

        const withNotes = await rebuildNotesPage(merged.bytes, merged.parsed);
        merged.parsed.notesPageIndex = withNotes.notesPageIndex;

        const name = buildFileName({
          archiveName,
          collection,
          box: unit.boxLabel,
          folder: unit.folderLabel,
          number,
          omg: merged.parsed.omgPages.length > 0,
        });
        say(`Uploading ${name}…`);
        await backend.createFile({
          name,
          parentId,
          properties: serializeProps(merged.parsed),
          bytes: withNotes.bytes,
        });
        for (const fid of fileIds) await backend.trash(fid);
        results.merged++;
        results.filed++;
      }
      number++;
    }
  }
  say('Done.');
  return results;
}
