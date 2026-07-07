import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { renderThumbnail } from '../lib/pdfEngine.js';
import { displayName } from '../lib/naming.js';
import { playMergeDing, playNope } from '../lib/sound.js';
import { saveFiling } from '../lib/mergeSave.js';

// Filing Mode: the iOS-folders-style merge game. Everything here is a LOCAL
// working arrangement — cards merge, stack and nest freely, with undo —
// and nothing touches Drive until the explicit Save step (mergeSave.js).

const LEVEL = { file: 0, doc: 1, folder: 2, box: 3 };

// What happens if `dragged` lands on `target`? null = invalid.
function mergeType(target, dragged) {
  const t = LEVEL[target.kind];
  const d = LEVEL[dragged.kind];
  if (t === 0 && d === 0) return 'newDoc';
  if (t === 1 && d === 0) return 'addPage';
  if (t === 0 && d === 1) return 'addPageReverse';
  if (t === 1 && d === 1) return 'newFolder';
  if (t === 2 && d <= 1) return 'addToFolder';
  if (t === 2 && d === 2) return 'newBox';
  if (t === 3 && d === 2) return 'addToBox';
  return null;
}

function Thumb({ fileId, backend, className }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let on = true;
    renderThumbnail(fileId, () => backend.getPdfBytes(fileId))
      .then((u) => { if (on) setUrl(u); })
      .catch(() => {});
    return () => { on = false; };
  }, [fileId, backend]);
  return url
    ? <img src={url} className={className} alt="" draggable={false} />
    : <div className={className} />;
}

function countStats(items) {
  let files = 0, docs = 0, folders = 0, boxes = 0;
  for (const i of items) {
    if (i.kind === 'file') files++;
    else if (i.kind === 'doc') docs++;
    else if (i.kind === 'folder') folders++;
    else if (i.kind === 'box') { boxes++; folders += i.folders.length; }
  }
  return { files, docs, folders, boxes };
}

