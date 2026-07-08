import { describe, it, expect } from 'vitest';
import {
  buildModel,
  applyFindingAid,
  dropOperation,
  applyDrop,
  mergeSelection,
  explodeNode,
  gatherBack,
  computeCompleteness,
  buildSavePlan,
  childrenOf,
  looseNodes,
  noArchiveNode,
  suggestTargets,
  ancestry,
} from '../filingModel.js';

// Minimal corpus factory matching corpus.js's node shape.
function makeCorpus(files) {
  const nodes = new Map();
  nodes.set('root', {
    id: 'root',
    name: 'Root',
    isFolder: true,
    parentId: null,
    children: files.map((f) => f.id),
  });
  for (const f of files) {
    nodes.set(f.id, {
      id: f.id,
      name: f.name || `${f.id}.pdf`,
      isFolder: false,
      parentId: 'root',
      children: [],
      parsed: {
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
        ...f.parsed,
      },
    });
  }
  return nodes;
}

const getParsedFrom = (corpus) => (fid) => corpus.get(fid).parsed;

function find(state, pred) {
  return Object.values(state.nodes).find(pred);
}

describe('buildModel placement rules', () => {
  const corpus = makeCorpus([
    {
      id: 'filed',
      parsed: { collection: 'Good Poems', archiveName: 'Five Forks', box: '3', folder: '2' },
    },
    { id: 'boxonly', parsed: { collection: 'Good Poems', archiveName: 'Five Forks', box: '3' } },
    { id: 'collonly', parsed: { collection: 'Good Poems', archiveName: 'Five Forks' } },
    { id: 'noarch', parsed: { collection: 'Solo', box: '1', folder: '1' } },
    { id: 'rawscan', parsed: {} },
    { id: 'multipage', parsed: { pageCount: 3 } },
  ]);
  const state = buildModel(corpus, ['root']);

  it('fully filed files nest under archive/collection/box/folder', () => {
    const file = find(state, (n) => n.source?.fileId === 'filed');
    const chain = ancestry(state, file.id);
    expect(chain.map((c) => [c.kind, c.state, c.name])).toEqual([
      ['folder', 'resolved', '2'],
      ['box', 'resolved', '3'],
      ['collection', 'resolved', 'Good Poems'],
      ['archive', 'resolved', 'Five Forks'],
    ]);
  });

  it('box-without-folder lands in the Box `?` bucket', () => {
    const file = find(state, (n) => n.source?.fileId === 'boxonly');
    expect(file.bucket).toBe(true);
    expect(state.nodes[file.parentId].kind).toBe('box');
  });

  it('collection-only lands in the Collection `?` bucket', () => {
    const file = find(state, (n) => n.source?.fileId === 'collonly');
    expect(file.bucket).toBe(true);
    expect(state.nodes[file.parentId].kind).toBe('collection');
  });

  it('filed-without-archive goes under the deliberate No-archive node', () => {
    const file = find(state, (n) => n.source?.fileId === 'noarch');
    const folder = state.nodes[file.parentId];
    const box = state.nodes[folder.parentId];
    const coll = state.nodes[box.parentId];
    expect(state.nodes[coll.parentId].special).toBe('noArchive');
  });

  it('unfiled single-page scans enter as loose raw pages; multi-page as files', () => {
    const raw = find(state, (n) => n.kind === 'raw' && n.ref.fileId === 'rawscan');
    expect(raw.parentId).toBe(null);
    expect(raw.ref.pageIndex).toBe(null);
    const file = find(state, (n) => n.source?.fileId === 'multipage');
    expect(file.kind).toBe('file');
    expect(file.parentId).toBe(null);
  });
});

