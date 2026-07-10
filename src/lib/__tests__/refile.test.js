import { describe, it, expect } from 'vitest';
import { refileFile, derivePlacement, undoRefile } from '../refile.js';

// A minimal fake backend that just records the Drive-side calls and answers
// listChildren from a per-folder map we control (for the counter).
function makeBackend() {
  let seq = 100;
  const calls = { createFolder: [], setProperties: [], rename: [], move: [] };
  const childrenByFolder = {};
  return {
    kind: 'demo',
    calls,
    childrenByFolder,
    async createFolder(name, parentId) {
      const id = `new${seq++}`;
      calls.createFolder.push({ name, parentId, id });
      return id;
    },
    async listChildren(folderId) {
      return childrenByFolder[folderId] || [];
    },
    async setProperties(fileId, props) {
      calls.setProperties.push({ fileId, props });
    },
    async rename(fileId, name) {
      calls.rename.push({ fileId, name });
    },
    async move(fileId, dest, old) {
      calls.move.push({ fileId, dest, old });
    },
  };
}

function mkParsed(overrides = {}) {
  return {
    box: '',
    folder: '',
    collection: '',
    archiveName: '',
    title: '',
    tags: [],
    important: false,
    hasMarkup: false,
    capturedAt: '',
    pageCount: 1,
    omgPages: [],
    unmarkedBackupPages: [],
    comments: [],
    tagLog: [],
    omgLog: [],
    notesPageIndex: null,
    skippedLevels: [],
    ...overrides,
  };
}

// A corpus with one collection root, an existing Box 3, and one file in it.
function makeCorpus() {
  const nodes = new Map();
  nodes.set('root1', {
    id: 'root1',
    name: 'Archive Capture — Good Poems',
    isFolder: true,
    parentId: null,
    rootId: 'root1',
    children: ['box3'],
    parsed: null,
  });
  nodes.set('box3', {
    id: 'box3',
    name: 'Box 3',
    isFolder: true,
    parentId: 'root1',
    rootId: 'root1',
    children: ['file1'],
    parsed: null,
  });
  nodes.set('file1', {
    id: 'file1',
    name: 'Good Poems - 3 - 000005.pdf',
    isFolder: false,
    parentId: 'box3',
    rootId: 'root1',
    children: [],
    parsed: mkParsed({ collection: 'Good Poems', box: '3' }),
  });
  const roots = [{ id: 'root1', name: 'Archive Capture — Good Poems' }];
  return { nodes, roots };
}

