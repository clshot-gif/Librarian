import { describe, it, expect } from 'vitest';
import { listArchives, isInsideArchiveScans, fetchArchiveManifest } from '../archiveScans.js';

// A minimal backend over a flat {id → {name, isFolder, parentId, text?}} map.
function makeBackend(entries) {
  const byId = new Map(Object.entries(entries));
  return {
    async listChildren(folderId) {
      return [...byId.entries()]
        .filter(([, n]) => n.parentId === folderId)
        .map(([id, n]) => ({ id, name: n.name, isFolder: Boolean(n.isFolder) }));
    },
    async getParents(id) {
      const n = byId.get(id);
      return n?.parentId != null ? [n.parentId] : [];
    },
    async getPdfBytes(id) {
      return new TextEncoder().encode(byId.get(id)?.text || '');
    },
  };
}

const manifestJson = JSON.stringify({
  repository: { name: 'Five Forks' },
  collection: { title: 'Good Poems' },
  boxes: [{ box: '3', folders: ['2'] }],
});

const backend = makeBackend({
  scans: { name: 'Archive Scans', isFolder: true, parentId: null },
  arch1: { name: 'Five Forks', isFolder: true, parentId: 'scans' },
  contents: { name: 'Contents', isFolder: true, parentId: 'arch1' },
  manifest: { name: 'manifest.json', parentId: 'contents', text: manifestJson },
  sourceEmail: { name: 'finding aid email.pdf', parentId: 'contents', text: 'not json' },
  deep: { name: 'Box 3', isFolder: true, parentId: 'arch1' },
  arch2: { name: 'Bare Archive', isFolder: true, parentId: 'scans' },
  elsewhere: { name: 'Unprocessed stuff', isFolder: true, parentId: null },
});

describe('listArchives', () => {
  it('lists only Archive Scans direct child folders, name-sorted', async () => {
    const archives = await listArchives(backend, 'scans');
    expect(archives.map((a) => a.name)).toEqual(['Bare Archive', 'Five Forks']);
  });
});

describe('isInsideArchiveScans', () => {
  it('true for Archive Scans itself and anything nested inside it', async () => {
    expect(await isInsideArchiveScans(backend, 'scans', 'scans')).toBe(true);
    expect(await isInsideArchiveScans(backend, 'arch1', 'scans')).toBe(true);
    expect(await isInsideArchiveScans(backend, 'deep', 'scans')).toBe(true);
  });
  it('false outside it, and false when no Archive Scans id is known', async () => {
    expect(await isInsideArchiveScans(backend, 'elsewhere', 'scans')).toBe(false);
    expect(await isInsideArchiveScans(backend, 'deep', null)).toBe(false);
  });
});

describe('fetchArchiveManifest', () => {
  it('parses Contents/manifest.json into finding aids (ignoring provenance files)', async () => {
    const aids = await fetchArchiveManifest(backend, 'arch1');
    expect(aids).toHaveLength(1);
    expect(aids[0].collectionTitle).toBe('Good Poems');
    expect(aids[0].archiveName).toBe('Five Forks');
    expect(aids[0].boxes).toEqual([{ name: '3', folders: ['2'] }]);
  });
  it('returns null when there is no Contents folder or no manifest.json', async () => {
    expect(await fetchArchiveManifest(backend, 'arch2')).toBe(null);
  });
  it('throws on unparseable manifest JSON (caller surfaces a warning)', async () => {
    const bad = makeBackend({
      arch: { name: 'A', isFolder: true, parentId: null },
      contents: { name: 'Contents', isFolder: true, parentId: 'arch' },
      manifest: { name: 'manifest.json', parentId: 'contents', text: '{not json' },
    });
    await expect(fetchArchiveManifest(bad, 'arch')).rejects.toThrow();
  });
});
