import { describe, it, expect } from 'vitest';
import { buildFileName, nextNumber, displayName } from '../naming.js';

// The convention is a mirror of the mobile app's buildFileBaseName
// (archive-capture/src/screens/ConfirmationScreen.js) — bare values, no
// label words, 100-char cap on the joined base. These tests pin that.
describe('buildFileName', () => {
  it('joins bare values in order with no label words', () => {
    expect(
      buildFileName({
        archiveName: 'Five Forks',
        collection: 'Good Poems',
        box: '3',
        folder: '2',
        number: 4,
        omg: true,
      }),
    ).toBe('Five Forks - Good Poems - 3 - 2 - 000004 - OMG.pdf');
  });

  it('skips missing fields entirely', () => {
    expect(buildFileName({ collection: 'Good Poems', number: 1 })).toBe(
      'Good Poems - 000001.pdf',
    );
    expect(buildFileName({ number: 12 })).toBe('000012.pdf');
  });

  it('caps the combined base name at 100 characters (the silent-upload-failure incident)', () => {
    const longCollection = 'C'.repeat(150);
    const name = buildFileName({ collection: longCollection, number: 1, omg: false });
    expect(name.length).toBe(104); // 100 + '.pdf'
    expect(name.endsWith('.pdf')).toBe(true);
    const omgName = buildFileName({ collection: longCollection, number: 1, omg: true });
    expect(omgName).toBe(name.slice(0, 100) + ' - OMG.pdf');
  });

  it('strips filesystem-invalid characters like the mobile app', () => {
    expect(buildFileName({ collection: 'a/b:c*d?"<>|', number: 1 })).toBe('abcd - 000001.pdf');
  });
});

describe('nextNumber / displayName', () => {
  it('continues after the highest existing number', () => {
    expect(nextNumber(['X - 000004.pdf', 'X - 000009 - OMG.pdf', 'junk.txt'])).toBe(10);
    expect(nextNumber([])).toBe(1);
  });
  it('shows number or title', () => {
    expect(displayName('A - B - 000007.pdf', {})).toBe('#7');
    expect(displayName('A - 000007.pdf', { title: 'Letter' })).toBe('Letter');
  });
});
