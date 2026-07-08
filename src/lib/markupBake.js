// Baking freshly drawn markup into the PDF, following the mobile app's
// convention exactly: the marked page gets a warning banner, and a clean
// copy of the original page is appended at the back of the same PDF
// (tracked in unmarked_backup_pages). Strokes arrive in PDF-point
// coordinates (the viewer records them that way — see PdfViewer), so the
// only mapping here is a uniform scale to the render resolution.
import { PDFDocument } from 'pdf-lib';
import { renderPageToBitmap } from './pdfEngine.js';

function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const STROKE_STYLE = {
  pen: { color: '#16161a', width: 2.2 },
  highlighter: { color: 'rgba(255,235,59,0.5)', width: 16 },
};

export async function bakeMarkup({ bytes, pdfjsDoc, strokesByPage, parsed }) {
  const doc = await PDFDocument.load(bytes);
  const backups = [...parsed.unmarkedBackupPages];
  const pagesToBake = [...strokesByPage.keys()]
    .filter((p) => strokesByPage.get(p)?.length)
    .sort((a, b) => a - b);

  for (const p of pagesToBake) {
    const { canvas, widthPts, heightPts } = await renderPageToBitmap(pdfjsDoc, p, 1600);
    const scale = canvas.width / widthPts;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokesByPage.get(p)) {
      const style = STROKE_STYLE[stroke.tool] || STROKE_STYLE.pen;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.width * scale;
      ctx.beginPath();
      stroke.points.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x * scale, y * scale);
        else ctx.lineTo(x * scale, y * scale);
      });
      ctx.stroke();
    }
    const bannerH = 26 * scale;
    ctx.fillStyle = '#ffdb33';
    ctx.fillRect(0, 0, canvas.width, bannerH);
    ctx.fillStyle = '#3d2e00';
    ctx.font = `bold ${12 * scale}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(
      'MARKED-UP PAGE — clean original appended at end of this PDF',
      10 * scale,
      bannerH / 2,
    );

    const img = await doc.embedJpg(dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.85)));

    // Back up the still-clean original first — but only if this page has
    // never been marked before (a re-marked page's clean original is
    // already at the back from the first bake).
    if (!backups.includes(p)) {
      const [copy] = await doc.copyPages(doc, [p]);
      doc.addPage(copy);
      backups.push(p);
    }
    doc.removePage(p);
    const newPage = doc.insertPage(p, [widthPts, heightPts]);
    newPage.drawImage(img, { x: 0, y: 0, width: widthPts, height: heightPts });
  }

  return { bytes: await doc.save(), unmarkedBackupPages: backups };
}
