import React, { useEffect, useRef, useState } from 'react';
import { renderPage } from '../lib/pdfEngine.js';
import { STROKE_STYLE } from '../lib/markupBake.js';

// The viewer + markup surface. Coordinate model (this is the part the
// mobile app's MarkupScreen solved, adapted for the web): the canvas wrapper
// is sized to exactly the page's aspect ratio — no letterbox margins — and
// the SVG overlay's viewBox is the page's size in PDF points. Strokes are
// therefore recorded directly in PDF-point coordinates: reading the
// pointer position against the overlay's live bounding rect (which already
// reflects any zoom/pan transform) and scaling into viewBox units. The bake
// step then needs no coordinate mapping at all, at any zoom level.
function pointsToD(points) {
  if (points.length < 2) return '';
  const [first, ...rest] = points;
  return `M${first[0]},${first[1]} ` + rest.map(([x, y]) => `L${x},${y}`).join(' ');
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export default function PdfViewer({
  pdfjsDoc, pageIndex, numPages, pageLabel, special, tool, canDraw,
  strokes, onAddStroke, onPageChange,
}) {
  const outerRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const [dims, setDims] = useState(null); // {widthPts, heightPts, wrapW, wrapH}
  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const [currentStroke, setCurrentStroke] = useState(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const strokeRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pdfjsDoc || !outerRef.current) return;
      const page = await pdfjsDoc.getPage(pageIndex + 1);
      const vp = page.getViewport({ scale: 1 });
      const aspect = vp.width / vp.height;
      const availW = outerRef.current.clientWidth - 48;
      const availH = outerRef.current.clientHeight - 48;
      const wrapW = Math.min(availW, availH * aspect);
      if (cancelled) return;
      await renderPage(pdfjsDoc, pageIndex, wrapW, canvasRef.current);
      if (cancelled) return;
      setDims({ widthPts: vp.width, heightPts: vp.height, wrapW, wrapH: wrapW / aspect });
      setTransform({ scale: 1, tx: 0, ty: 0 });
    })();
    return () => { cancelled = true; };
  }, [pdfjsDoc, pageIndex]);

  // Wheel zoom needs a non-passive listener (preventDefault on scroll).
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const onWheel = (e) => {
      e.preventDefault();
      setTransform((t) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const scale = clamp(t.scale * factor, MIN_ZOOM, MAX_ZOOM);
        if (scale === 1) return { scale: 1, tx: 0, ty: 0 };
        const ratio = scale / t.scale;
        return { scale, tx: t.tx * ratio, ty: t.ty * ratio };
      });
    };
    outer.addEventListener('wheel', onWheel, { passive: false });
    return () => outer.removeEventListener('wheel', onWheel);
  }, []);

  function svgPoint(e) {
    const rect = overlayRef.current.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * dims.widthPts,
      ((e.clientY - rect.top) / rect.height) * dims.heightPts,
    ];
  }

  function pinchState() {
    const pts = [...pointersRef.current.values()];
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    return {
      dist: Math.hypot(dx, dy) || 1,
      midX: (pts[0].x + pts[1].x) / 2,
      midY: (pts[0].y + pts[1].y) / 2,
    };
  }

  function onPointerDown(e) {
    overlayRef.current.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      // Second finger joins: whatever was happening becomes a pinch —
      // same semantics as the mobile app (one finger draws, two zoom).
      strokeRef.current = null;
      setCurrentStroke(null);
      const p = pinchState();
      gestureRef.current = {
        type: 'pinch', startDist: p.dist, startMid: p,
        start: { ...transformRefLatest.current },
      };
      return;
    }
    const drawing = (tool === 'pen' || tool === 'highlighter') && canDraw;
    if (drawing) {
      gestureRef.current = { type: 'draw' };
      const stroke = { tool, points: [svgPoint(e)] };
      strokeRef.current = stroke;
      setCurrentStroke(stroke);
    } else {
      gestureRef.current = {
        type: 'pan', startX: e.clientX, startY: e.clientY,
        base: { ...transformRefLatest.current },
      };
    }
  }

  // Keep the latest transform readable inside pointer handlers without
  // re-binding them every state change.
  const transformRefLatest = useRef(transform);
  transformRefLatest.current = transform;

  function onPointerMove(e) {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gestureRef.current;
    if (!g) return;

    if (g.type === 'pinch' && pointersRef.current.size === 2) {
      const p = pinchState();
      const scale = clamp(g.start.scale * (p.dist / g.startDist), MIN_ZOOM, MAX_ZOOM);
      if (scale === 1) setTransform({ scale: 1, tx: 0, ty: 0 });
      else {
        setTransform({
          scale,
          tx: g.start.tx + (p.midX - g.startMid.midX),
          ty: g.start.ty + (p.midY - g.startMid.midY),
        });
      }
    } else if (g.type === 'draw' && strokeRef.current) {
      const pt = svgPoint(e);
      const pts = strokeRef.current.points;
      const last = pts[pts.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 1.2) {
        strokeRef.current = { ...strokeRef.current, points: [...pts, pt] };
        setCurrentStroke(strokeRef.current);
      }
    } else if (g.type === 'pan') {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (g.base.scale > 1) {
        setTransform({ scale: g.base.scale, tx: g.base.tx + dx, ty: g.base.ty + dy });
      }
    }
  }

  function onPointerUp(e) {
    pointersRef.current.delete(e.pointerId);
    const g = gestureRef.current;
    if (!g) return;
    if (g.type === 'draw') {
      if (strokeRef.current && strokeRef.current.points.length > 1) {
        onAddStroke(strokeRef.current);
      }
      strokeRef.current = null;
      setCurrentStroke(null);
      gestureRef.current = null;
    } else if (g.type === 'pan') {
      // At 1x, a mostly-horizontal drag is a page-turn swipe (tablet use).
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (g.base.scale === 1 && Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) {
        onPageChange(dx < 0 ? 1 : -1);
      }
      gestureRef.current = null;
    } else if (g.type === 'pinch' && pointersRef.current.size < 2) {
      gestureRef.current = null;
    }
  }

  const style = STROKE_STYLE;
  const zoneCompact = tool !== 'select';

  return (
    <div className="viewer-outer" ref={outerRef} onDoubleClick={() => setTransform({ scale: 1, tx: 0, ty: 0 })}>
      <div className={`page-chip ${special ? 'special' : ''}`}>{pageLabel}</div>
      <div
        className="viewer-transform"
        style={{ transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})` }}
      >
        <div className="viewer-wrap" style={dims ? { width: dims.wrapW, height: dims.wrapH } : undefined}>
          <canvas className="page-canvas" ref={canvasRef} />
          {dims && (
            <svg
              ref={overlayRef}
              className={`overlay-svg ${tool !== 'select' && canDraw ? 'drawing' : 'panning'}`}
              viewBox={`0 0 ${dims.widthPts} ${dims.heightPts}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {(strokes || []).map((s, i) => (
                <path
                  key={i}
                  d={pointsToD(s.points)}
                  stroke={style[s.tool].color}
                  strokeWidth={style[s.tool].width}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {currentStroke && (
                <path
                  d={pointsToD(currentStroke.points)}
                  stroke={style[currentStroke.tool].color}
                  strokeWidth={style[currentStroke.tool].width}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          )}
        </div>
      </div>
      {/* On-canvas page-turn regions: full-height zones in select mode,
          compact floating chevrons while a drawing tool is active (so they
          don't eat edge strokes). */}
      <button
        className={`nav-zone left ${zoneCompact ? 'compact' : ''}`}
        disabled={pageIndex === 0}
        onClick={() => onPageChange(-1)}
        aria-label="Previous page"
      >‹</button>
      <button
        className={`nav-zone right ${zoneCompact ? 'compact' : ''}`}
        disabled={pageIndex >= numPages - 1}
        onClick={() => onPageChange(1)}
        aria-label="Next page"
      >›</button>
    </div>
  );
}
