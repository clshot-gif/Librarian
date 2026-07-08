import { useEffect, useMemo, useRef, useState } from 'react';
import PdfViewer from './PdfViewer.jsx';
import MetadataPanel from './MetadataPanel.jsx';
import { openPdf, invalidateThumbnail } from '../lib/pdfEngine.js';
import { bakeMarkup } from '../lib/markupBake.js';
import { rebuildNotesPage } from '../lib/notesPage.js';
import { serializeProps } from '../lib/metadata.js';
import { displayName } from '../lib/naming.js';
import { refileFile } from '../lib/refile.js';
import { rememberTag } from '../lib/tagStore.js';

// What kind of page is the viewer showing? Content pages are drawable;
// the notes page and the clean-original backups are read-only.
function pageInfo(i, d) {
  if (i < d.pageCount)
    return { label: `Page ${i + 1} of ${d.pageCount}`, canDraw: true, special: false };
  if (d.notesPageIndex !== null && i === d.notesPageIndex) {
    return { label: 'Notes page', canDraw: false, special: true };
  }
  const notesShift = d.notesPageIndex !== null ? 1 : 0;
  const orig = d.unmarkedBackupPages[i - d.pageCount - notesShift];
  return {
    label: orig !== undefined ? `Clean original of page ${orig + 1}` : 'Extra page',
    canDraw: false,
    special: true,
  };
}

