import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildDocumentPdf, saveFiling, entryUnchanged } from '../mergeSave.js';
import { parseProps } from '../metadata.js';
import { buildModel } from '../filingModel.js';

// Each source page gets a distinctive width so we can assert exactly which
// pages (content, backups — and never the notes page) land in the output,
// and in what order.
//   Source A: 3 content pages (601, 602, 603pt wide), notes page (100pt),
//             one clean backup of page 1 (701pt). unmarked_backup_pages [1].
//   Source B: 2 content pages (611, 612pt), no notes page, no backups.
async function makeSource(widths) {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 792]);
  return doc.save();
}

function parsedFor(overrides) {
  return {
    box: '',
    folder: '',
    collection: '',
    archiveName: '',
    title: '',
    tags: [],
    important: false,
    hasMarkup: false,
    capturedAt: '2026-01-01T00:00:00Z',
    pageCount: 1,
    omgPages: [],
    unmarkedBackupPages: [],
    comments: [],
    tagLog: [],
    omgLog: [],
    notesPageIndex: null,
    ...overrides,
  };
}

let backend;
let nodes;

beforeAll(async () => {
  const bytesA = await makeSource([601, 602, 603, 100, 701]);
  const bytesB = await makeSource([611, 612]);
  backend = {
    bytes: { A: bytesA, B: bytesB },
    getPdfBytes(fid) {
      return Promise.resolve(this.bytes[fid]);
    },
  };
  nodes = new Map([
    [
      'A',
      {
        id: 'A',
        name: 'A.pdf',
        parsed: parsedFor({
          pageCount: 3,
          notesPageIndex: 3,
          unmarkedBackupPages: [1],
          omgPages: [1],
          comments: [
            { page: 0, text: 'first', user: 'H', ts: '' },
            { page: 2, text: 'third', user: 'J', ts: '' },
          ],
          omgLog: [{ page: 1, user: 'H', ts: '' }],
          tags: ['Letters'],
          tagLog: [{ tag: 'Letters', user: 'H', ts: '' }],
          capturedAt: '2026-01-02T00:00:00Z',
        }),
      },
    ],
    [
      'B',
      {
        id: 'B',
        name: 'B.pdf',
        parsed: parsedFor({
          pageCount: 2,
          comments: [{ page: 1, text: 'b-two', user: 'H', ts: '' }],
          tags: ['Photos'],
          capturedAt: '2026-01-01T00:00:00Z',
        }),
      },
    ],
  ]);
});

describe('buildDocumentPdf', () => {
  it('splits and reorders pages, re-basing page-indexed metadata and backups', async () => {
    // A page 2, all of B, then A page 1 (the marked+OMG one).
    const refs = [
      { fileId: 'A', pageIndex: 2 },
      { fileId: 'B', pageIndex: null },
      { fileId: 'A', pageIndex: 1 },
    ];
    const { bytes, parsed, usedPages } = await buildDocumentPdf(backend, nodes, refs, 'Rebuilt');
    const out = await PDFDocument.load(bytes);

    // 4 content pages + 1 backup; the notes page (100pt) must NOT be carried.
    expect(out.getPageCount()).toBe(5);
    const widths = Array.from({ length: 5 }, (_, i) => out.getPage(i).getWidth());
    expect(widths).toEqual([603, 611, 612, 602, 701]);

    expect(parsed.pageCount).toBe(4);
    expect(parsed.title).toBe('Rebuilt');
    // A's page-2 comment is now page 0; B's page-1 comment is now page 2.
    expect(parsed.comments).toEqual([
      { page: 0, text: 'third', user: 'J', ts: '' },
      { page: 2, text: 'b-two', user: 'H', ts: '' },
    ]);
    // A's page 1 (OMG + marked) is now page 3.
    expect(parsed.omgPages).toEqual([3]);
    expect(parsed.omgLog).toEqual([{ page: 3, user: 'H', ts: '' }]);
    expect(parsed.unmarkedBackupPages).toEqual([3]);
    expect(parsed.hasMarkup).toBe(true);
    expect(parsed.important).toBe(true);
    // Doc-level: tags union, earliest captured_at.
    expect(parsed.tags.sort()).toEqual(['Letters', 'Photos']);
    expect(parsed.capturedAt).toBe('2026-01-01T00:00:00Z');

    expect([...usedPages.get('A')].sort()).toEqual([1, 2]);
    expect([...usedPages.get('B')].sort()).toEqual([0, 1]);
  });

  it('a split piece without marked pages has no markup or backups', async () => {
    const { bytes, parsed } = await buildDocumentPdf(
      backend,
      nodes,
      [{ fileId: 'A', pageIndex: 0 }],
      '',
    );
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
    expect(parsed.hasMarkup).toBe(false);
    expect(parsed.unmarkedBackupPages).toEqual([]);
    expect(parsed.comments).toEqual([{ page: 0, text: 'first', user: 'H', ts: '' }]);
  });
});

