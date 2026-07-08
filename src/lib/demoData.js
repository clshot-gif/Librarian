// The Sample-mode corpus: one filed Shape-1 collection tree (mobile-app
// style) and one unfiled Shape-2 "Unprocessed" tree (batch-uploader style),
// matching the real structures documented in
// archive-capture-context-for-phase2.md. PDF bytes are built lazily on
// first open (demoPdf.js) and cached.
import { serializeProps } from './metadata.js';
import { buildFileName } from './naming.js';
import { buildNotesContent } from './notesPage.js';

let idCounter = 0;
const nid = () => `demo-${++idCounter}`;

function folder(name, parentId) {
  return { id: nid(), name, isFolder: true, parentId, properties: {} };
}

// A filed (Shape 1) file: full convention filename + rich properties.
function filedFile({
  parentId,
  number,
  box,
  folderNum,
  pages,
  tags,
  comments,
  omgPages,
  marked,
  seed,
  title,
  headings,
}) {
  const collection = 'Good Poems';
  const archiveName = 'Five Forks';
  const omg = (omgPages || []).length > 0;
  const parsed = {
    box: box === '' ? '' : String(box),
    folder: folderNum === '' ? '' : String(folderNum),
    collection,
    archiveName,
    title: title || '',
    tags: tags || [],
    important: omg,
    hasMarkup: Boolean(marked && marked.length),
    capturedAt: `2026-06-14T${String(14 + (number % 5)).padStart(2, '0')}:${String((number * 7) % 60).padStart(2, '0')}:00.000Z`,
    pageCount: pages,
    omgPages: omgPages || [],
    unmarkedBackupPages: marked || [],
    comments: comments || [],
    tagLog: (tags || []).map((t) => ({ tag: t, user: 'Hannah', ts: '2026-06-14T15:00:00.000Z' })),
    omgLog: (omgPages || []).map((p) => ({
      page: p,
      user: 'Hannah',
      ts: '2026-06-14T15:00:00.000Z',
    })),
    notesPageIndex: pages, // notes page sits right after the content pages
  };
  const name = buildFileName({ archiveName, collection, box, folder: folderNum, number, omg });
  return {
    id: nid(),
    name,
    isFolder: false,
    parentId,
    properties: serializeProps(parsed),
    demoSpec: {
      seed,
      pages: Array.from({ length: pages }, (_, i) => ({
        heading: headings
          ? headings[i]
          : i === 0
            ? `County correspondence, no. ${number}`
            : undefined,
        footer: `${collection} — Box ${box}, Folder ${folderNum} — p.${i + 1}`,
      })),
      markedPages: marked || [],
      notesContent: buildNotesContent(parsed),
    },
  };
}

// An unfiled (Shape 2) file: original filename, blank filing metadata.
function unfiledFile({ parentId, name, capturedAt, seed, heading }) {
  const parsed = {
    box: '',
    folder: '',
    collection: '',
    archiveName: '',
    title: '',
    tags: [],
    important: false,
    hasMarkup: false,
    capturedAt,
    pageCount: 1,
    omgPages: [],
    unmarkedBackupPages: [],
    comments: [],
    tagLog: [],
    omgLog: [],
    notesPageIndex: null,
  };
  return {
    id: nid(),
    name,
    isFolder: false,
    parentId,
    properties: serializeProps(parsed),
    demoSpec: {
      seed,
      pages: [{ heading, footer: name }],
      markedPages: [],
      skipNotesPage: true, // batch-uploader files have no notes page yet
    },
  };
}