export default function MarkingMode({
  backend,
  nodes,
  roots,
  version,
  fileId,
  user,
  mutate,
  onDirtyChange,
}) {
  const node = fileId ? nodes.get(fileId) : null;
  const [docState, setDocState] = useState(null); // {bytes, pdfjsDoc, numPages}
  const [pageIndex, setPageIndex] = useState(0);
  const [tool, setTool] = useState('select');
  const [strokesByPage, setStrokesByPage] = useState(() => new Map());
  const [draft, setDraft] = useState(null); // editable copy of node.parsed
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const notesChangedRef = useRef(false);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    let cancelled = false;
    let opened = null;
    (async () => {
      if (!fileId) return;
      try {
        const bytes = await backend.getPdfBytes(fileId);
        const pdfjsDoc = await openPdf(bytes);
        opened = pdfjsDoc;
        if (cancelled) {
          pdfjsDoc.destroy();
          return;
        }
        setDocState({ bytes, pdfjsDoc, numPages: pdfjsDoc.numPages });
        setDraft(structuredClone(nodes.get(fileId).parsed));
        setPageIndex(0);
        setStrokesByPage(new Map());
        setDirty(false);
        notesChangedRef.current = false;
      } catch (err) {
        if (!cancelled) setLoadError(`Couldn't open this PDF: ${err.message || err}`);
      }
    })();
    return () => {
      cancelled = true;
      opened?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const info = useMemo(() => (draft ? pageInfo(pageIndex, draft) : null), [pageIndex, draft]);

  function markDirty() {
    setDirty(true);
  }

  function setField(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
    markDirty();
  }

  function currentContentPage() {
    return draft ? Math.min(pageIndex, draft.pageCount - 1) : 0;
  }

  function addComment(text) {
    const entry = {
      page: currentContentPage(),
      text,
      user: user.name,
      ts: new Date().toISOString(),
    };
    setDraft((d) => ({ ...d, comments: [...d.comments, entry] }));
    notesChangedRef.current = true;
    markDirty();
  }

  function addTag(tag) {
    setDraft((d) => {
      if (d.tags.includes(tag)) return d;
      return {
        ...d,
        tags: [...d.tags, tag],
        tagLog: [...d.tagLog, { tag, user: user.name, ts: new Date().toISOString() }],
      };
    });
    rememberTag(draft.collection, tag);
    notesChangedRef.current = true;
    markDirty();
  }

  function removeTag(tag) {
    setDraft((d) => ({
      ...d,
      tags: d.tags.filter((t) => t !== tag),
      tagLog: d.tagLog.filter((e) => e.tag !== tag),
    }));
    notesChangedRef.current = true;
    markDirty();
  }

  function toggleOmg() {
    const page = currentContentPage();
    setDraft((d) => {
      const on = d.omgPages.includes(page);
      return {
        ...d,
        omgPages: on ? d.omgPages.filter((p) => p !== page) : [...d.omgPages, page],
        omgLog: on
          ? d.omgLog.filter((e) => (e.page || 0) !== page)
          : [...d.omgLog, { page, user: user.name, ts: new Date().toISOString() }],
      };
    });
    notesChangedRef.current = true;
    markDirty();
  }

  function addStroke(stroke) {
    setStrokesByPage((m) => {
      const next = new Map(m);
      next.set(pageIndex, [...(next.get(pageIndex) || []), stroke]);
      return next;
    });
    markDirty();
  }

  function undoStroke() {
    setStrokesByPage((m) => {
      const cur = m.get(pageIndex) || [];
      if (!cur.length) return m;
      const next = new Map(m);
      next.set(pageIndex, cur.slice(0, -1));
      return next;
    });
  }

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      let bytes = docState.bytes;
      const d = structuredClone(draft);
      const hasStrokes = [...strokesByPage.values()].some((a) => a.length);
      let pdfChanged = false;

      if (hasStrokes) {
        const res = await bakeMarkup({
          bytes,
          pdfjsDoc: docState.pdfjsDoc,
          strokesByPage,
          parsed: d,
        });
        bytes = res.bytes;
        d.unmarkedBackupPages = res.unmarkedBackupPages;
        d.hasMarkup = true;
        pdfChanged = true;
      }
      if (notesChangedRef.current || hasStrokes) {
        const res = await rebuildNotesPage(bytes, d);
        bytes = res.bytes;
        d.notesPageIndex = res.notesPageIndex;
        pdfChanged = true;
      }
      if (pdfChanged) await backend.putPdfBytes(fileId, bytes);

      // If placement (or title) changed, re-file: move the physical file,
      // rename it, and write properties — all in sync. Otherwise just persist
      // the properties in place. Requires a collection to file under; without
      // one the file stays put and only its metadata is saved.
      const orig = node.parsed || {};
      const placementChanged =
        (orig.archiveName || '') !== (d.archiveName || '') ||
        (orig.collection || '') !== (d.collection || '') ||
        (orig.box || '') !== (d.box || '') ||
        (orig.folder || '') !== (d.folder || '') ||
        (orig.title || '') !== (d.title || '');
      if (placementChanged && (d.collection || '').trim()) {
        await refileFile({ backend, nodes, roots, fileId, parsed: d });
        // refileFile already mutated the tree in place; refresh + re-render.
        mutate(() => {});
      } else {
        await backend.setProperties(fileId, serializeProps(d));
        mutate((n) => {
          n.get(fileId).parsed = d;
        });
      }
      invalidateThumbnail(fileId);

      const newDoc = await openPdf(bytes);
      docState.pdfjsDoc.destroy();
      setDocState({ bytes, pdfjsDoc: newDoc, numPages: newDoc.numPages });
      setDraft(d);
      setStrokesByPage(new Map());
      setPageIndex((p) => Math.min(p, newDoc.numPages - 1));
      notesChangedRef.current = false;
      setDirty(false);
    } catch (err) {
      alert(`Save failed: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  }

  if (!fileId || !node) {
    return (
      <div className="marking-main">
        <div className="empty-state">
          <div style={{ fontSize: 40 }}>🗂️</div>
          <div>Pick a document in the explorer to start reviewing.</div>
          <div style={{ fontSize: 12.5 }}>
            The yellow glow marks where the most tags, comments, and OMG flags live.
          </div>
        </div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="marking-main">
        <div className="empty-state">{loadError}</div>
      </div>
    );
  }
  if (!docState || !draft) {
    return (
      <div className="marking-main">
        <div className="empty-state">
          <div className="spinner" />
          <div>Opening document…</div>
        </div>
      </div>
    );
  }

  const pageStrokes = strokesByPage.get(pageIndex) || [];

  return (
    <div className="marking-main">
      <div className="savebar">
        <span className="doc-title" title={node.name}>
          {displayName(node.name, draft)}
        </span>
        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        <span className="spacer" />
        <button className="btn primary" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? 'Saving…' : backend.kind === 'demo' ? 'Save (sample)' : 'Save to Drive'}
        </button>
      </div>

      <div className="viewer-toolbar">
        <button
          className={`tool-btn ${tool === 'select' ? 'active' : ''}`}
          onClick={() => setTool('select')}
        >
          ✥ Pan
        </button>
        <button
          className={`tool-btn ${tool === 'pen' ? 'active' : ''}`}
          disabled={!info.canDraw}
          onClick={() => setTool('pen')}
        >
          ✏️ Pen
        </button>
        <button
          className={`tool-btn ${tool === 'highlighter' ? 'active' : ''}`}
          disabled={!info.canDraw}
          onClick={() => setTool('highlighter')}
        >
          🖍️ Highlight
        </button>
        <button className="tool-btn" disabled={!pageStrokes.length} onClick={undoStroke}>
          ↩ Undo
        </button>
        <span className="toolbar-sep" />
        <button
          className="tool-btn"
          disabled={pageIndex === 0}
          onClick={() => setPageIndex((p) => p - 1)}
        >
          ‹ Prev
        </button>
        <button
          className="tool-btn"
          disabled={pageIndex >= docState.numPages - 1}
          onClick={() => setPageIndex((p) => p + 1)}
        >
          Next ›
        </button>
        <span style={{ color: 'var(--dim)', fontSize: 12.5, marginLeft: 4 }}>
          {info.canDraw
            ? 'Draw with one finger/mouse · pinch or scroll to zoom · double-click resets'
            : 'Read-only page'}
        </span>
      </div>

      <PdfViewer
        pdfjsDoc={docState.pdfjsDoc}
        pageIndex={pageIndex}
        numPages={docState.numPages}
        pageLabel={info.label}
        special={info.special}
        tool={info.canDraw ? tool : 'select'}
        canDraw={info.canDraw}
        strokes={pageStrokes}
        onAddStroke={addStroke}
        onPageChange={(delta) =>
          setPageIndex((p) => Math.max(0, Math.min(docState.numPages - 1, p + delta)))
        }
      />

      <MetadataPanel
        draft={draft}
        nodes={nodes}
        version={version}
        currentPage={currentContentPage()}
        user={user}
        onField={setField}
        onAddComment={addComment}
        onAddTag={addTag}
        onRemoveTag={removeTag}
        onToggleOmg={toggleOmg}
      />
    </div>
  );
}