describe('refileFile', () => {
  it('creates the destination chain, moves, renames, and syncs the local tree', async () => {
    const { nodes, roots } = makeCorpus();
    const backend = makeBackend();
    const parsed = mkParsed({ collection: 'Good Poems', box: '5', folder: '4' });

    const name = await refileFile({ backend, nodes, roots, fileId: 'file1', parsed });

    // New Box 5 then Folder 4 created under the existing collection root.
    expect(backend.calls.createFolder.map((c) => c.name)).toEqual(['Box 5', 'Folder 4']);
    const box5 = backend.calls.createFolder[0].id;
    const folder4 = backend.calls.createFolder[1].id;
    expect(backend.calls.createFolder[0].parentId).toBe('root1');
    expect(backend.calls.createFolder[1].parentId).toBe(box5);

    // Renamed with a fresh number for the (empty) destination, and moved.
    expect(name).toBe('Good Poems - 5 - 4 - 000001.pdf');
    expect(backend.calls.rename[0]).toEqual({ fileId: 'file1', name });
    expect(backend.calls.move[0]).toMatchObject({ fileId: 'file1', dest: folder4, old: 'box3' });

    // Local tree reflects the move.
    const file = nodes.get('file1');
    expect(file.parentId).toBe(folder4);
    expect(file.name).toBe(name);
    expect(nodes.get('box3').children).not.toContain('file1');
    expect(nodes.get(folder4).children).toContain('file1');
  });

  it('uses the title in place of the number and skips counter lookup', async () => {
    const { nodes, roots } = makeCorpus();
    const backend = makeBackend();
    let listed = false;
    backend.listChildren = async () => {
      listed = true;
      return [];
    };
    const parsed = mkParsed({
      collection: 'Good Poems',
      box: '5',
      folder: '4',
      title: 'Cover letter',
    });

    const name = await refileFile({ backend, nodes, roots, fileId: 'file1', parsed });

    expect(name).toBe('Good Poems - 5 - 4 - Cover letter.pdf');
    expect(listed).toBe(false); // no number needed → no counter lookup
  });

  it('reuses an existing folder instead of duplicating it', async () => {
    const { nodes, roots } = makeCorpus();
    const backend = makeBackend();
    // Re-file into the already-loaded Box 3, new Folder 7 under it.
    const parsed = mkParsed({ collection: 'Good Poems', box: '3', folder: '7' });

    await refileFile({ backend, nodes, roots, fileId: 'file1', parsed });

    // Only Folder 7 is created; Box 3 is reused.
    expect(backend.calls.createFolder.map((c) => c.name)).toEqual(['Folder 7']);
    expect(backend.calls.createFolder[0].parentId).toBe('box3');
  });

  it('stamps skipped_levels for a blank level below a filled one', async () => {
    const { nodes, roots } = makeCorpus();
    const backend = makeBackend();
    const parsed = mkParsed({ collection: 'Good Poems', box: '3' }); // folder left blank

    await refileFile({ backend, nodes, roots, fileId: 'file1', parsed });

    expect(parsed.skippedLevels).toEqual(['folder']);
    const props = backend.calls.setProperties[0].props;
    expect(props.skipped_levels).toBe('folder');
  });

  it('leaves a collection-less file in place, updating only its properties', async () => {
    const { nodes, roots } = makeCorpus();
    const backend = makeBackend();
    const parsed = mkParsed({ collection: '', title: 'loose scan' });

    const name = await refileFile({ backend, nodes, roots, fileId: 'file1', parsed });

    expect(backend.calls.setProperties).toHaveLength(1);
    expect(backend.calls.rename).toHaveLength(0);
    expect(backend.calls.move).toHaveLength(0);
    expect(name).toBe('Good Poems - 3 - 000005.pdf'); // unchanged filename
    expect(nodes.get('file1').parentId).toBe('box3'); // stayed put
  });

  it('creates a brand-new collection root when none is loaded', async () => {
    const { nodes, roots } = makeCorpus();
    const backend = makeBackend();
    const parsed = mkParsed({ collection: 'New Coll', box: '1', folder: '1' });

    await refileFile({ backend, nodes, roots, fileId: 'file1', parsed });

    const created = backend.calls.createFolder.map((c) => c.name);
    expect(created[0]).toBe('Archive Capture — New Coll');
    // The new root is registered so the Explorer can show it.
    expect(roots.some((r) => r.name === 'Archive Capture — New Coll')).toBe(true);
  });
});

// A corpus with a canonical archive root (a chosen Archive Scans archive)
// alongside the legacy collection root from makeCorpus.
function makeArchiveCorpus() {
  const { nodes, roots } = makeCorpus();
  nodes.set('arch', {
    id: 'arch',
    name: 'Duke — FWHC Records',
    isFolder: true,
    parentId: null,
    rootId: 'arch',
    children: ['coll'],
    parsed: null,
  });
  nodes.set('coll', {
    id: 'coll',
    name: 'FWHC Records',
    isFolder: true,
    parentId: 'arch',
    rootId: 'arch',
    children: ['box4'],
    parsed: null,
  });
  nodes.set('box4', {
    id: 'box4',
    name: 'Box 4',
    isFolder: true,
    parentId: 'coll',
    rootId: 'arch',
    children: [],
    parsed: null,
  });
  roots.push({ id: 'arch', name: 'Duke — FWHC Records', archiveDest: true });
  return { nodes, roots };
}

