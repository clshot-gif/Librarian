import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  packProps,
  unpackProps,
  salvageJsonArray,
  PROP_VALUE_LIMIT,
  PROP_COUNT_LIMIT,
  MAX_CHUNKS,
  MAX_FILENAME_LENGTH,
} from '../driveProps.js';

const byteLen = (s) => new TextEncoder().encode(s).length;

// What Drive does to `properties` on a files.update PATCH: merge per-key,
// null deletes (deleting an absent key is a no-op).
function drivePatchMerge(existing, patch) {
  const out = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

describe('packProps / unpackProps', () => {
  it('leaves small values untouched', () => {
    const packed = packProps({ title: 'short', tag_log: '[]' });
    expect(packed).toEqual({ title: 'short', tag_log: '[]' });
  });

  it('chunks an oversized value and reassembles it losslessly', () => {
    const long = JSON.stringify(
      Array.from({ length: 6 }, (_, i) => ({
        tag: `Tag ${i}`,
        user: 'Hannah',
        ts: '2026-07-09T12:00:00.000Z',
      })),
    );
    const packed = packProps({ tag_log: long });
    expect(Object.keys(packed).length).toBeGreaterThan(1);
    for (const [k, v] of Object.entries(packed)) {
      expect(byteLen(k) + byteLen(v)).toBeLessThanOrEqual(PROP_VALUE_LIMIT);
    }
    expect(unpackProps(packed).tag_log).toBe(long);
  });

  it('never splits a multi-byte character', () => {
    const val = '¶'.repeat(200); // 2 bytes each
    expect(unpackProps(packProps({ omg_log: val })).omg_log).toBe(val);
  });

  it('update after shrink cannot leave stale chunks to corrupt the next read', () => {
    const long = 'x'.repeat(400); // needs several chunks
    const onDrive = packProps({ comment_log: long }, { forUpdate: true });
    // Value shrinks to a single chunk; Drive merges per-key, so without the
    // explicit nulls the old comment_log~1/~2 would survive and get glued
    // onto the new value on read.
    const patch = packProps({ comment_log: '[]' }, { forUpdate: true });
    const merged = drivePatchMerge(onDrive, patch);
    expect(unpackProps(merged).comment_log).toBe('[]');
  });

  it('deleting a previously-chunked key clears its continuations too', () => {
    const onDrive = packProps({ comment_log: 'y'.repeat(400) }, { forUpdate: true });
    const merged = drivePatchMerge(onDrive, packProps({ comment_log: null }, { forUpdate: true }));
    expect(Object.keys(merged).filter((k) => k.startsWith('comment_log'))).toEqual([]);
  });

  it('a create (no forUpdate) emits no null keys at all', () => {
    const packed = packProps({ a: 'x'.repeat(400), b: 'small' });
    expect(Object.values(packed).every((v) => v !== null)).toBe(true);
  });

  it('throws instead of silently exceeding MAX_CHUNKS', () => {
    expect(() => packProps({ k: 'z'.repeat(PROP_VALUE_LIMIT * (MAX_CHUNKS + 1)) })).toThrow(
      /sidecar/,
    );
  });

  it('throws instead of walking past the ~30-properties-per-file ceiling', () => {
    const props = {};
    for (let i = 0; i < PROP_COUNT_LIMIT + 1; i++) props[`k${i}`] = 'v';
    expect(() => packProps(props)).toThrow(/ceiling/);
  });
});

describe('salvageJsonArray — recovery from mobile-app truncation', () => {
  it('recovers the complete entries of a mid-object truncation', () => {
    const full = [
      { page: 0, text: 'Water damage on left edge' },
      { page: 1, text: 'Second page note' },
      { page: 2, text: 'This entry gets cut off' },
    ];
    const json = JSON.stringify(full);
    // Cut mid-way through the third entry: the first two survive intact.
    const truncated = json.slice(0, json.indexOf('cut off')) + '…';
    expect(salvageJsonArray(truncated)).toEqual(full.slice(0, 2));
  });

  it('recovers complete strings from a truncated tags array', () => {
    expect(salvageJsonArray('["Letters","1940s","Corresp')).toEqual(['Letters', '1940s']);
  });

  it('returns [] when nothing complete survives', () => {
    expect(salvageJsonArray('[{"page":0,"text":"cut')).toEqual([]);
  });

  it('returns null for values that were never arrays', () => {
    expect(salvageJsonArray('true')).toBe(null);
    expect(salvageJsonArray('{"a":1}')).toBe(null);
    expect(salvageJsonArray(undefined)).toBe(null);
  });
});

describe('the cross-repo contract', () => {
  it(`pins MAX_FILENAME_LENGTH at 100 — the value that already caused a real
      incident when the two repos drifted. Changing it means changing BOTH
      repos' driveProps.js (the test below enforces the files match)`, () => {
    expect(MAX_FILENAME_LENGTH).toBe(100);
  });

  const here = path.dirname(fileURLToPath(import.meta.url));
  const ours = path.resolve(here, '../driveProps.js');
  const theirs = path.resolve(here, '../../../../archive-capture/src/utils/driveProps.js');

  it.skipIf(!fs.existsSync(theirs))(
    'is byte-identical to archive-capture/src/utils/driveProps.js',
    () => {
      expect(fs.readFileSync(ours, 'utf8')).toBe(fs.readFileSync(theirs, 'utf8'));
    },
  );
});