describe('saveFiling', () => {
  function recordingBackend(bytes) {
    return {
      bytes,
      created: [],
      trashed: [],
      moved: [],
      renamed: [],
      props: [],
      folders: [],
      getPdfBytes(fid) {
        return Promise.resolve(this.bytes[fid]);
      },
      listChildren() {
        return Promise.resolve([]);
      },
      createFolder(name, parentId) {
        const id = `folder-${this.folders.length}`;
        this.folders.push({ id, name, parentId });
        return Promise.resolve(id);
      },
      createFile({ name, parentId, properties }) {
        this.created.push({ name, parentId, properties });
        return Promise.resolve(`new-${this.created.length}`);
      },
      setProperties(fid, props) {
        this.props.push({ fid, props });
        return Promise.resolve();
      },
      rename(fid, name) {
        this.renamed.push({ fid, name });
        return Promise.resolve();
      },
      move(fid, to) {
        this.moved.push({ fid, to });
        return Promise.resolve();
      },
      trash(fid) {
        this.trashed.push(fid);
        return Promise.resolve();
      },
    };
  }

  it('skips unchanged files, updates moved ones in place, uploads rebuilt ones, trashes consumed sources', async () => {
    const bytesA = await makeSource([601, 602, 603]);
    const be = recordingBackend({ A: bytesA });
    const corpus = new Map([
      [
        'A',
        {
          id: 'A',
          name: 'old.pdf',
          parentId: 'somewhere',
          parsed: parsedFor({
            pageCount: 3,
            collection: 'Good Poems',
            archiveName: 'Five Forks',
            box: '3',
            folder: '2',
          }),
        },
      ],
      [
        'U',
        {
          id: 'U',
          name: 'unchanged.pdf',
          parentId: 'somewhere',
          parsed: parsedFor({
            collection: 'Good Poems',
            archiveName: 'Five Forks',
            box: '3',
            folder: '2',
          }),
        },
      ],
    ]);

    const plan = {
      units: [
        {
          archiveName: 'Five Forks',
          collection: 'Good Poems',
          box: '3',
          folder: '2',
          files: [
            // untouched pristine file — placement identical
            {
              nodeId: 'n1',
              title: '',
              refs: [{ fileId: 'U', pageIndex: null }],
              pristineFileId: 'U',
            },
          ],
        },
        {
          archiveName: 'Five Forks',
          collection: 'Good Poems',
          box: '5',
          folder: '1',
          files: [
            // rebuilt from two of A's three pages…
            {
              nodeId: 'n2',
              title: 'Part one',
              refs: [
                { fileId: 'A', pageIndex: 0 },
                { fileId: 'A', pageIndex: 1 },
              ],
              pristineFileId: null,
            },
            // …and the third page as its own single-page document
            {
              nodeId: 'n3',
              title: '',
              refs: [{ fileId: 'A', pageIndex: 2 }],
              pristineFileId: null,
            },
          ],
        },
      ],
      skipped: { unresolved: 0, loose: 0, unnamed: 0, noCollection: 0, shells: 0 },
    };

    const res = await saveFiling({ backend: be, nodes: corpus, roots: [], plan });

    expect(res.unchanged).toBe(1);
    expect(res.merged).toBe(2);
    // A was fully consumed across the two rebuilt documents → trashed.
    expect(be.trashed).toEqual(['A']);
    // U untouched entirely.
    expect(be.renamed.find((r) => r.fid === 'U')).toBeUndefined();
    // Folder structure: collection root, Box 5, Folder 1 (Box 3/Folder 2
    // never created — its only file was unchanged).
    expect(be.folders.map((f) => f.name)).toEqual([
      'Archive Capture — Good Poems',
      'Box 5',
      'Folder 1',
    ]);
    // A titled document uses its title in place of the number (and doesn't
    // consume a counter value); the untitled one takes the next number.
    expect(be.created.map((c) => c.name)).toEqual([
      'Five Forks - Good Poems - 5 - 1 - Part one.pdf',
      'Five Forks - Good Poems - 5 - 1 - 000001.pdf',
    ]);
  });

  it('deliberate skips round-trip: save stamps skipped_levels, reload comes back flat', async () => {
    const bytesA = await makeSource([601]);
    const be = recordingBackend({ A: bytesA });
    const corpus = new Map([
      [
        'A',
        {
          id: 'A',
          name: 'loose.pdf',
          parentId: 'somewhere',
          parsed: parsedFor({ pageCount: 1 }),
        },
      ],
    ]);
    // A page filed straight onto the Collection — box and folder skipped.
    const plan = {
      units: [
        {
          archiveName: 'Five Forks',
          collection: 'Good Poems',
          box: '',
          folder: '',
          files: [
            {
              nodeId: 'n1',
              title: '',
              refs: [{ fileId: 'A', pageIndex: 0 }],
              pristineFileId: null,
            },
          ],
        },
      ],
      skipped: { unresolved: 0, loose: 0, unnamed: 0, noCollection: 0, shells: 0 },
    };
    await saveFiling({ backend: be, nodes: corpus, roots: [], plan });

    expect(be.created).toHaveLength(1);
    expect(be.created[0].properties.skipped_levels).toBe('box,folder');
    expect(be.created[0].properties.box).toBe('');

    // Reload the saved properties the way corpus loading would: the file
    // must come back as a deliberate flat placement, not a `?` bucket.
    const reloaded = new Map([
      ['root', { id: 'root', name: 'Root', isFolder: true, parentId: null, children: ['S'] }],
      [
        'S',
        {
          id: 'S',
          name: be.created[0].name,
          isFolder: false,
          parentId: 'root',
          children: [],
          parsed: parseProps(be.created[0].properties),
        },
      ],
    ]);
    const state = buildModel(reloaded, ['root']);
    const file = Object.values(state.nodes).find((n) => n.source?.fileId === 'S');
    expect(file.bucket).toBe(false);
    expect(state.nodes[file.parentId].kind).toBe('collection');
  });

  it('keeps a source alive while any of its pages are still unplaced', async () => {
    const bytesA = await makeSource([601, 602, 603]);
    const be = recordingBackend({ A: bytesA });
    const corpus = new Map([
      ['A', { id: 'A', name: 'lump.pdf', parentId: 'x', parsed: parsedFor({ pageCount: 3 }) }],
    ]);
    const plan = {
      units: [
        {
          archiveName: '',
          collection: 'C',
          box: '',
          folder: '',
          files: [
            {
              nodeId: 'n1',
              title: '',
              refs: [
                { fileId: 'A', pageIndex: 0 },
                { fileId: 'A', pageIndex: 1 },
              ],
              pristineFileId: null,
            },
          ],
        },
      ],
      skipped: { unresolved: 0, loose: 1, unnamed: 0, noCollection: 0, shells: 0 },
    };
    const res = await saveFiling({ backend: be, nodes: corpus, roots: [], plan });
    expect(be.trashed).toEqual([]);
    expect(res.kept).toBe(1);
  });
});