export function buildDemoCorpus() {
  const nodes = [];

  // ── Shape 1: Archive Capture — Good Poems ─────────────────────────────
  const root1 = folder('Archive Capture — Good Poems', null);
  const box3 = folder('Box 3', root1.id);
  const b3f2 = folder('Folder 2', box3.id);
  const b3f3 = folder('Folder 3', box3.id);
  const box5 = folder('Box 5', root1.id);
  const b5f1 = folder('Folder 1', box5.id);
  nodes.push(root1, box3, b3f2, b3f3, box5, b5f1);

  nodes.push(
    filedFile({
      parentId: b3f2.id,
      number: 1,
      box: 3,
      folderNum: 2,
      pages: 1,
      seed: 11,
      tags: ['Letters'],
    }),
    filedFile({
      parentId: b3f2.id,
      number: 2,
      box: 3,
      folderNum: 2,
      pages: 2,
      seed: 12,
      tags: ['Letters', 'Correspondence'],
      comments: [
        {
          page: 0,
          text: 'Water damage on left edge',
          user: 'Hannah',
          ts: '2026-06-14T15:22:00.000Z',
        },
      ],
    }),
    filedFile({ parentId: b3f2.id, number: 3, box: 3, folderNum: 2, pages: 1, seed: 13 }),
    filedFile({
      parentId: b3f2.id,
      number: 4,
      box: 3,
      folderNum: 2,
      pages: 3,
      seed: 14,
      title: 'Letter re: county hearing',
      tags: ['Letters', 'Legal proceedings', '1940s', 'Union leadership'],
      comments: [
        {
          page: 0,
          text: 'This contradicts the earlier letter about the hearing date',
          user: 'Hannah',
          ts: '2026-06-14T15:40:00.000Z',
        },
        {
          page: 2,
          text: 'Signature matches the Box 5 affidavit',
          user: 'Justina',
          ts: '2026-06-20T11:05:00.000Z',
        },
      ],
      omgPages: [0],
      marked: [0],
    }),
    filedFile({
      parentId: b3f2.id,
      number: 5,
      box: 3,
      folderNum: 2,
      pages: 1,
      seed: 15,
      tags: ['Meeting minutes'],
    }),
    filedFile({
      parentId: b3f2.id,
      number: 6,
      box: 3,
      folderNum: 2,
      pages: 1,
      seed: 16,
      tags: ['Press coverage'],
      comments: [
        {
          page: 0,
          text: 'Follow up: names the same organizer',
          user: 'Hannah',
          ts: '2026-06-14T16:02:00.000Z',
        },
      ],
      marked: [0],
    }),
    filedFile({ parentId: b3f3.id, number: 1, box: 3, folderNum: 3, pages: 1, seed: 21 }),
    filedFile({
      parentId: b3f3.id,
      number: 2,
      box: 3,
      folderNum: 3,
      pages: 1,
      seed: 22,
      tags: ['Personal papers'],
    }),
    filedFile({
      parentId: b3f3.id,
      number: 3,
      box: 3,
      folderNum: 3,
      pages: 2,
      seed: 23,
      tags: ['Photographs', '1940s'],
      omgPages: [1],
      comments: [
        {
          page: 1,
          text: 'Is this the same picket line as the Tribune photo?',
          user: 'Hannah',
          ts: '2026-06-15T10:12:00.000Z',
        },
      ],
    }),
    filedFile({ parentId: b3f3.id, number: 4, box: 3, folderNum: 3, pages: 1, seed: 24 }),
    filedFile({
      parentId: b5f1.id,
      number: 1,
      box: 5,
      folderNum: 1,
      pages: 1,
      seed: 31,
      tags: ['Legal proceedings'],
    }),
    filedFile({ parentId: b5f1.id, number: 2, box: 5, folderNum: 1, pages: 1, seed: 32 }),
    filedFile({ parentId: b5f1.id, number: 3, box: 5, folderNum: 1, pages: 1, seed: 33 }),
  );

  // ── The lumped scan: one big multi-page PDF photographed in a hurry —
  //    a whole folder's worth of loose photos captured as a single File.
  //    This is the explode-to-raw → rebuild → re-file demo case, with
  //    comments/OMG/markup spread across pages so the split has real
  //    page-indexed metadata to carry correctly. ──────────────────────────
  const b5f4 = folder('Folder 4', box5.id);
  nodes.push(b5f4);
  nodes.push(
    filedFile({
      parentId: b5f4.id,
      number: 1,
      box: 5,
      folderNum: 4,
      pages: 6,
      seed: 61,
      title: 'Photo stack (unseparated)',
      tags: ['Photographs'],
      headings: [
        'Photo: picket line, north gate',
        'Photo: picket line, reverse',
        'Photo: office interior',
        'Photo: office interior, annotated',
        'Photo: group portrait',
        'Photo: group portrait, names on back',
      ],
      comments: [
        {
          page: 1,
          text: 'Same crowd as the Tribune clipping?',
          user: 'Hannah',
          ts: '2026-06-16T09:40:00.000Z',
        },
        {
          page: 4,
          text: 'Names listed on the verso — transcribe',
          user: 'Justina',
          ts: '2026-06-21T13:05:00.000Z',
        },
      ],
      omgPages: [3],
      marked: [2],
    }),
  );

  // ── Partially-filed files: metadata half-entered on a fast archive day —
  //    these land in `?` buckets, the "known where it belongs, not yet
  //    placed" state. ─────────────────────────────────────────────────────
  nodes.push(
    filedFile({
      parentId: box3.id,
      number: 7,
      box: 3,
      folderNum: '',
      pages: 1,
      seed: 71,
      tags: ['Letters'],
    }),
    filedFile({
      parentId: root1.id,
      number: 8,
      box: '',
      folderNum: '',
      pages: 1,
      seed: 72,
      tags: ['Receipts'],
    }),
  );

  // ── Shape 2: Unprocessed batch-upload tree ────────────────────────────
  const root2 = folder('Unprocessed 2026-07-05T18:22:10.771Z', null);
  const eliza = folder('Eliza Poster', root2.id);
  const originals = folder('Originals', eliza.id);
  const ready = folder('Ready', eliza.id);
  const session1 = folder('Session 1 (2026-07-05 14:32)', root2.id);
  nodes.push(root2, eliza, originals, ready, session1);

  nodes.push(
    unfiledFile({
      parentId: originals.id,
      name: 'Book.pdf',
      capturedAt: '2026-07-03T19:04:00.000Z',
      seed: 41,
      heading: 'Ledger excerpt',
    }),
    unfiledFile({
      parentId: originals.id,
      name: 'Dad.pdf',
      capturedAt: '2026-07-03T19:09:00.000Z',
      seed: 42,
      heading: 'Handwritten note',
    }),
    unfiledFile({
      parentId: originals.id,
      name: 'Book (2)_edited.pdf',
      capturedAt: '2026-07-03T19:15:00.000Z',
      seed: 43,
      heading: 'Ledger excerpt, verso',
    }),
    unfiledFile({
      parentId: ready.id,
      name: 'Book.pdf',
      capturedAt: '2026-07-03T20:30:00.000Z',
      seed: 44,
      heading: 'Ledger excerpt (retouched)',
    }),
    unfiledFile({
      parentId: ready.id,
      name: 'Dad.pdf',
      capturedAt: '2026-07-03T20:36:00.000Z',
      seed: 45,
      heading: 'Handwritten note (retouched)',
    }),
    unfiledFile({
      parentId: session1.id,
      name: 'IMG_4213.pdf',
      capturedAt: '2026-07-05T14:32:11.000Z',
      seed: 51,
      heading: 'Petition, page one',
    }),
    unfiledFile({
      parentId: session1.id,
      name: 'IMG_4214.pdf',
      capturedAt: '2026-07-05T14:33:02.000Z',
      seed: 52,
      heading: 'Petition, page two',
    }),
    unfiledFile({
      parentId: session1.id,
      name: 'IMG_4215.pdf',
      capturedAt: '2026-07-05T14:35:47.000Z',
      seed: 53,
      heading: 'Envelope, postmarked 1946',
    }),
    unfiledFile({
      parentId: session1.id,
      name: 'IMG_4216.pdf',
      capturedAt: '2026-07-05T14:41:20.000Z',
      seed: 54,
      heading: 'Telegram fragment',
    }),
    unfiledFile({
      parentId: session1.id,
      name: 'IMG_4217.pdf',
      capturedAt: '2026-07-05T14:44:05.000Z',
      seed: 55,
      heading: 'Telegram fragment, verso',
    }),
  );

  return { nodes, rootIds: [root1.id, root2.id] };
}
