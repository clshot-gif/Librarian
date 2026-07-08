// Thin wrapper around pdf.js (rendering) so the rest of the app never
// touches its API directly. pdf-lib handles *writing* PDFs elsewhere;
// pdf.js only ever draws them to canvases here.
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// pdf.js transfers the buffer to its worker (neutering it), so always hand
// it a copy — callers keep their bytes usable for pdf-lib operations.
export function openPdf(bytes) {
  return pdfjsLib.getDocument({ data: bytes.slice() }).promise;
}

// Renders one page into the given canvas at a target CSS-pixel width
// (times devicePixelRatio for sharpness). Returns the page's size in PDF
// points — the coordinate space markup strokes are recorded in.
export async function renderPage(doc, pageIndex, targetWidth, canvas) {
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = (targetWidth * (window.devicePixelRatio || 1)) / base.width;
  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return { widthPts: base.width, heightPts: base.height };
}

// Renders a page to an offscreen canvas and returns it (used by the markup
// bake, which needs raw pixels, and by thumbnails).
export async function renderPageToBitmap(doc, pageIndex, targetWidth) {
  const canvas = document.createElement('canvas');
  const dims = await renderPage(
    doc,
    pageIndex,
    targetWidth / (window.devicePixelRatio || 1),
    canvas,
  );
  return { canvas, ...dims };
}

const thumbCache = new Map();

// Small page preview for Filing Mode cards (first page by default; exploded
// raw-page cards pass their own page index). Cached per file id + page;
// concurrency-limited so a big folder doesn't spawn 200 workers at once.
let thumbQueue = Promise.resolve();
export function renderThumbnail(fileId, getBytes, width = 150, pageIndex = 0) {
  const key = `${fileId}#${pageIndex}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const job = thumbQueue.then(async () => {
    const bytes = await getBytes();
    const doc = await openPdf(bytes);
    const page = Math.min(pageIndex, doc.numPages - 1);
    const { canvas } = await renderPageToBitmap(doc, page, width);
    const url = canvas.toDataURL('image/jpeg', 0.7);
    doc.destroy();
    return url;
  });
  thumbQueue = job.catch(() => {});
  thumbCache.set(key, job);
  return job;
}

export function invalidateThumbnail(fileId) {
  for (const key of thumbCache.keys()) {
    if (key === fileId || key.startsWith(`${fileId}#`)) thumbCache.delete(key);
  }
}
