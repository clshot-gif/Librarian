// Parsing/serializing the Drive `properties` schema documented in
// archive-capture/docs/metadata-schema.md. Every value on Drive is a string;
// array-ish fields are JSON strings. This tool adds three fields beyond what
// the mobile app writes (it's single-user; this tool is multi-user):
//   comment_log — JSON [{page, text, user, ts}]  (attributed comments; the
//                 legacy typed_comments field is kept in sync, minus
//                 attribution, so the mobile-app convention stays readable)
//   tag_log     — JSON [{tag, user, ts}]          (who added which tag when)
//   omg_log     — JSON [{page, user, ts}]         (who flagged which page)
// plus `title` (free-text File Title for citations) and `notes_page_index`
// (where the human-readable notes page sits in the PDF).

// The chunking scheme, Drive limits, and salvage logic live in the shared
// contract file both repos carry a copy of — see driveProps.js's header.
import { packProps, unpackProps, salvageJsonArray } from './driveProps.js';

export { packProps, unpackProps };

// A JSON field that doesn't parse is NEVER silently replaced by its fallback:
// that's the exact path a mobile-app-truncated typed_comments used to take to
// quietly vanish. Instead: try to salvage the complete entries (truncation
// cuts mid-stream, so everything before the cut is usually intact), and
// record a warning either way. Warnings land on the parsed object
// (`parseWarnings`) and in the console.
function parseJson(value, fallback, { field, warnings, array = false } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    if (array || Array.isArray(fallback)) {
      const salvaged = salvageJsonArray(value);
      if (salvaged) {
        warnings?.push(
          `${field}: value was corrupted (truncated mid-JSON, likely by the mobile ` +
            `app's old size cap) — recovered ${salvaged.length} complete ` +
            `entr${salvaged.length === 1 ? 'y' : 'ies'}; anything after the cut is gone.`,
        );
        return salvaged;
      }
    }
    warnings?.push(`${field}: unreadable JSON, using fallback. Raw value: ${value.slice(0, 120)}`);
    return fallback;
  }
}

export function parseProps(rawProps = {}) {
  const props = unpackProps(rawProps);
  const warnings = [];
  const opt = (field, array) => ({ field, warnings, array });
  const typedComments = parseJson(props.typed_comments, [], opt('typed_comments'));
  const commentLog = parseJson(props.comment_log, null, opt('comment_log', true));
  return {
    box: props.box || '',
    folder: props.folder || '',
    collection: props.collection || '',
    archiveName: props.archive_name || '',
    title: props.title || '',
    tags: parseJson(props.tags, [], opt('tags')),
    important: props.important === 'true',
    hasMarkup: props.has_markup === 'true',
    capturedAt: props.captured_at || '',
    pageCount: parseInt(props.page_count || '1', 10) || 1,
    omgPages: parseJson(props.omg_pages, [], opt('omg_pages')),
    unmarkedBackupPages: parseJson(props.unmarked_backup_pages, [], opt('unmarked_backup_pages')),
    // Prefer the attributed log; fall back to legacy typed_comments entries
    // (which have {page, text} but no user/ts).
    comments: commentLog || typedComments.map((c) => ({ ...c, user: '', ts: '' })),
    tagLog: parseJson(props.tag_log, [], opt('tag_log')),
    omgLog: parseJson(props.omg_log, [], opt('omg_log')),
    notesPageIndex:
      props.notes_page_index !== undefined && props.notes_page_index !== ''
        ? parseInt(props.notes_page_index, 10)
        : null,
    // Levels left blank *on purpose* when Filing Mode saved this file (e.g.
    // "box,folder" for a page filed straight into a Collection). Distinguishes
    // a deliberate skip from "not known yet" on reload — absent on files the
    // mobile app produced, which keeps their blank-means-unknown behavior.
    skippedLevels: (props.skipped_levels || '').split(',').filter(Boolean),
    // Non-empty when any JSON field above was corrupted on Drive — surfaced
    // by loadCorpus (console + node), never silently swallowed.
    parseWarnings: warnings,
  };
}

// Back to the all-strings shape Drive wants. Writes both comment_log (with
// attribution) and typed_comments (legacy shape) so both tools agree.
// `newFile: true` for files.create calls (skips the stale-continuation-key
// cleanup that property PATCHes need — see packProps in driveProps.js).
export function serializeProps(parsed, { newFile = false } = {}) {
  return packProps(
    {
      box: parsed.box,
      folder: parsed.folder,
      collection: parsed.collection,
      archive_name: parsed.archiveName,
      title: parsed.title,
      tags: JSON.stringify(parsed.tags),
      important: parsed.omgPages.length > 0 || parsed.important ? 'true' : 'false',
      has_markup: parsed.hasMarkup ? 'true' : 'false',
      captured_at: parsed.capturedAt,
      page_count: String(parsed.pageCount),
      omg_pages: JSON.stringify(parsed.omgPages),
      unmarked_backup_pages: JSON.stringify(parsed.unmarkedBackupPages),
      typed_comments: JSON.stringify(parsed.comments.map(({ page, text }) => ({ page, text }))),
      comment_log: JSON.stringify(parsed.comments),
      tag_log: JSON.stringify(parsed.tagLog),
      omg_log: JSON.stringify(parsed.omgLog),
      notes_page_index: parsed.notesPageIndex === null ? '' : String(parsed.notesPageIndex),
      skipped_levels: (parsed.skippedLevels || []).join(','),
      is_comment: 'false',
      parent_id: '',
    },
    { forUpdate: !newFile },
  );
}

// "How marked-up is this file" — the fuel for the explorer's highlight
// gradient. Weights are deliberately rough (the handoff says not to
// overthink them): an OMG flag counts most, then comments, markup, tags.
export function markingScore(parsed) {
  return (
    parsed.omgPages.length * 3 +
    parsed.comments.length * 2 +
    (parsed.hasMarkup ? 2 : 0) +
    parsed.tags.length
  );
}

// Percentile tiers *within a collection* (not global): 91st+ percentile of
// marking scores gets tier 3 (full yellow), 76–90 tier 2, 50–75 tier 1,
// below that 0. Zero-score files are never highlighted regardless of rank.
// `scoresById` is Map(fileId -> score) for one collection's files.
export function computeTiers(scoresById) {
  const entries = [...scoresById.entries()];
  const scores = entries.map(([, s]) => s);
  const n = scores.length;
  const tiers = new Map();
  for (const [id, score] of entries) {
    if (score <= 0 || n < 2) {
      tiers.set(id, 0);
      continue;
    }
    const below = scores.filter((s) => s < score).length;
    const pct = (below / (n - 1)) * 100;
    tiers.set(id, pct > 90 ? 3 : pct > 75 ? 2 : pct >= 50 ? 1 : 0);
  }
  return tiers;
}
