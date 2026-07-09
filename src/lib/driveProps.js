// ─────────────────────────────────────────────────────────────────────────────
// SHARED CONTRACT FILE — byte-identical copies live in BOTH repos:
//   review-ui/src/lib/driveProps.js
//   archive-capture/src/utils/driveProps.js
// Each repo has a test that fails if its copy drifts from the sibling's
// (review-ui: src/lib/__tests__/driveProps.test.js; archive-capture:
// src/utils/__tests__/driveProps.test.js). Edit both copies together.
//
// This is the one place both apps agree on how Google Drive's real limits on
// custom file `properties` get handled, plus the shared filename-length cap.
// Drive's limits (see docs/metadata-schema.md in archive-capture):
//   • each property is capped at 124 bytes, UTF-8 key + value combined —
//     one attributed tag/comment entry can blow this on its own;
//   • a file holds at most ~30 custom properties (per app, "public"
//     visibility — which is what both apps write).
// ─────────────────────────────────────────────────────────────────────────────

export const PROP_VALUE_LIMIT = 124; // bytes, UTF-8, key + value combined
export const PROP_COUNT_LIMIT = 30; // properties per file (Drive's ceiling)
// Sanity ceiling on continuation chunks per key. 10 chunks ≈ 1.1KB for one
// value — far past anything the schema legitimately produces, and a value
// that big would trip PROP_COUNT_LIMIT anyway. Also bounds how many stale
// continuation keys an update has to clear (see packProps).
export const MAX_CHUNKS = 10;
// The filename cap that already caused a real incident when the two repos'
// copies of it drifted (2026-07-08: a long Collection name pushed the full
// filename past what Drive accepts and uploads failed silently forever).
// Both repos' filename builders must import THIS constant, never re-declare
// the literal.
export const MAX_FILENAME_LENGTH = 100;

const CONT = '~'; // continuation-key marker; never appears in schema keys

// UTF-8 byte length without TextEncoder (which Hermes/React Native builds
// can't be assumed to have).
function utf8Len(str) {
  let n = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    n += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return n;
}

// Serialize a flat {key: stringable} object into Drive-safe properties.
// Oversized values are split losslessly across continuation keys — `tag_log`,
// `tag_log~1`, `tag_log~2`, … — each under PROP_VALUE_LIMIT, reassembled by
// unpackProps. Values that already fit are written unchanged, so files stay
// readable by anything that never learned about chunking.
//
// { forUpdate: true } — use for PATCHes to an existing file. Drive merges
// properties per-key on update, so if a value previously needed 3 chunks and
// now needs 1, the stale `key~1`/`key~2` would survive the write and corrupt
// the next read (reassembly is contiguous-run based). For updates we emit
// explicit nulls for every unused continuation slot up to MAX_CHUNKS — null
// deletes the key on Drive (and deleting a key that doesn't exist is a
// no-op). Never set forUpdate on a files.create call: a brand-new file has
// no stale keys, and nulls in a create body are at best noise.
//
// Throws when the packed set would exceed PROP_COUNT_LIMIT — better a loud
// failure at save time than Drive's silent 403 later. If this ever fires on
// real data, the fix is a sidecar metadata document, not a bigger limit
// (handoff item 2 — deliberately not designed here).
export function packProps(props, { forUpdate = false } = {}) {
  const out = {};
  const nullContinuations = (key, fromIndex) => {
    if (!forUpdate) return;
    for (let j = Math.max(1, fromIndex); j < MAX_CHUNKS; j++) out[`${key}${CONT}${j}`] = null;
  };
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) {
      out[key] = value; // deletion intent — clear its continuations too
      nullContinuations(key, 1);
      continue;
    }
    const str = String(value);
    if (utf8Len(key) + utf8Len(str) <= PROP_VALUE_LIMIT) {
      out[key] = str;
      nullContinuations(key, 1);
      continue;
    }
    // Split by code points (never mid-character) into cap-sized pieces.
    const cps = [...str];
    let i = 0;
    let n = 0;
    while (i < cps.length) {
      if (n >= MAX_CHUNKS) {
        throw new Error(
          `Drive property "${key}" is too large even for ${MAX_CHUNKS} chunks ` +
            `(${utf8Len(str)} bytes). This file's history has outgrown Drive ` +
            `properties — it needs the sidecar-document design, not a bigger cap.`,
        );
      }
      const k = n === 0 ? key : `${key}${CONT}${n}`;
      const allow = PROP_VALUE_LIMIT - utf8Len(k);
      let piece = '';
      let used = 0;
      while (i < cps.length && used + utf8Len(cps[i]) <= allow) {
        used += utf8Len(cps[i]);
        piece += cps[i++];
      }
      if (piece === '') piece = cps[i++]; // guard: one code point over the cap
      out[k] = piece;
      n++;
    }
    nullContinuations(key, n);
  }
  const written = Object.keys(out).filter((k) => out[k] !== null && out[k] !== undefined);
  if (written.length > PROP_COUNT_LIMIT) {
    const biggest = written
      .map((k) => `${k} (${utf8Len(String(out[k]))}B)`)
      .sort((a, b) => b.length - a.length)
      .slice(0, 5)
      .join(', ');
    throw new Error(
      `This file's metadata needs ${written.length} Drive properties — over Drive's ` +
        `~${PROP_COUNT_LIMIT}-per-file ceiling, so the save would fail. Largest: ${biggest}. ` +
        `The comment/tag history has outgrown Drive properties (sidecar design needed — ` +
        `flag this to Carter rather than trimming data).`,
    );
  }
  return out;
}

// Reassemble what packProps split. Values written by anything else (including
// the mobile app's pre-chunking truncation era) pass through unchanged.
export function unpackProps(raw = {}) {
  const out = {};
  for (const key of Object.keys(raw)) {
    if (key.includes(CONT)) continue; // continuation — folded into its base key
    const base = raw[key];
    if (base === null || base === undefined) {
      out[key] = base;
      continue;
    }
    let val = String(base);
    for (let n = 1; raw[`${key}${CONT}${n}`] != null; n++) {
      val += String(raw[`${key}${CONT}${n}`]);
    }
    out[key] = val;
  }
  return out;
}

// Best-effort recovery of a JSON *array* value that was cut off mid-stream —
// the exact damage the mobile app's old truncate-with-ellipsis fallback did
// to typed_comments/tags. Returns every complete element (an entry cut in
// half is unrecoverable and dropped), or null if the value isn't salvageable
// as an array at all. Callers should treat a salvage as a loud warning, not
// business as usual: data WAS lost when the value was truncated; this just
// stops the surviving entries from silently vanishing with it.
export function salvageJsonArray(value) {
  if (typeof value !== 'string' || !value.trimStart().startsWith('[')) return null;
  const s = value.replace(/…\s*$/, ''); // the truncation marker itself
  for (let end = s.length; end >= 1; end--) {
    const cand = s.slice(0, end).replace(/,\s*$/, '');
    if (cand.trim() === '[') return [];
    try {
      const parsed = JSON.parse(cand + ']');
      if (Array.isArray(parsed)) return parsed;
      return null; // parsed but not an array — not our case
    } catch {
      // keep trimming
    }
  }
  return null;
}
