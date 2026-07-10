import { describe, it, expect } from 'vitest';
import { collectNameSuggestions } from '../nameSuggest.js';

describe('collectNameSuggestions', () => {
  const nodes = new Map([
    ['r', { id: 'r', name: 'Archive Capture — Good Poems', isFolder: true, parsed: null }],
    ['b', { id: 'b', name: 'Box 3', isFolder: true, parsed: null }],
    ['f', { id: 'f', name: 'Folder 12', isFolder: true, parsed: null }],
    ['x', { id: 'x', name: 'Unprocessed 2026-07-05', isFolder: true, parsed: null }],
    [
      'file1',
      {
        id: 'file1',
        isFolder: false,
        parsed: { archiveName: 'Five Forks', collection: 'Good Poems', box: '5', folder: '4' },
      },
    ],
  ]);
  const aids = [
    {
      archiveName: 'Sallie Bingham Center',
      collectionTitle: 'FWHC Records',
      boxes: [{ name: '1', folders: ['Correspondence', 'Board minutes'] }],
    },
  ];

  it('merges manifest slots, file metadata, and convention-named folders; numeric sort', () => {
    const s = collectNameSuggestions(nodes, aids);
    expect(s.archives).toEqual(['Five Forks', 'Sallie Bingham Center']);
    expect(s.collections).toEqual(['FWHC Records', 'Good Poems']);
    expect(s.boxes).toEqual(['1', '3', '5']);
    expect(s.folders).toEqual(['4', '12', 'Board minutes', 'Correspondence']);
  });

  it('tolerates missing inputs', () => {
    expect(collectNameSuggestions(null, null)).toEqual({
      archives: [],
      collections: [],
      boxes: [],
      folders: [],
    });
  });
});