describe('refileFile under a canonical archive root', () => {
  it('resolves a bare-named collection chain under the archive, not a new Drive-root folder', async () => {
    const { nodes, roots } = makeArchiveCorpus();
    const backend = makeBackend();
    const parsed = mkParsed({
      collection: 'FWHC Records',
      box: '4',
      folder: '2',
      archiveName: 'Sallie Bingham Center',
    });

    const name = await refileFile({
      backend,
      nodes,
      roots,
      fileId: 'file1',
      parsed,
      archiveRootId: 'arch',
    });

    // Existing FWHC Records collection folder and Box 4 reused; only
    // Folder 2 created — under Box 4, nothing at the Drive root.
    expect(backend.calls.createFolder.map((c) => c.name)).toEqual(['Folder 2']);
    expect(backend.calls.createFolder[0].parentId).toBe('box4');
    expect(name).toBe('Sallie Bingham Center - FWHC Records - 4 - 2 - 000001.pdf');
    expect(nodes.get('file1').rootId).toBe('arch');
  });

  it('files straight into a known folder when destFolderId is given (Explorer drop)', async () => {
    const { nodes, roots } = makeArchiveCorpus();
    const backend = makeBackend();
    const parsed = mkParsed({ collection: 'FWHC Records', box: '4' });

    await refileFile({
      backend,
      nodes,
      roots,
      fileId: 'file1',
      parsed,
      destFolderId: 'box4',
    });

    expect(backend.calls.createFolder).toHaveLength(0); // no chain resolution at all
    expect(backend.calls.move[0]).toMatchObject({ fileId: 'file1', dest: 'box4', old: 'box3' });
    expect(nodes.get('box4').children).toContain('file1');
    expect(nodes.get('file1').parsed.skippedLevels).toEqual(['folder']);
  });
});

describe('derivePlacement (Explorer drop-target ancestry → metadata)', () => {
  const opts = { archiveRootIds: new Set(['arch']) };

  it('derives collection/box from a canonical archive chain', () => {
    const { nodes } = makeArchiveCorpus();
    expect(derivePlacement(nodes, 'box4', opts)).toEqual({
      archiveRootId: 'arch',
      collection: 'FWHC Records',
      box: '4',
      folder: '',
    });
  });

  it('derives from a legacy Archive Capture root by name', () => {
    const { nodes } = makeArchiveCorpus();
    expect(derivePlacement(nodes, 'box3', opts)).toEqual({
      archiveRootId: null,
      collection: 'Good Poems',
      box: '3',
      folder: '',
    });
  });

  it('returns null outside any recognizable structure, on the archive root itself, and on unconventional segments', () => {
    const { nodes } = makeArchiveCorpus();
    nodes.set('unproc', {
      id: 'unproc',
      name: 'Unprocessed 2026-07-05',
      isFolder: true,
      parentId: null,
      rootId: 'unproc',
      children: [],
      parsed: null,
    });
    nodes.set('weird', {
      id: 'weird',
      name: 'Random notes',
      isFolder: true,
      parentId: 'box4',
      rootId: 'arch',
      children: [],
      parsed: null,
    });
    expect(derivePlacement(nodes, 'unproc', opts)).toBe(null);
    expect(derivePlacement(nodes, 'arch', opts)).toBe(null);
    expect(derivePlacement(nodes, 'weird', opts)).toBe(null);
  });
});

describe('undoRefile', () => {
  it('restores name, properties, location, and the local tree exactly', async () => {
    const { nodes, roots } = makeArchiveCorpus();
    const backend = makeBackend();
    const before = nodes.get('file1');
    const prev = {
      fileId: 'file1',
      prevName: before.name,
      prevParentId: before.parentId,
      prevParsed: before.parsed,
    };
    const parsed = mkParsed({ collection: 'FWHC Records', box: '4' });
    await refileFile({ backend, nodes, roots, fileId: 'file1', parsed, destFolderId: 'box4' });
    expect(nodes.get('file1').parentId).toBe('box4');

    await undoRefile({ backend, nodes, ...prev });

    const file = nodes.get('file1');
    expect(file.parentId).toBe('box3');
    expect(file.name).toBe('Good Poems - 3 - 000005.pdf');
    expect(file.parsed.collection).toBe('Good Poems');
    expect(file.rootId).toBe('root1');
    expect(nodes.get('box3').children).toContain('file1');
    expect(nodes.get('box4').children).not.toContain('file1');
    // Drive-side restore happened too (props, rename back, move back).
    const lastRename = backend.calls.rename.at(-1);
    expect(lastRename.name).toBe('Good Poems - 3 - 000005.pdf');
    expect(backend.calls.move.at(-1)).toMatchObject({ dest: 'box3', old: 'box4' });
  });
});
