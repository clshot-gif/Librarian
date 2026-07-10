import { describe, it, expect } from 'vitest';
import {
  buildModel,
  applyFindingAid,
  dropOperation,
  applyDrop,
  mergeSelection,
  explodeNode,
  explodeToLevel,
  separatePage,
  gatherBack,
  computeCompleteness,
  buildSavePlan,
  childrenOf,
  looseNodes,
  noArchiveNode,
  suggestTargets,
  suggestedPlacements,
  applySuggestedPlacements,
  ancestry,
  LEVEL,
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
    {
      id: 'flatcoll',
      parsed: {
        collection: 'Good Poems',
        archiveName: 'Five Forks',
        skippedLevels: ['box', 'folder'],
      },
    },
    {
      id: 'flatbox',
      parsed: {
        collection: 'Good Poems',
        archiveName: 'Five Forks',
        box: '3',
        skippedLevels: ['folder'],
      },
    },
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

  it('skipped_levels marker reloads as deliberate flat placement, not a bucket', () => {
    // Same blank box/folder as collonly/boxonly, but stamped by a previous
    // Filing Mode save — must come back flat (skipped), not as `?` debts.
    const flatColl = find(state, (n) => n.source?.fileId === 'flatcoll');
    expect(flatColl.bucket).toBe(false);
    expect(state.nodes[flatColl.parentId].kind).toBe('collection');
    expect(ancestry(state, flatColl.id).map((c) => c.state)).toEqual([
      'skipped',
      'skipped',
      'resolved',
      'resolved',
    ]);
    const flatBox = find(state, (n) => n.source?.fileId === 'flatbox');
    expect(flatBox.bucket).toBe(false);
    expect(state.nodes[flatBox.parentId].kind).toBe('box');
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

  it('folder exploded first, then the loose file: rebuilt files still owe the folder', () => {
    // The demo walkthrough order: 💥 the folder (file spills loose), 💥 the
    // loose file (pages spill), rebuild, drag back. The shell has no parent
    // at rebuild time, so the debt must come from the shell's own origin.
    const { corpus, state } = setup();
    const getParsed = getParsedFrom(corpus);
    const file = find(state, (n) => n.kind === 'file');
    const folder = find(state, (n) => n.kind === 'folder');

    explodeNode(state, folder.id, getParsed);
    expect(state.nodes[file.id].parentId).toBe(null);
    expect(state.nodes[file.id].origin).toBe(folder.id);
    const spilled = explodeNode(state, file.id, getParsed);

    const fileA = state.nodes[mergeSelection(state, spilled.slice(0, 2), getParsed)];
    const fileB = state.nodes[mergeSelection(state, spilled.slice(2), getParsed)];
    expect(fileA.origin).toBe(folder.id);
    expect(fileB.origin).toBe(folder.id);
    expect(state.nodes[file.id]).toBeUndefined(); // spent shell gone

    applyDrop(state, fileA.id, { type: 'node', id: folder.id });
    expect(computeCompleteness(state).complete.has(folder.id)).toBe(false); // fileB still loose
    applyDrop(state, fileB.id, { type: 'node', id: folder.id });
    const comp = computeCompleteness(state);
    expect(comp.complete.has(folder.id)).toBe(true); // win on the LAST drop
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

describe('single-page promotion and page separation', () => {
  it('a raw page dropped on the File column new-file slot becomes a single-page file', () => {
    const corpus = makeCorpus([{ id: 'r1', parsed: {} }]);
    const state = buildModel(corpus, ['root']);
    const raw = find(state, (n) => n.kind === 'raw');
    expect(dropOperation(state, raw.id, { type: 'new', kind: 'file' })).toBe('newSingleFile');
    const res = applyDrop(state, raw.id, { type: 'new', kind: 'file' });
    const file = state.nodes[res.focusId];
    expect(file.kind).toBe('file');
    expect(file.materialized).toBe(true);
    expect(file.source).toBeUndefined();
    const pages = childrenOf(state, file.id);
    expect(pages.map((p) => p.id)).toEqual([raw.id]);
    expect(pages[0].parentId).toBe(file.id);
  });

  it('only pages may use the new-file slot — a file cannot', () => {
    const corpus = makeCorpus([{ id: 'm', parsed: { pageCount: 2 } }]);
    const state = buildModel(corpus, ['root']);
    const file = find(state, (n) => n.kind === 'file');
    expect(dropOperation(state, file.id, { type: 'new', kind: 'file' })).toBe(null);
  });

  it('a promoted single-page file files into a folder and saves as one page', () => {
    const corpus = makeCorpus([
      { id: 'r1', parsed: {} },
      {
        id: 'filed',
        parsed: { collection: 'C', archiveName: 'A', box: '1', folder: '1' },
      },
    ]);
    const state = buildModel(corpus, ['root']);
    const raw = find(state, (n) => n.kind === 'raw');
    const folder = find(state, (n) => n.kind === 'folder');
    const res = applyDrop(state, raw.id, { type: 'new', kind: 'file' });
    applyDrop(state, res.focusId, { type: 'node', id: folder.id });
    const plan = buildSavePlan(state);
    const entry = plan.units
      .flatMap((u) => u.files)
      .find((f) => f.refs.some((r) => r.fileId === 'r1'));
    expect(entry.refs).toEqual([{ fileId: 'r1', pageIndex: null }]);
  });

  it('separatePage pops one page out of a pristine file, loose in Unclassified', () => {
    const corpus = makeCorpus([
      {
        id: 'lump',
        parsed: { collection: 'C', archiveName: 'A', box: '5', folder: '4', pageCount: 3 },
      },
    ]);
    const state = buildModel(corpus, ['root']);
    const getParsed = getParsedFrom(corpus);
    const file = find(state, (n) => n.kind === 'file');
    const sepId = separatePage(state, file.id, 1, getParsed);
    const sep = state.nodes[sepId];
    expect(sep.kind).toBe('raw');
    expect(sep.parentId).toBe(null);
    expect(sep.origin).toBe(null);
    expect(sep.ref).toEqual({ fileId: 'lump', pageIndex: 1 });
    // The source file is now rebuilt from its two remaining pages.
    expect(state.nodes[file.id].source).toBeUndefined();
    expect(childrenOf(state, file.id)).toHaveLength(2);
    expect(looseNodes(state).some((n) => n.id === sepId)).toBe(true);
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

describe('destination-archive mode: physical location decides placement', () => {
  // A corpus with real folder chains and rootIds: the canonical archive
  // (a chosen Archive Scans folder, root 'arch') holding one correctly-filed
  // file, plus a capture-time staging tree with tagged files that need
  // migrating in.
  function makeTreeCorpus(files) {
    const nodes = new Map();
    const put = (n) => nodes.set(n.id, { children: [], parsed: null, ...n });
    put({ id: 'arch', name: 'Five Forks', isFolder: true, parentId: null, rootId: 'arch' });
    put({ id: 'coll', name: 'Good Poems', isFolder: true, parentId: 'arch', rootId: 'arch' });
    put({ id: 'box3', name: 'Box 3', isFolder: true, parentId: 'coll', rootId: 'arch' });
    put({ id: 'f2', name: 'Folder 2', isFolder: true, parentId: 'box3', rootId: 'arch' });
    put({
      id: 'stage',
      name: 'Archive Capture — Good Poems',
      isFolder: true,
      parentId: null,
      rootId: 'stage',
    });
    for (const f of files) {
      put({
        id: f.id,
        name: `${f.id}.pdf`,
        isFolder: false,
        parentId: f.parentId,
        rootId: f.parentId === 'stage' ? 'stage' : 'arch',
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
          pageCount: 2,
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
    for (const n of nodes.values()) {
      if (n.parentId != null) nodes.get(n.parentId).children.push(n.id);
    }
    return nodes;
  }

  const tags = { collection: 'Good Poems', archiveName: 'Five Forks', box: '3', folder: '2' };
  const corpus = makeTreeCorpus([
    { id: 'inplace', parentId: 'f2', parsed: tags },
    { id: 'staged', parentId: 'stage', parsed: tags },
    { id: 'oddbox', parentId: 'stage', parsed: { ...tags, box: '9', folder: '' } },
    { id: 'unknowncoll', parentId: 'stage', parsed: { ...tags, collection: 'Mystery Papers' } },
  ]);
  const opts = { archiveRootIds: new Set(['arch']) };

  it('a file physically where its tags say (inside the archive) loads placed', () => {
    const state = buildModel(corpus, ['arch', 'stage'], opts);
    const file = find(state, (n) => n.source?.fileId === 'inplace');
    expect(file.parentId).not.toBe(null);
    expect(ancestry(state, file.id).map((c) => c.state)).toEqual([
      'resolved',
      'resolved',
      'resolved',
      'resolved',
    ]);
  });

  it('tagged files elsewhere load loose — tags become suggestions, not silent container creation', () => {
    const state = buildModel(corpus, ['arch', 'stage'], opts);
    for (const id of ['staged', 'oddbox', 'unknowncoll']) {
      expect(find(state, (n) => n.source?.fileId === id).parentId).toBe(null);
    }
    // No 'Box 9' or 'Mystery Papers' container was invented from tags.
    expect(find(state, (n) => n.kind === 'box' && n.name === '9')).toBeUndefined();
    expect(find(state, (n) => n.kind === 'collection' && n.name === 'Mystery Papers')).toBe(
      undefined,
    );
  });

  it('without a destination (no opts) the legacy tags-place-everything behavior is unchanged', () => {
    const state = buildModel(corpus, ['arch', 'stage']);
    const staged = find(state, (n) => n.source?.fileId === 'staged');
    expect(staged.parentId).not.toBe(null);
  });

  it('suggests clean full matches for resolve, partial matches for the ? bucket, nothing for unknown collections', () => {
    const state = buildModel(corpus, ['arch', 'stage'], opts);
    const byFile = (id) =>
      suggestedPlacements(state).find((s) => state.nodes[s.id].source?.fileId === id);
    const staged = byFile('staged');
    expect(staged.resolve).toBe(true);
    expect(state.nodes[staged.targetId].kind).toBe('folder'); // Folder 2 under Box 3

    const oddbox = byFile('oddbox'); // box 9 matches nothing known
    expect(oddbox.resolve).toBe(false);
    expect(state.nodes[oddbox.targetId].kind).toBe('collection');

    expect(byFile('unknowncoll')).toBeUndefined(); // stays loose, untouched
  });

  it('applySuggestedPlacements lands everything in one action, ambiguity into buckets', () => {
    const state = buildModel(corpus, ['arch', 'stage'], opts);
    const res = applySuggestedPlacements(state);
    expect(res).toEqual({ resolved: 1, bucketed: 1 });
    const staged = find(state, (n) => n.source?.fileId === 'staged');
    expect(state.nodes[staged.parentId].kind).toBe('folder');
    expect(staged.bucket).toBe(false);
    const oddbox = find(state, (n) => n.source?.fileId === 'oddbox');
    expect(oddbox.bucket).toBe(true);
    expect(state.nodes[oddbox.parentId].kind).toBe('collection');
    const unknown = find(state, (n) => n.source?.fileId === 'unknowncoll');
    expect(unknown.parentId).toBe(null); // untouched
  });

  it('suggestions also match finding-aid expected slots, and accepting claims them', () => {
    const emptyArchCorpus = makeTreeCorpus([{ id: 'staged2', parentId: 'stage', parsed: tags }]);
    const state = buildModel(emptyArchCorpus, ['arch', 'stage'], opts);
    applyFindingAid(state, {
      archiveName: 'Five Forks',
      collectionTitle: 'Good Poems',
      boxes: [{ name: '3', folders: ['2'] }],
    });
    const [pl] = suggestedPlacements(state);
    expect(pl.resolve).toBe(true);
    const slot = state.nodes[pl.targetId];
    expect(slot.kind).toBe('folder');
    expect(slot.expected).toBe(true);
    applySuggestedPlacements(state);
    expect(slot.expected).toBe(false); // claimed by the drop, same as a manual drag
  });
});

describe('drag-down explode (column drops)', () => {
  function boxSetup() {
    const corpus = makeCorpus([
      {
        id: 'lump',
        parsed: { collection: 'C', archiveName: 'A', box: '5', folder: '4', pageCount: 4 },
      },
    ]);
    const state = buildModel(corpus, ['root']);
    return { state, getParsed: getParsedFrom(corpus) };
  }

  it('a multi-page file dropped on the Raw column tears down to single pages', () => {
    const { state, getParsed } = boxSetup();
    const file = find(state, (n) => n.kind === 'file');
    expect(dropOperation(state, file.id, { type: 'column', kind: 'raw' })).toBe('explodeTo');
    const res = applyDrop(state, file.id, { type: 'column', kind: 'raw' }, getParsed);
    expect(res.op).toBe('explodeTo');
    expect(res.spilled).toHaveLength(4);
    expect(res.spilled.every((id) => state.nodes[id].kind === 'raw')).toBe(true);
    expect(res.spilled.every((id) => state.nodes[id].parentId === null)).toBe(true);
  });

  it('a box dropped on the Raw column decomposes recursively through folders and files', () => {
    const { state, getParsed } = boxSetup();
    const box = find(state, (n) => n.kind === 'box');
    const landed = explodeToLevel(state, box.id, 'raw', getParsed);
    expect(landed).toHaveLength(4);
    expect(landed.every((id) => state.nodes[id].kind === 'raw')).toBe(true);
    // Intermediate pieces are ordinary spilled husks — gatherable stepwise.
    const folder = find(state, (n) => n.kind === 'folder');
    expect(folder.parentId).toBe(null);
    expect(folder.origin).toBe(box.id);
  });

  it('a box dropped on the File column stops at files (they stay pristine)', () => {
    const { state, getParsed } = boxSetup();
    const box = find(state, (n) => n.kind === 'box');
    const landed = explodeToLevel(state, box.id, 'file', getParsed);
    expect(landed).toHaveLength(1);
    const file = state.nodes[landed[0]];
    expect(file.kind).toBe('file');
    expect(file.source).toBeTruthy(); // not materialized — still one Drive PDF
  });

  it('upward or non-composite column drops are invalid', () => {
    const { state } = boxSetup();
    const folder = find(state, (n) => n.kind === 'folder');
    const raw = find(state, (n) => n.kind === 'raw');
    expect(dropOperation(state, folder.id, { type: 'column', kind: 'box' })).toBe(null);
    expect(raw ? dropOperation(state, raw.id, { type: 'column', kind: 'raw' }) : null).toBe(null);
    expect(LEVEL.raw).toBe(0); // guard the level table the rules lean on
  });
});

describe('merge primary = earliest captured_at (drag-onto)', () => {
  // Two titled files sharing a placement so both are `file` nodes (loose
  // single-page files would be raws and can't merge-file).
  function twoFileState() {
    const corpus = makeCorpus([
      {
        id: 'early',
        parsed: {
          collection: 'C',
          archiveName: 'A',
          box: '5',
          folder: '4',
          title: 'Early Title',
          capturedAt: '2026-01-01T00:00:00Z',
        },
      },
      {
        id: 'late',
        parsed: {
          collection: 'C',
          archiveName: 'A',
          box: '5',
          folder: '4',
          title: 'Late Title',
          capturedAt: '2026-06-01T00:00:00Z',
        },
      },
    ]);
    const state = buildModel(corpus, ['root']);
    const early = find(state, (n) => n.source?.fileId === 'early');
    const late = find(state, (n) => n.source?.fileId === 'late');
    return { state, getParsed: getParsedFrom(corpus), early, late };
  }

  it('file onto file is a mergeFiles drop', () => {
    const { state, early, late } = twoFileState();
    expect(dropOperation(state, late.id, { type: 'node', id: early.id })).toBe('mergeFiles');
  });

  it('earliest-captured title wins and leads the pages even when dragged onto the later file', () => {
    // Drop target is the LATER file, but capture order — not drag order — decides.
    const { state, getParsed, early, late } = twoFileState();
    applyDrop(state, early.id, { type: 'node', id: late.id }, getParsed);
    const survivor = state.nodes[late.id]; // the drop target survives the merge
    expect(survivor.title).toBe('Early Title');
    expect(survivor.meta.capturedAt).toBe('2026-01-01T00:00:00Z');
    expect(childrenOf(state, survivor.id).map((p) => p.ref.fileId)).toEqual(['early', 'late']);
  });

  it('symmetric: dragging the later file onto the earlier gives the same result', () => {
    const { state, getParsed, early, late } = twoFileState();
    applyDrop(state, late.id, { type: 'node', id: early.id }, getParsed);
    const survivor = state.nodes[early.id];
    expect(survivor.title).toBe('Early Title');
    expect(childrenOf(state, survivor.id).map((p) => p.ref.fileId)).toEqual(['early', 'late']);
  });

  it('falls back to the other title when the primary is untitled', () => {
    const { state, getParsed, early, late } = twoFileState();
    state.nodes[early.id].title = ''; // earliest has no name
    applyDrop(state, late.id, { type: 'node', id: early.id }, getParsed);
    expect(state.nodes[early.id].title).toBe('Late Title');
  });
});