export default function FilingMode({ backend, nodes, version, scopeId, roots, user, onReload }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [drag, setDrag] = useState(null); // {itemId, x, y}
  const [flying, setFlying] = useState(null); // ghost animating to a point
  const [dropId, setDropId] = useState(null);
  const [invalidHoverId, setInvalidHoverId] = useState(null);
  const [popId, setPopId] = useState(null);
  const [shakeId, setShakeId] = useState(null);
  const [titleEditId, setTitleEditId] = useState(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [progress, setProgress] = useState(null); // null | string[]
  const [destCollection, setDestCollection] = useState('');
  const [destArchive, setDestArchive] = useState('');

  const counterRef = useRef(1);
  const dragRef = useRef(null);
  const undoStack = useRef([]);

  const scopeNode = scopeId ? nodes.get(scopeId) : null;

  // Build the card table from the chosen folder's files (all descendants,
  // flattened — filing is about loose scans wherever they sit in the tree).
  const rebuild = useCallback(() => {
    const files = [];
    const walk = (id, path) => {
      const n = nodes.get(id);
      if (!n) return;
      if (!n.isFolder) { files.push({ node: n, path }); return; }
      const sub = id === scopeId ? '' : (path ? `${path} / ${n.name}` : n.name);
      n.children.forEach((c) => walk(c, sub));
    };
    if (scopeId && nodes.get(scopeId)) walk(scopeId, '');
    files.sort((a, b) => (a.node.parsed?.capturedAt || '').localeCompare(b.node.parsed?.capturedAt || ''));
    setItems(files.map((f) => ({
      kind: 'file',
      id: `w${counterRef.current++}`,
      fileId: f.node.id,
      name: displayName(f.node.name, f.node.parsed),
      capturedAt: f.node.parsed?.capturedAt || '',
      srcPath: f.path,
    })));
    setSelected(new Set());
    undoStack.current = [];
  }, [nodes, scopeId]);

  // Rebuild when the scope changes or the corpus is reloaded (new Map
  // identity). In-session version bumps do NOT rebuild — that would wipe
  // an arrangement in progress.
  useEffect(() => { rebuild(); }, [rebuild]);

  const pushUndo = () => {
    undoStack.current.push(JSON.stringify(items));
    if (undoStack.current.length > 100) undoStack.current.shift();
  };

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev) {
      setItems(JSON.parse(prev));
      setSelected(new Set());
    }
  }, [items]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  function nextLabel(kind) {
    let max = 0;
    const scan = (arr) => arr.forEach((i) => {
      if (i.kind === kind) {
        const n = parseInt(i.label, 10);
        if (!Number.isNaN(n)) max = Math.max(max, n);
      }
      if (i.kind === 'box') scan(i.folders);
      if (i.kind === 'folder') scan(i.items);
    });
    scan(items);
    return String(max + 1);
  }

  function applyMerge(targetId, draggedId) {
    const target = items.find((i) => i.id === targetId);
    const dragged = items.find((i) => i.id === draggedId);
    const type = mergeType(target, dragged);
    if (!type) return;
    pushUndo();
    const nid = () => `w${counterRef.current++}`;
    const rest = items.filter((i) => i.id !== draggedId);
    let replacement = null;
    let editTitle = null;

    switch (type) {
      case 'newDoc':
        replacement = { kind: 'doc', id: nid(), title: '', pageFileIds: [target.fileId, dragged.fileId] };
        editTitle = replacement.id;
        break;
      case 'addPage':
        replacement = { ...target, pageFileIds: [...target.pageFileIds, dragged.fileId] };
        break;
      case 'addPageReverse':
        replacement = { kind: 'doc', id: nid(), title: dragged.title, pageFileIds: [target.fileId, ...dragged.pageFileIds] };
        break;
      case 'newFolder':
        replacement = { kind: 'folder', id: nid(), label: nextLabel('folder'), items: [target, dragged] };
        break;
      case 'addToFolder':
        replacement = { ...target, items: [...target.items, dragged] };
        break;
      case 'newBox':
        replacement = { kind: 'box', id: nid(), label: nextLabel('box'), folders: [target, dragged] };
        break;
      case 'addToBox':
        replacement = { ...target, folders: [...target.folders, dragged] };
        break;
      default:
        return;
    }
    setItems(rest.map((i) => (i.id === targetId ? replacement : i)));
    setSelected(new Set());
    playMergeDing();
    setPopId(replacement.id);
    setTimeout(() => setPopId(null), 400);
    if (editTitle) setTitleEditId(editTitle);
  }

  // Multi-select merge: files/docs combine into one document ordered by
  // captured_at (the handoff's rule for select-several-then-merge);
  // folders combine into a box.
  const selectedItems = items.filter((i) => selected.has(i.id));
  const canMergeSelection = selected.size >= 2 && (
    selectedItems.every((i) => i.kind === 'file' || i.kind === 'doc') ||
    selectedItems.every((i) => i.kind === 'folder')
  );

  function itemCapturedAt(item) {
    if (item.kind === 'file') return item.capturedAt;
    const first = item.pageFileIds[0];
    return nodes.get(first)?.parsed?.capturedAt || '';
  }

  function mergeSelection() {
    if (!canMergeSelection) return;
    pushUndo();
    const nid = `w${counterRef.current++}`;
    const rest = items.filter((i) => !selected.has(i.id));
    const firstIdx = items.findIndex((i) => selected.has(i.id));
    let merged;
    if (selectedItems[0].kind === 'folder') {
      merged = { kind: 'box', id: nid, label: nextLabel('box'), folders: selectedItems };
    } else {
      const ordered = [...selectedItems].sort((a, b) => itemCapturedAt(a).localeCompare(itemCapturedAt(b)));
      merged = {
        kind: 'doc', id: nid, title: '',
        pageFileIds: ordered.flatMap((i) => (i.kind === 'file' ? [i.fileId] : i.pageFileIds)),
      };
      setTitleEditId(nid);
    }
    rest.splice(firstIdx, 0, merged);
    setItems(rest);
    setSelected(new Set());
    playMergeDing();
    setPopId(nid);
    setTimeout(() => setPopId(null), 400);
  }

  // ── Pointer-based drag (custom, not HTML5 DnD — we need full control of
  //    the ghost, the target pulse, and the fly-in animation) ──────────────
  function onCardPointerDown(e, item) {
    if (e.button !== 0) return;
    if (e.target.closest('input, button, textarea')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      itemId: item.id, startX: e.clientX, startY: e.clientY,
      originRect: rect, started: false,
    };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.started && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) > 7) {
        d.started = true;
      }
      if (d.started) {
        setDrag({ itemId: d.itemId, x: ev.clientX, y: ev.clientY });
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const cardEl = el?.closest('[data-card-id]');
        const overId = cardEl?.getAttribute('data-card-id');
        if (overId && overId !== d.itemId) {
          const target = items.find((i) => i.id === overId);
          const dragged = items.find((i) => i.id === d.itemId);
          if (target && dragged && mergeType(target, dragged)) {
            setDropId(overId); setInvalidHoverId(null);
          } else {
            setDropId(null); setInvalidHoverId(overId);
          }
        } else {
          setDropId(null); setInvalidHoverId(null);
        }
      }
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (!d.started) {
        // Plain click: toggle selection.
        setSelected((s) => {
          const next = new Set(s);
          if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
          return next;
        });
        setDrag(null);
        return;
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const overId = el?.closest('[data-card-id]')?.getAttribute('data-card-id');
      const target = overId && overId !== d.itemId ? items.find((i) => i.id === overId) : null;
      const dragged = items.find((i) => i.id === d.itemId);
      const valid = target && dragged && mergeType(target, dragged);

      if (valid) {
        // The iOS-folder moment: ghost dives into the target, then the
        // merged card pops and the chime plays (inside applyMerge).
        const rect = el.closest('[data-card-id]').getBoundingClientRect();
        setFlying({
          itemId: d.itemId,
          x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
          scale: 0.15, opacity: 0.5,
        });
        setTimeout(() => {
          setFlying(null); setDrag(null); setDropId(null); setInvalidHoverId(null);
          applyMerge(overId, d.itemId);
        }, 170);
      } else {
        if (target) {
          playNope();
          setShakeId(overId);
          setTimeout(() => setShakeId(null), 350);
        }
        // Fly back home.
        setFlying({
          itemId: d.itemId,
          x: d.originRect.left + d.originRect.width / 2,
          y: d.originRect.top + d.originRect.height / 2,
          scale: 1, opacity: 0.3,
        });
        setTimeout(() => { setFlying(null); setDrag(null); setDropId(null); setInvalidHoverId(null); }, 180);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function setDocTitle(id, title) {
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, title } : i)));
  }

  function setLabel(id, label) {
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, label } : i)));
  }

  function firstFileId(item) {
    if (item.kind === 'file') return item.fileId;
    if (item.kind === 'doc') return item.pageFileIds[0];
    if (item.kind === 'folder') return item.items.length ? firstFileId(item.items[0]) : null;
    return item.folders.length ? firstFileId(item.folders[0]) : null;
  }

  function renderCard(item) {
    const classes = [
      'card', item.kind,
      selected.has(item.id) ? 'selected' : '',
      dropId === item.id ? 'drop-target' : '',
      drag?.itemId === item.id ? 'dragging-src' : '',
      popId === item.id ? 'merge-pop' : '',
      shakeId === item.id || (invalidHoverId === item.id && drag) ? 'shake' : '',
    ].filter(Boolean).join(' ');

    return (
      <div
        key={item.id}
        className={classes}
        data-card-id={item.id}
        onPointerDown={(e) => onCardPointerDown(e, item)}
      >
        <span className="select-dot" />
        {item.kind === 'file' && (
          <>
            <Thumb fileId={item.fileId} backend={backend} className="thumb" />
            <div className="card-name">{item.name}</div>
            {item.srcPath && <div className="src-chip" title={item.srcPath}>{item.srcPath}</div>}
          </>
        )}
        {item.kind === 'doc' && (
          <>
            <span className="pages-badge">{item.pageFileIds.length} pp</span>
            <Thumb fileId={item.pageFileIds[0]} backend={backend} className="thumb" />
            <input
              className="title-input"
              placeholder="Title (optional)…"
              value={item.title}
              autoFocus={titleEditId === item.id}
              onFocus={() => setTitleEditId(null)}
              onChange={(e) => setDocTitle(item.id, e.target.value)}
            />
          </>
        )}
        {item.kind === 'folder' && (
          <>
            <div className="card-label">
              📂 Folder
              <input value={item.label} onChange={(e) => setLabel(item.id, e.target.value)} />
            </div>
            <div className="mini-grid">
              {item.items.slice(0, 4).map((sub) => (
                firstFileId(sub)
                  ? <Thumb key={sub.id} fileId={firstFileId(sub)} backend={backend} className="mini-thumb" />
                  : <div key={sub.id} className="mini-more">·</div>
              ))}
              {item.items.length > 4 && <div className="mini-more">+{item.items.length - 4}</div>}
            </div>
            <div className="contents-note">
              {item.items.length} document{item.items.length === 1 ? '' : 's'}
            </div>
          </>
        )}
        {item.kind === 'box' && (
          <>
            <div className="card-label">
              📦 Box
              <input value={item.label} onChange={(e) => setLabel(item.id, e.target.value)} />
            </div>
            <div className="contents-note">
              {item.folders.map((f) => `Folder ${f.label} (${f.items.length})`).join(' · ')}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Save ────────────────────────────────────────────────────────────────
  const stats = countStats(items);
  const savable = items.some((i) => i.kind !== 'file');

  const loadedCollections = useMemo(() => {
    const set = new Set();
    for (const n of nodes.values()) {
      if (!n.isFolder && n.parsed?.collection) set.add(n.parsed.collection);
    }
    for (const r of roots) {
      const m = nodes.get(r.id)?.name.match(/^Archive Capture — (.+)$/);
      if (m) set.add(m[1]);
    }
    return [...set];
  }, [nodes, version, roots]);

  function openSave() {
    // Prefill destination from a loaded collection when there is one.
    const guess = loadedCollections[0] || '';
    setDestCollection((c) => c || guess);
    if (guess && !destArchive) {
      for (const n of nodes.values()) {
        if (!n.isFolder && n.parsed?.collection === guess && n.parsed.archiveName) {
          setDestArchive(n.parsed.archiveName);
          break;
        }
      }
    }
    setSaveOpen(true);
  }

  const destRoot = useMemo(() => {
    for (const r of roots) {
      const n = nodes.get(r.id);
      if (n && n.name === `Archive Capture — ${destCollection.trim()}`) return n;
    }
    return null;
  }, [roots, nodes, destCollection, version]);

  async function runSave() {
    setProgress([]);
    const log = (msg) => setProgress((p) => [...(p || []), msg]);
    try {
      const res = await saveFiling({
        backend, nodes,
        plan: items,
        destination: {
          collection: destCollection.trim(),
          archiveName: destArchive.trim(),
          rootFolderId: destRoot?.id || null,
        },
        onProgress: log,
      });
      log(`Filed ${res.filed} document${res.filed === 1 ? '' : 's'} (${res.merged} merged). Refreshing…`);
      await onReload();
    } catch (err) {
      log(`❌ Save failed: ${err.message || err}`);
    }
  }

  if (!scopeNode) {
    return (
      <div className="filing-main">
        <div className="empty-state">Pick a folder in the explorer to start filing.</div>
      </div>
    );
  }

  const flyingStyle = flying && {
    left: flying.x - 75, top: flying.y - 40,
    transform: `scale(${flying.scale})`, opacity: flying.opacity,
  };
  const dragStyle = drag && !flying && { left: drag.x - 75, top: drag.y - 40 };
  const ghostItem = drag ? items.find((i) => i.id === drag.itemId) : null;

  return (
    <div className="filing-main" style={{ position: 'relative' }}>
      <div className="filing-head">
        <h2>Filing: {scopeNode.name}</h2>
        <span className="hint">
          Drag a page onto another to merge them into a document · documents merge into
          Folders · Folders into Boxes. Click to multi-select. Nothing is written until you hit Save.
        </span>
      </div>
      <div className="filing-grid">
        {items.map(renderCard)}
        {items.length === 0 && (
          <div className="empty-state" style={{ width: '100%' }}>
            No files under this folder. Pick another folder in the explorer.
          </div>
        )}
      </div>

      {ghostItem && (
        <div className={`ghost-card ${flying ? 'flying' : ''}`} style={flyingStyle || dragStyle}>
          {ghostItem.kind === 'file' || ghostItem.kind === 'doc' ? (
            <div className="card">
              <Thumb fileId={firstFileId(ghostItem)} backend={backend} className="thumb" />
            </div>
          ) : (
            <div className={`card ${ghostItem.kind}`}>
              <div className="card-label">{ghostItem.kind === 'folder' ? '📂' : '📦'} {ghostItem.label}</div>
            </div>
          )}
        </div>
      )}

      <div className="filing-bar">
        <span className="stats">
          {stats.files} loose · {stats.docs} docs · {stats.folders} folders · {stats.boxes} boxes
        </span>
        {selected.size >= 2 && (
          <button className="btn" disabled={!canMergeSelection} onClick={mergeSelection}>
            ⧉ Merge {selected.size} selected
          </button>
        )}
        <span className="spacer" />
        <button className="btn" disabled={!undoStack.current.length} onClick={undo}>↩ Undo</button>
        <button className="btn" onClick={rebuild}>Reset arrangement</button>
        <button className="btn primary" disabled={!savable} onClick={openSave}>
          {backend.kind === 'demo' ? 'Save (sample)' : 'Save to Drive'}
        </button>
      </div>

      {saveOpen && (
        <div className="modal-overlay" onClick={() => !progress && setSaveOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Save this arrangement</h3>
            <div className="field">
              <label>Collection</label>
              <input
                list="collections-list"
                value={destCollection}
                onChange={(e) => setDestCollection(e.target.value)}
                placeholder="e.g. Good Poems"
              />
              <datalist id="collections-list">
                {loadedCollections.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="field">
              <label>Archive Name (optional)</label>
              <input value={destArchive} onChange={(e) => setDestArchive(e.target.value)} placeholder="e.g. Five Forks" />
            </div>
            <div className="note">
              {destRoot
                ? <>Filing into the existing collection folder <b>{destRoot.name}</b>.</>
                : <>A new Drive folder <b>Archive Capture — {destCollection.trim() || '…'}</b> will be created.</>}
              {' '}Boxes and Folders become real nested folders; merged documents become single
              multi-page PDFs named the same way the mobile app names them, tags/comments/OMG
              flags carried over. Sources of merged documents go to the Drive trash.
              {stats.files > 0 && <> {stats.files} loose file{stats.files === 1 ? ' stays' : 's stay'} where they are.</>}
            </div>
            {progress && (
              <div className="progress-log">
                {progress.map((line, i) => <div key={i}>{line}</div>)}
              </div>
            )}
            <div className="modal-actions">
              {progress && progress.some((l) => l.startsWith('Filed')) ? (
                <button className="btn primary" onClick={() => { setSaveOpen(false); setProgress(null); }}>
                  Done
                </button>
              ) : (
                <>
                  <button className="btn" disabled={Boolean(progress)} onClick={() => setSaveOpen(false)}>Cancel</button>
                  <button
                    className="btn primary"
                    disabled={Boolean(progress) || !destCollection.trim()}
                    onClick={runSave}
                  >
                    Save
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