describe('drop rules', () => {
  const corpus = makeCorpus([
    { id: 'r1', parsed: {} },
    { id: 'r2', parsed: {} },
    {
      id: 'filed',
      parsed: { collection: 'Good Poems', archiveName: 'Five Forks', box: '3', folder: '2' },
    },
  ]);
  const state = buildModel(corpus, ['root']);
  const raw1 = find(state, (n) => n.kind === 'raw' && n.ref.fileId === 'r1');
  const raw2 = find(state, (n) => n.kind === 'raw' && n.ref.fileId === 'r2');
  const folder = find(state, (n) => n.kind === 'folder');
  const box = find(state, (n) => n.kind === 'box');
  const coll = find(state, (n) => n.kind === 'collection');
  const arch = find(state, (n) => n.kind === 'archive' && n.name === 'Five Forks');

  it('raw onto raw makes a new file; both pages inside', () => {
    expect(dropOperation(state, raw1.id, { type: 'node', id: raw2.id })).toBe('newFile');
    const clone = JSON.parse(JSON.stringify(state));
    const res = applyDrop(clone, raw1.id, { type: 'node', id: raw2.id });
    const file = clone.nodes[res.focusId];
    expect(file.kind).toBe('file');
    expect(childrenOf(clone, file.id).map((p) => p.ref.fileId)).toEqual(['r2', 'r1']);
  });

  it('bucket drops require a genuinely unresolved level between', () => {
    const filedFile = find(state, (n) => n.source?.fileId === 'filed');
    // file into Box bucket: folder unresolved → valid
    expect(dropOperation(state, filedFile.id, { type: 'bucket', parentId: box.id })).toBe(
      'nestBucket',
    );
    // file into Folder bucket: nothing between → invalid
    expect(dropOperation(state, filedFile.id, { type: 'bucket', parentId: folder.id })).toBe(null);
    // raw into Folder bucket: file level unresolved → valid
    expect(dropOperation(state, raw1.id, { type: 'bucket', parentId: folder.id })).toBe(
      'nestBucket',
    );
  });

  it('archives take collections only', () => {
    const filedFile = find(state, (n) => n.source?.fileId === 'filed');
    expect(dropOperation(state, filedFile.id, { type: 'node', id: arch.id })).toBe(null);
    expect(dropOperation(state, coll.id, { type: 'node', id: arch.id })).toBe(null); // already there
    expect(dropOperation(state, box.id, { type: 'node', id: arch.id })).toBe(null);
    expect(dropOperation(state, raw1.id, { type: 'node', id: coll.id })).toBe('nest');
  });

  it('dropping onto the current parent is a no-op, not a fake win', () => {
    const filedFile = find(state, (n) => n.source?.fileId === 'filed');
    expect(dropOperation(state, filedFile.id, { type: 'node', id: folder.id })).toBe(null);
  });
});

