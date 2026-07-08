import { describe, it, expect } from 'vitest';
import { parseFindingAid } from '../findingAid.js';
import seed from '../findingAidSeed.json';

describe('parseFindingAid', () => {
  it('parses the real FWHC seed (collection-level facts, empty inventory)', () => {
    const aid = parseFindingAid(seed);
    expect(aid.collectionTitle).toBe('Feminist Women’s Health Center Records'.replace('’', "'"));
    expect(aid.archiveName).toContain('Sallie Bingham');
    expect(aid.boxes).toEqual([]);
    expect(aid.status).toContain('SKELETON');
  });

  it('parses box/folder inventories in both entry shapes', () => {
    const aid = parseFindingAid({
      repository: { name: 'Repo' },
      collection: { title: 'C' },
      boxes: [
        { box: '1', folders: [{ folder: '1', title: 'Correspondence' }, 'Clippings'] },
        { box: '2', folders: [] },
      ],
    });
    expect(aid.archiveName).toBe('Repo');
    expect(aid.boxes).toEqual([
      { name: '1', folders: ['Correspondence', 'Clippings'] },
      { name: '2', folders: [] },
    ]);
  });

  it('rejects non-finding-aid JSON', () => {
    expect(() => parseFindingAid({ hello: 1 })).toThrow(/collection\.title/);
  });
});
