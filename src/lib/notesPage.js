// The human-readable notes page. Structure matches the mobile app's own
// convention exactly (ConfirmationScreen.js buildPDF): a per-page block for
// any photographed page that has a comment or an OMG flag ("Page N" heading,
// then a Comments line and/or an OMG line for that page), followed by a
// document-level footer of Tags / Box / Folder. The one real difference —
// this tool is multi-user, the app isn't — is that lines carry who wrote
// them, since Hannah's and Justina's comments/tags/OMG flags need to stay
// distinguishable on the printed page, not just in the tool.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { drawNotesEntries } from './demoPdf.js';

export function buildNotesContent(parsed) {
  const blocks = [];
  for (let i = 0; i < parsed.pageCount; i++) {
    const lines = [];
    for (const c of parsed.comments.filter((c) => (c.page || 0) === i)) {
      lines.push({ text: `Comments: ${c.user ? `${c.user} — ` : ''}“${c.text}”`, omg: false });
    }
    if (parsed.omgPages.includes(i)) {
      const who = parsed.omgLog.filter((e) => (e.page || 0) === i).map((e) => e.user).filter(Boolean);
      lines.push({ text: `OMG${who.length ? ` — ${who.join(', ')}` : ''}`, omg: true });
    }
    if (lines.length) blocks.push({ heading: `Page ${i + 1}`, lines });
  }

  const footerLines = [];
  if (parsed.tags.length) {
    const tagText = parsed.tags.map((tag) => {
      const who = parsed.tagLog.find((e) => e.tag === tag)?.user;
      return who ? `${tag} (${who})` : tag;
    }).join(', ');
    footerLines.push(`Tags: ${tagText}`);
  }
  if (parsed.box) footerLines.push(`Box: ${parsed.box}`);
  if (parsed.folder) footerLines.push(`Folder: ${parsed.folder}`);

  return { blocks, footerLines };
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
  drawNotesEntries(page, helv, helvBold, buildNotesContent(parsed));
  return { bytes: await doc.save(), notesPageIndex: idx };
}