describe('explode / rebuild / win state', () => {
  function setup() {
    const corpus = makeCorpus([
      {
        id: 'lump',
        parsed: {
          collection: 'Good Poems',
          archiveName: 'Five Forks',
          box: '5',
          folder: '4',
          pageCount: 4,
          comments: [{ page: 2, text: 'hm', user: 'H', ts: '' }],
          omgPages: [1],
        },
      },
    ]);
    const state = buildModel(corpus, ['root']);
    return { corpus, state };
  }

  it('exploding a file spills raw pages loose with origin; folder goes incomplete', () => {
    const { corpus, state } = setup();
    const file = find(state, (n) => n.kind === 'file');
    const folder = find(state, (n) => n.kind === 'folder');
    expect(computeCompleteness(state).complete.has(folder.id)).toBe(true);

    const spilled = explodeNode(state, file.id, getParsedFrom(corpus));
    expect(spilled.length).toBe(4);
    const raws = spilled.map((id) => state.nodes[id]);
    expect(raws.every((r) => r.parentId === null && r.origin === file.id)).toBe(true);
    expect(raws[1].meta.omg).toBe(true);
    expect(raws[2].meta.commentCount).toBe(1);
    // the folder is now mid-explode: not complete, and the shell blocks
    const comp = computeCompleteness(state);
    expect(comp.complete.has(folder.id)).toBe(false);
    expect(comp.global).toBe(false);
  });

  it('gatherBack restores the original file and the folder completes again', () => {
    const { corpus, state } = setup();
    const file = find(state, (n) => n.kind === 'file');
    const folder = find(state, (n) => n.kind === 'folder');
    explodeNode(state, file.id, getParsedFrom(corpus));
    gatherBack(state, file.id);
    expect(childrenOf(state, file.id).length).toBe(4);
    expect(computeCompleteness(state).complete.has(folder.id)).toBe(true);
  });

  it('rebuilding pages into new files and re-dropping them onto the folder wins', () => {
    const { corpus, state } = setup();
    const getParsed = getParsedFrom(corpus);
    const file = find(state, (n) => n.kind === 'file');
    const folder = find(state, (n) => n.kind === 'folder');
    const spilled = explodeNode(state, file.id, getParsed);

    // Build two new files from the four pages.
    const fileA = state.nodes[mergeSelection(state, spilled.slice(0, 2), getParsed)];
    const fileB = state.nodes[mergeSelection(state, spilled.slice(2), getParsed)];
    // The spent shell is gone once every page found a new home.
    expect(state.nodes[file.id]).toBeUndefined();
    expect(computeCompleteness(state).complete.has(folder.id)).toBe(false); // files still loose

    applyDrop(state, fileA.id, { type: 'node', id: folder.id });
    let comp = computeCompleteness(state);
    expect(comp.complete.has(folder.id)).toBe(false); // fileB still loose
    applyDrop(state, fileB.id, { type: 'node', id: folder.id });
    comp = computeCompleteness(state);
    expect(comp.complete.has(folder.id)).toBe(true); // ← the payoff moment
    expect(comp.global).toBe(true);
  });

  it('exploding a box spills folders; re-dropping one onto another box re-resolves it', () => {
    const corpus = makeCorpus([
      { id: 'a', parsed: { collection: 'C', archiveName: 'A', box: '1', folder: '1' } },
      { id: 'b', parsed: { collection: 'C', archiveName: 'A', box: '2', folder: '9' } },
    ]);
    const state = buildModel(corpus, ['root']);
    const box1 = find(state, (n) => n.kind === 'box' && n.name === '1');
    const box2 = find(state, (n) => n.kind === 'box' && n.name === '2');
    const spilled = explodeNode(state, box2.id, getParsedFrom(corpus));
    expect(spilled.length).toBe(1);
    const folder9 = state.nodes[spilled[0]];
    expect(folder9.origin).toBe(box2.id);
    applyDrop(state, folder9.id, { type: 'node', id: box1.id });
    expect(folder9.parentId).toBe(box1.id);
    expect(folder9.origin).toBe(null);
    const chain = ancestry(state, folder9.id);
    expect(chain[0]).toMatchObject({ kind: 'box', name: '1', state: 'resolved' });
  });
});

describe('finding aid pre-population and suggestions', () => {
  it('creates expected slots, claimed on first real drop', () => {
    const corpus = makeCorpus([{ id: 'r1', parsed: { folder: 'Correspondence' } }]);
    const state = buildModel(corpus, ['root']);
    applyFindingAid(state, {
      archiveName: 'Sallie Bingham Center',
      collectionTitle: 'FWHC Records',
      boxes: [{ name: '1', folders: ['Correspondence', 'Clippings'] }],
    });
    const slot = find(state, (n) => n.kind === 'folder' && n.name === 'Correspondence');
    expect(slot.expected).toBe(true);

    // A scan already tagged `folder: Correspondence` isn't "completely
    // unfiled", so it enters as a loose file — and the matching slot
    // suggests itself as its drop target.
    const file = find(state, (n) => n.kind === 'file');
    expect(file.parentId).toBe(null);
    expect(suggestTargets(state, file.id).has(slot.id)).toBe(true);

    applyDrop(state, file.id, { type: 'node', id: slot.id });
    expect(slot.expected).toBe(false);
  });

  it('degrades gracefully when the inventory is empty (the real seed today)', () => {
    const corpus = makeCorpus([]);
    const state = buildModel(corpus, ['root']);
    applyFindingAid(state, {
      archiveName: 'Sallie Bingham Center',
      collectionTitle: 'FWHC Records',
      boxes: [],
    });
    expect(find(state, (n) => n.kind === 'collection' && n.expected)).toBeTruthy();
    expect(find(state, (n) => n.kind === 'box')).toBeUndefined();
    // Empty expected slots never block the win state.
    expect(computeCompleteness(state).blockers.loose).toBe(0);
  });
});