// ── Mid-save failure: the transactional guarantees ──────────────────────────
// A save that dies partway (expired token, quota, flaky network — all real
// occurrences in this project's history) must (a) never trash a source whose
// replacement wasn't confirmed written, and (b) report exactly what did and
// didn't complete, so the user can resume instead of starting over.
describe('saveFiling under mid-save failure', () => {
  // Wraps any backend so the Nth call to `method` throws — the
  // fault-injection double the handoff asked for.
  function withFault(backend, method, failOnCall, message = 'injected Drive failure') {
    let calls = 0;
    return Object.create(backend, {
      [method]: {
        value(...args) {
          calls++;
          if (calls === failOnCall) return Promise.reject(new Error(message));
          return backend[method](...args);
        },
      },
    });
  }

  function recordingBackend(bytes) {
    return {
      bytes,
      created: [],
      trashed: [],
      moved: [],
      renamed: [],
      props: [],
      folders: [],
      getPdfBytes(fid) {
        return Promise.resolve(this.bytes[fid]);
      },
      listChildren() {
        return Promise.resolve([]);
      },
      createFolder(name, parentId) {
        const id = `folder-${this.folders.length}`;
        this.folders.push({ id, name, parentId });
        return Promise.resolve(id);
      },
      createFile({ name, parentId, properties }) {
        this.created.push({ name, parentId, properties });
        return Promise.resolve(`new-${this.created.length}`);
      },
      setProperties(fid, props) {
        this.props.push({ fid, props });
        return Promise.resolve();
      },
      rename(fid, name) {
        this.renamed.push({ fid, name });
        return Promise.resolve();
      },
      move(fid, to) {
        this.moved.push({ fid, to });
        return Promise.resolve();
      },
      trash(fid) {
        this.trashed.push(fid);
        return Promise.resolve();
      },
    };
  }

  function twoDocPlan() {
    return {
      units: [
        {
          archiveName: '',
          collection: 'Good Poems',
          box: '1',
          folder: '1',
          files: [
            {
              nodeId: 'n1',
              title: 'Doc one',
              refs: [{ fileId: 'A', pageIndex: null }],
              pristineFileId: null,
            },
            {
              nodeId: 'n2',
              title: 'Doc two',
              refs: [{ fileId: 'B', pageIndex: null }],
              pristineFileId: null,
            },
          ],
        },
      ],
      skipped: { unresolved: 0, loose: 0, unnamed: 0, noCollection: 0, shells: 0 },
    };
  }

  async function twoSourceCorpus() {
    const bytes = { A: await makeSource([601]), B: await makeSource([611]) };
    const corpus = new Map([
      ['A', { id: 'A', name: 'a.pdf', parentId: 'p', parsed: parsedFor({ pageCount: 1 }) }],
      ['B', { id: 'B', name: 'b.pdf', parentId: 'p', parsed: parsedFor({ pageCount: 1 }) }],
    ]);
    return { bytes, corpus };
  }

  it('a failed upload stops the save, reports it, and trashes only confirmed-replaced sources', async () => {
    const { bytes, corpus } = await twoSourceCorpus();
    const be = recordingBackend(bytes);
    // Doc one's upload succeeds; Doc two's fails.
    const faulty = withFault(be, 'createFile', 2, 'token expired');

    const progress = [];
    const res = await saveFiling({
      backend: faulty,
      nodes: corpus,
      roots: [],
      plan: twoDocPlan(),
      onProgress: (m) => progress.push(m),
    });

    expect(res.failure).toMatchObject({ label: 'Doc two', completed: 1, notAttempted: 0 });
    expect(res.failure.message).toMatch(/token expired/);
    // Doc one reached Drive; its fully-consumed source is safely superseded → trashed.
    expect(be.created.map((c) => c.name)).toEqual(['Good Poems - 1 - 1 - Doc one.pdf']);
    expect(be.trashed).toEqual(['A']);
    // Doc two never got written — its source B must be untouched.
    expect(be.trashed).not.toContain('B');
    expect(progress.some((m) => m.includes('Doc two'))).toBe(true);
  });

  it('a source is never trashed when the entry consuming it failed', async () => {
    const { bytes, corpus } = await twoSourceCorpus();
    const be = recordingBackend(bytes);
    const faulty = withFault(be, 'createFile', 1, 'quota exceeded');

    const res = await saveFiling({
      backend: faulty,
      nodes: corpus,
      roots: [],
      plan: twoDocPlan(),
    });

    expect(res.failure).toMatchObject({ label: 'Doc one', completed: 0, notAttempted: 1 });
    expect(be.created).toEqual([]);
    expect(be.trashed).toEqual([]);
  });

  it('a failure filing a pristine file in place stops before the move and trashes nothing', async () => {
    const bytes = { P: await makeSource([601]) };
    const corpus = new Map([
      [
        'P',
        {
          id: 'P',
          name: 'p.pdf',
          parentId: 'old-folder',
          parsed: parsedFor({ pageCount: 1, collection: 'Good Poems', box: '9', folder: '9' }),
        },
      ],
    ]);
    const be = recordingBackend(bytes);
    const faulty = withFault(be, 'rename', 1, 'network blip');

    const plan = {
      units: [
        {
          archiveName: '',
          collection: 'Good Poems',
          box: '1',
          folder: '1',
          files: [{ nodeId: 'n1', title: '', refs: [], pristineFileId: 'P' }],
        },
      ],
      skipped: { unresolved: 0, loose: 0, unnamed: 0, noCollection: 0, shells: 0 },
    };
    const res = await saveFiling({ backend: faulty, nodes: corpus, roots: [], plan });

    expect(res.failure).toMatchObject({ label: 'p.pdf', completed: 0 });
    expect(be.moved).toEqual([]); // rename comes before move; the move never ran
    expect(be.trashed).toEqual([]);
  });

  it('a failed trash of a superseded source is reported, not fatal', async () => {
    const { bytes, corpus } = await twoSourceCorpus();
    const be = recordingBackend(bytes);
    const faulty = withFault(be, 'trash', 1, 'trash hiccup');

    const progress = [];
    const res = await saveFiling({
      backend: faulty,
      nodes: corpus,
      roots: [],
      plan: twoDocPlan(),
      onProgress: (m) => progress.push(m),
    });

    expect(res.failure).toBeNull();
    expect(res.merged).toBe(2);
    expect(res.trashed).toBe(1); // the other one still got trashed
    expect(progress.some((m) => m.includes('Couldn’t trash') || m.includes("Couldn't trash"))).toBe(
      true,
    );
  });
});

