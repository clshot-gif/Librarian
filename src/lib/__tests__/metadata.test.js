import { describe, it, expect } from 'vitest';
import { packProps, unpackProps, serializeProps, parseProps } from '../metadata.js';

const byteLen = (s) => new TextEncoder().encode(s).length;
const withinLimit = (props) =>
  Object.entries(props).every(([k, v]) => v === null || byteLen(k) + byteLen(String(v)) <= 124);

// A parsed-metadata object shaped like what serializeProps expects.
function parsedWithTags(tagCount) {
  const tagLog = Array.from({ length: tagCount }, (_, i) => ({
    tag: `tag number ${i}`,
    user: 'Carter',
    ts: '2026-07-08T22:30:00.000Z',
  }));
  return {
    box: '',
    folder: '',
    collection: '',
    archiveName: '',
    title: '1997 baseball card',
    tags: tagLog.map((t) => t.tag),
    important: false,
    hasMarkup: false,
    capturedAt: '2026-07-08T22:00:00.000Z',
    pageCount: 1,
    omgPages: [],
    unmarkedBackupPages: [],
    comments: [],
    tagLog,
    omgLog: [],
    notesPageIndex: null,
    skippedLevels: [],
  };
}

describe('packProps / unpackProps', () => {
  it('passes short values through untouched (mobile-app compatible)', () => {
    const packed = packProps({ title: 'short', tag_log: '[]' });
    expect(packed).toEqual({ title: 'short', tag_log: '[]' });
  });

  it('splits an oversized value across continuation keys, each within the cap', () => {
    const long = 'a'.repeat(300);
    const packed = packProps({ tag_log: long });
    expect(Object.keys(packed).length).toBeGreaterThan(1);
    expect(withinLimit(packed)).toBe(true);
    expect(unpackProps(packed).tag_log).toBe(long);
  });

  it('never splits a multi-byte character', () => {
    const val = '💥'.repeat(60); // 240 bytes, 4 bytes each
    const round = unpackProps(packProps({ omg_log: val })).omg_log;
    expect(round).toBe(val);
  });
});

describe('serializeProps / parseProps round-trip under the 124-byte cap', () => {
  it('two attributed tags — the case that used to 403 — now fits and round-trips', () => {
    const parsed = parsedWithTags(2);
    const props = serializeProps(parsed);
    // The single tag_log value would be ~135 bytes; after packing every
    // property (incl. continuations) is within Drive's per-property limit.
    expect(withinLimit(props)).toBe(true);
    expect(parseProps(props).tagLog).toEqual(parsed.tagLog);
  });

  it('holds for a much longer log too', () => {
    const parsed = parsedWithTags(12);
    const props = serializeProps(parsed);
    expect(withinLimit(props)).toBe(true);
    const back = parseProps(props);
    expect(back.tagLog).toEqual(parsed.tagLog);
    expect(back.tags).toEqual(parsed.tags);
    expect(back.title).toBe('1997 baseball card');
  });
});
