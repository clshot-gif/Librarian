import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildDocumentPdf, saveFiling } from '../mergeSave.js';

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
      createFile({ name, parentId }) {
        this.created.push({ name, parentId });
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
            { nodeId: 'n1', title: '', refs: [{ fileId: 'U', pageIndex: null }], pristineFileId: 'U' },
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
            { nodeId: 'n3', title: '', refs: [{ fileId: 'A', pageIndex: 2 }], pristineFileId: null },
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
    // Filenames follow the bare-value convention with sequential numbers.
    expect(be.created.map((c) => c.name)).toEqual([
      'Five Forks - Good Poems - 5 - 1 - 000001.pdf',
      'Five Forks - Good Poems - 5 - 1 - 000002.pdf',
    ]);
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