describe('saveFiling into a canonical archive destination (destRootId)', () => {
  function minimalBackend() {
    return {
      folders: [],
      moved: [],
      renamed: [],
      props: [],
      listChildren() {
        return Promise.resolve([]);
      },
      createFolder(name, parentId) {
        const id = 'folder-' + this.folders.length;
        this.folders.push({ id, name, parentId });
        return Promise.resolve(id);
      },
      setProperties(fid, props) {
        this.props.push({ fid, props });
        return Promise.resolve();
      },
      rename(fid, name) {
        this.renamed.push({ fid, name });
        return Promise.resolve();
      },
      move(fid, to) {
        this.moved.push({ fid, to });
        return Promise.resolve();
      },
      trash() {
        return Promise.resolve();
      },
    };
  }

  // Archive root 'arch' with its real (loaded) chain Good Poems/Box 3/
  // Folder 2 holding U2; M has identical tags but still sits in a staging
  // tree — the migration case.
  function archiveCorpus() {
    const nodes = new Map();
    const put = (id, name, parentId, children, parsed = null) =>
      nodes.set(id, { id, name, isFolder: parsed === null, parentId, children, parsed });
    put('arch', 'Five Forks', null, ['gp']);
    put('gp', 'Good Poems', 'arch', ['b3']);
    put('b3', 'Box 3', 'gp', ['f2']);
    put('f2', 'Folder 2', 'b3', ['U2']);
    put('stage', 'Archive Capture — Good Poems', null, ['M']);
    const tagged = () =>
      parsedFor({ collection: 'Good Poems', archiveName: 'Five Forks', box: '3', folder: '2' });
    nodes.set('U2', { id: 'U2', name: 'u2.pdf', parentId: 'f2', children: [], parsed: tagged() });
    nodes.set('M', { id: 'M', name: 'm.pdf', parentId: 'stage', children: [], parsed: tagged() });
    return nodes;
  }

  const unit = {
    archiveName: 'Five Forks',
    collection: 'Good Poems',
    box: '3',
    folder: '2',
    files: [
      { nodeId: 'n1', title: '', refs: [{ fileId: 'U2', pageIndex: null }], pristineFileId: 'U2' },
      { nodeId: 'n2', title: '', refs: [{ fileId: 'M', pageIndex: null }], pristineFileId: 'M' },
    ],
  };
  const plan = {
    units: [unit],
    skipped: { unresolved: 0, loose: 0, unnamed: 0, noCollection: 0, shells: 0 },
  };

  it('entryUnchanged requires matching location, not just matching metadata, when a destination is set', () => {
    const nodes = archiveCorpus();
    const [u2Entry, mEntry] = unit.files;
    // Without a destination, metadata alone decides (legacy behavior).
    expect(entryUnchanged({ nodes, destRootId: null, unit, entry: mEntry })).toBe(true);
    // With one, the staged file needs the move; the in-place file doesn't.
    expect(entryUnchanged({ nodes, destRootId: 'arch', unit, entry: mEntry })).toBe(false);
    expect(entryUnchanged({ nodes, destRootId: 'arch', unit, entry: u2Entry })).toBe(true);
  });

  it('migrates the staged file into the existing archive chain without creating any folders', async () => {
    const nodes = archiveCorpus();
    const be = minimalBackend();
    const res = await saveFiling({ backend: be, nodes, roots: [], plan, destRootId: 'arch' });

    expect(res.unchanged).toBe(1); // U2 untouched
    expect(res.filed).toBe(1); // M moved in place (no re-upload)
    expect(be.folders).toEqual([]); // whole chain existed — nothing created
    expect(be.moved).toEqual([{ fid: 'M', to: 'f2' }]);
  });

  it('creates missing chain folders lazily under the archive, never at the Drive root', async () => {
    const nodes = archiveCorpus();
    // Point the unit at a folder that does not exist yet.
    const unit2 = { ...unit, folder: '9', files: [unit.files[1]] };
    const plan2 = { ...plan, units: [unit2] };
    const be = minimalBackend();
    await saveFiling({ backend: be, nodes, roots: [], plan: plan2, destRootId: 'arch' });

    expect(be.folders).toEqual([{ id: 'folder-0', name: 'Folder 9', parentId: 'b3' }]);
    expect(be.moved).toEqual([{ fid: 'M', to: 'folder-0' }]);
  });
});
