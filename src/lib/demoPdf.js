// Generates realistic-looking "archival scan" PDFs for Sample mode, using
// pdf-lib — so everything downstream (viewer, markup bake, merging) operates
// on genuinely real PDFs, not placeholders. Pages follow the mobile app's
// document convention: content pages, then a Notes page, then clean backup
// copies of any marked-up pages.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

const PAGE_W = 612;
const PAGE_H = 792;
const PAPER = rgb(0.93, 0.89, 0.8);
const INK = rgb(0.22, 0.17, 0.12);

// Deterministic pseudo-random so the same demo file always looks the same.
function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FILLER = (
  'the season turned before the letters arrived and no answer came from the ' +
  'county office though three were sent by the same hand we waited on the ' +
  'porch through the better part of the evening while the ledger sat unopened ' +
  'on the table and the rain kept its own account of things'
).split(' ');

function drawContentPage(page, fonts, spec, rand) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: PAPER });
  // Slight tonal blotch so it reads as a photo of paper, not flat fill.
  page.drawEllipse({
    x: 80 + rand() * 450, y: 120 + rand() * 550, xScale: 60 + rand() * 60, yScale: 30 + rand() * 40,
    color: rgb(0.88, 0.83, 0.72), opacity: 0.5,
  });
  const rotate = degrees((rand() - 0.5) * 1.6);
  if (spec.heading) {
    page.drawText(spec.heading, {
      x: 70, y: PAGE_H - 90, size: 16, font: fonts.courierBold, color: INK, rotate,
    });
  }
  let y = PAGE_H - 130;
  const lineCount = 14 + Math.floor(rand() * 10);
  for (let i = 0; i < lineCount && y > 90; i++) {
    const words = [];
    let start = Math.floor(rand() * FILLER.length);
    const n = 6 + Math.floor(rand() * 5);
    for (let w = 0; w < n; w++) words.push(FILLER[(start + w) % FILLER.length]);
    page.drawText(words.join(' '), {
      x: 70 + rand() * 8, y, size: 11, font: fonts.courier, color: INK, rotate,
      opacity: 0.75 + rand() * 0.25,
    });
    y -= 20 + rand() * 8;
  }
  page.drawText(spec.footer || '', { x: 70, y: 60, size: 9, font: fonts.courier, color: INK, opacity: 0.6 });
}

function drawMarkupOn(page, rand) {
  // A highlighter bar and a pen circle, mimicking baked-in markup.
  page.drawRectangle({
    x: 65, y: PAGE_H - 260 - rand() * 120, width: 300 + rand() * 120, height: 18,
    color: rgb(1, 0.92, 0.23), opacity: 0.45,
  });
  page.drawEllipse({
    x: 200 + rand() * 150, y: PAGE_H - 420 - rand() * 100, xScale: 90, yScale: 26,
    borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 2.4, opacity: 0,
    borderOpacity: 0.9,
  });
  // The mobile app's warning banner convention.
  page.drawRectangle({ x: 0, y: PAGE_H - 34, width: PAGE_W, height: 34, color: rgb(1, 0.86, 0.2) });
  page.drawText('MARKED-UP PAGE — clean original appended at end of this PDF', {
    x: 24, y: PAGE_H - 24, size: 11, color: rgb(0.25, 0.18, 0) ,
  });
}

export function drawNotesEntries(page, font, fontBold, entries) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(1, 1, 0.98) });
  page.drawText('Notes', { x: 60, y: PAGE_H - 80, size: 22, font: fontBold, color: rgb(0.15, 0.15, 0.2) });
  page.drawLine({
    start: { x: 60, y: PAGE_H - 92 }, end: { x: PAGE_W - 60, y: PAGE_H - 92 },
    thickness: 1, color: rgb(0.7, 0.7, 0.75),
  });
  let y = PAGE_H - 130;
  for (const line of entries) {
    // Naive wrap at ~86 chars — notes are short, this is fine.
    const chunks = line.match(/.{1,86}(\s|$)/g) || [line];
    for (const chunk of chunks) {
      if (y < 60) return;
      page.drawText(chunk.trim(), { x: 60, y, size: 11, font, color: rgb(0.2, 0.2, 0.25) });
      y -= 18;
    }
    y -= 8;
  }
}

// spec: { seed, pages: [{heading, footer}], markedPages: [idx], notesEntries: [str] }
// Page order out: content pages, Notes page, then clean backups of markedPages.
export async function buildDemoPdf(spec) {
  const doc = await PDFDocument.create();
  const fonts = {
    courier: await doc.embedFont(StandardFonts.Courier),
    courierBold: await doc.embedFont(StandardFonts.CourierBold),
    helv: await doc.embedFont(StandardFonts.Helvetica),
    helvBold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const rand = mulberry(spec.seed || 1);
  const marked = new Set(spec.markedPages || []);

  for (let i = 0; i < spec.pages.length; i++) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const pageRand = mulberry((spec.seed || 1) * 100 + i);
    drawContentPage(page, fonts, spec.pages[i], pageRand);
    if (marked.has(i)) drawMarkupOn(page, pageRand);
  }

  if (!spec.skipNotesPage) {
    const notes = doc.addPage([PAGE_W, PAGE_H]);
    drawNotesEntries(notes, fonts.helv, fonts.helvBold, spec.notesEntries || []);
  }

  for (const i of marked) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    drawContentPage(page, fonts, spec.pages[i], mulberry((spec.seed || 1) * 100 + i));
  }

  return doc.save();
}