describe('save plan', () => {
  it('writes determinate placements, leaves buckets and loose items alone', () => {
    const corpus = makeCorpus([
      {
        id: 'filed',
        parsed: { collection: 'Good Poems', archiveName: 'Five Forks', box: '3', folder: '2' },
      },
      { id: 'boxonly', parsed: { collection: 'Good Poems', archiveName: 'Five Forks', box: '3' } },
      { id: 'loose', parsed: {} },
    ]);
    const state = buildModel(corpus, ['root']);
    const plan = buildSavePlan(state);
    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]).toMatchObject({
      archiveName: 'Five Forks',
      collection: 'Good Poems',
      box: '3',
      folder: '2',
    });
    expect(plan.units[0].files[0].pristineFileId).toBe('filed');
    expect(plan.skipped.unresolved).toBe(1);
    expect(plan.skipped.loose).toBe(1);
  });

  it('deliberate skips save with the skipped fields empty', () => {
    const corpus = makeCorpus([
      {
        id: 'f',
        parsed: { collection: 'Good Poems', archiveName: 'Five Forks', box: '3', folder: '2' },
      },
    ]);
    const state = buildModel(corpus, ['root']);
    const file = find(state, (n) => n.kind === 'file');
    const coll = find(state, (n) => n.kind === 'collection');
    applyDrop(state, file.id, { type: 'node', id: coll.id }); // skip box+folder
    const plan = buildSavePlan(state);
    expect(plan.units[0]).toMatchObject({ collection: 'Good Poems', box: '', folder: '' });
  });

  it('unnamed containers hold their files back from the save', () => {
    const corpus = makeCorpus([{ id: 'r1', parsed: {} }]);
    const state = buildModel(corpus, ['root']);
    const raw = find(state, (n) => n.kind === 'raw');
    applyDrop(state, raw.id, { type: 'new', kind: 'folder' });
    // folder is unnamed and loose → nothing savable, counted as loose
    const plan = buildSavePlan(state);
    expect(plan.units).toHaveLength(0);
    expect(plan.skipped.loose).toBe(1);
  });

  it('collections under No archive save with an empty archive name', () => {
    const corpus = makeCorpus([{ id: 'f', parsed: { collection: 'Solo', box: '1', folder: '1' } }]);
    const state = buildModel(corpus, ['root']);
    expect(noArchiveNode(state)).toBeTruthy();
    const plan = buildSavePlan(state);
    expect(plan.units[0]).toMatchObject({ archiveName: '', collection: 'Solo' });
  });

  it('rebuilt files carry page refs, not whole-file refs', () => {
    const corpus = makeCorpus([
      {
        id: 'lump',
        parsed: {
          collection: 'C',
          archiveName: 'A',
          box: '5',
          folder: '4',
          pageCount: 3,
        },
      },
    ]);
    const state = buildModel(corpus, ['root']);
    const getParsed = getParsedFrom(corpus);
    const file = find(state, (n) => n.kind === 'file');
    const folder = find(state, (n) => n.kind === 'folder');
    const spilled = explodeNode(state, file.id, getParsed);
    const fileA = mergeSelection(state, spilled.slice(0, 2), getParsed);
    applyDrop(state, fileA, { type: 'node', id: folder.id });
    applyDrop(state, spilled[2], { type: 'node', id: folder.id }); // single page, file level skipped
    const plan = buildSavePlan(state);
    const unit = plan.units[0];
    expect(unit.files).toHaveLength(2);
    expect(unit.files[0].refs).toEqual([
      { fileId: 'lump', pageIndex: 0 },
      { fileId: 'lump', pageIndex: 1 },
    ]);
    expect(unit.files[1].refs).toEqual([{ fileId: 'lump', pageIndex: 2 }]);
    expect(looseNodes(state)).toHaveLength(0);
  });
});
