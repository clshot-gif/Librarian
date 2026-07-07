// The human-readable notes page: attributed comments/tags/OMG flags rendered
// into the PDF itself, so anyone flipping through a printed or exported copy
// sees who flagged what without opening this tool. Rebuilt from the metadata
// on every save; sits after the content pages, before any backup pages.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { drawNotesEntries } from './demoPdf.js';

function day(ts) {
  return (ts || '').slice(0, 10) || 'undated';
}

export function notesEntries(parsed) {
  const entries = [];
  for (const e of parsed.omgLog) {
    entries.push(`${e.user || 'Unknown'} — ${day(e.ts)} — OMG on page ${(e.page || 0) + 1}`);
  }
  for (const c of parsed.comments) {
    entries.push(`${c.user || 'Unknown'} — ${day(c.ts)} — p.${(c.page || 0) + 1} — “${c.text}”`);
  }
  for (const t of parsed.tagLog) {
    entries.push(`${t.user || 'Unknown'} — ${day(t.ts)} — tag “${t.tag}”`);
  }
  // Tags that predate attribution (mobile-app writes) still deserve a line.
  const logged = new Set(parsed.tagLog.map((t) => t.tag));
  const untracked = parsed.tags.filter((t) => !logged.has(t));
  if (untracked.length) entries.push(`Tags: ${untracked.join(', ')}`);
  return entries;
}

export async function rebuildNotesPage(bytes, parsed) {
  const doc = await PDFDocument.load(bytes);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let idx = parsed.notesPageIndex;
  if (idx !== null && idx < doc.getPageCount()) {
    doc.removePage(idx);
  } else {
    idx = parsed.pageCount; // insert right after the content pages
  }
  const page = doc.insertPage(Math.min(idx, doc.getPageCount()), [612, 792]);
  drawNotesEntries(page, helv, helvBold, notesEntries(parsed));
  return { bytes: await doc.save(), notesPageIndex: idx };
}
