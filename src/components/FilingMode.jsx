import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { renderThumbnail } from '../lib/pdfEngine.js';
import { displayName } from '../lib/naming.js';
import { playMergeDing, playNope, playExplode, playLevelWin, playGrandWin } from '../lib/sound.js';
import { saveFiling } from '../lib/mergeSave.js';
import {
  KINDS,
  LEVEL,
  KIND_LABEL,
  addNode,
  buildModel,
  applyFindingAid,
  dropOperation,
  applyDrop,
  mergeSelection,
  explodeNode,
  separatePage,
  gatherBack,
  removeContainer,
  ancestry,
  childrenOf,
  computeCompleteness,
  suggestTargets,
  buildSavePlan,
} from '../lib/filingModel.js';
import { parseManifest } from '../lib/findingAid.js';
import demoSeed from '../lib/findingAidSeed.json';

// Filing Mode, redesigned: six columns — Raw page → File → Folder → Box →
// Collection → Archive — where dropping a card on a level resolves that
// level's metadata in the same motion. Everything is a LOCAL working
// arrangement with undo; nothing touches Drive until the explicit Save
// (mergeSave.js). The data model lives in lib/filingModel.js; this file is
// rendering, drag mechanics, and feedback (sound + animation).

const KIND_ICON = { folder: '📂', box: '📦', collection: '🗃', archive: '🏛' };
const clone = (m) => JSON.parse(JSON.stringify(m));

// Session-scoped "don't ask me again" for the page-separation confirm. A
// module-level flag (not React state) is deliberate: it should persist across
// data reloads and mode switches for the whole time the site is loaded, and
// reset only on a full browser reload — exactly what Carter asked for.
let explodeConfirmSuppressed = false;

function Thumb({ fileId, pageIndex = 0, backend, className, size = 150 }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let on = true;
    renderThumbnail(fileId, () => backend.getPdfBytes(fileId), size, pageIndex)
      .then((u) => {
        if (on) setUrl(u);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [fileId, pageIndex, backend, size]);
  return url ? (
    <img src={url} className={className} alt="" draggable={false} />
  ) : (
    <div className={className} />
  );
}

// The compact "where does this sit" row under a card: resolved levels show
// their value, deliberately-skipped ones are struck through, unresolved ones
// glow as ?, unplaced ones are dim dots. This is the metadata the drop
// resolved, made visible.
function Chips({ model, id }) {
  const chain = ancestry(model, id);
  if (!chain.length) return null;
  return (
    <div className="chips">
      {[...chain].reverse().map((seg, i) => {
        if (seg.state === 'resolved') {
          return (
            <span key={i} className={`chip ${seg.unnamed ? 'chip-q' : ''}`} title={seg.kind}>
              {seg.unnamed ? '(name?)' : seg.name}
            </span>
          );
        }
        if (seg.state === 'unresolved' || seg.state === 'unresolved-parent') {
          return (
            <span key={i} className="chip chip-q" title={`${KIND_LABEL[seg.kind]} unresolved`}>
              ?
            </span>
          );
        }
        if (seg.state === 'skipped') {
          return (
            <span
              key={i}
              className="chip chip-skip"
              title={`${KIND_LABEL[seg.kind]} skipped on purpose`}
            >
              {KIND_LABEL[seg.kind]}
            </span>
          );
        }
        return (
          <span key={i} className="chip chip-dim" title={`${KIND_LABEL[seg.kind]} not placed yet`}>
            ·
          </span>
        );
      })}
    </div>
  );
}

export default function FilingMode({ backend, nodes, scopeId, roots, onReload }) {
  const [model, setModel] = useState(null);
  const [allScopes, setAllScopes] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [drag, setDrag] = useState(null); // {itemId, x, y}
  const [flying, setFlying] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // drop descriptor key
  const [invalidHover, setInvalidHover] = useState(null);
  const [suggested, setSuggested] = useState(() => new Set());
  const [popId, setPopId] = useState(null);
  const [shakeId, setShakeId] = useState(null);
  const [spillIds, setSpillIds] = useState(() => new Set());
  const [winIds, setWinIds] = useState(() => new Set());
  const [grandWin, setGrandWin] = useState(false);
  const [focusNameId, setFocusNameId] = useState(null);
  const [editingName, setEditingName] = useState(null);
  const [aidInfo, setAidInfo] = useState(null); // array of parsed aids, or null
  const [focusedCollectionId, setFocusedCollectionId] = useState(null); // null = show all
  const [saveOpen, setSaveOpen] = useState(false);
  const [progress, setProgress] = useState(null);
  // Enlarged preview: a drill-down stack of node ids (last = what's shown).
  const [preview, setPreview] = useState(null);
  const [explodeConfirm, setExplodeConfirm] = useState(null); // {fileId, ordinal}
  const [dontAskExplode, setDontAskExplode] = useState(false);

  const dragRef = useRef(null);
  const undoStack = useRef([]);
  const prevCompRef = useRef(null);
  const aidRef = useRef(null);
  const editUndoPushed = useRef(false);
  const fileInputRef = useRef(null);

  const getParsed = useCallback((fid) => nodes.get(fid)?.parsed, [nodes]);
  const scopeNode = scopeId ? nodes.get(scopeId) : null;

  // ── Build / rebuild the workspace ────────────────────────────────────────
  const rebuild = useCallback(() => {
    const scopes = allScopes ? roots.map((r) => r.id) : scopeId ? [scopeId] : [];
    const state = buildModel(nodes, scopes);
    // Demo mode ships with the real FWHC finding-aid seed pre-loaded, the
    // same way the rest of the app demos everything against sample data.
    if (!aidRef.current && backend.kind === 'demo') {
      try {
        aidRef.current = parseManifest(demoSeed);
      } catch {
        aidRef.current = null;
      }
    }
    if (aidRef.current) {
      for (const aid of aidRef.current) applyFindingAid(state, aid);
      setAidInfo(aidRef.current);
    }
    setModel(state);
    setSelected(new Set());
    undoStack.current = [];
    prevCompRef.current = null; // no win fanfare for arrangements loaded complete
  }, [nodes, scopeId, allScopes, roots, backend]);

  useEffect(() => {
    rebuild();
  }, [rebuild]);

  // ── Mutation helpers (undo = JSON snapshots, like the rest of the app) ──
  const pushUndo = useCallback(() => {
    if (!model) return;
    undoStack.current.push(JSON.stringify(model));
    if (undoStack.current.length > 100) undoStack.current.shift();
  }, [model]);

  const mutate = (fn) => {
    pushUndo();
    setModel((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });
  };
  // For per-keystroke edits: the undo snapshot is pushed once when the
  // input gains focus, not per character.
  const softMutate = (fn) =>
    setModel((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev) {
      setModel(JSON.parse(prev));
      setSelected(new Set());
    }
  }, []);

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

  // ── Completeness → win feedback ──────────────────────────────────────────
  const completeness = useMemo(() => (model ? computeCompleteness(model) : null), [model]);

  useEffect(() => {
    if (!model || !completeness) return;
    if (editingName) return; // judge names on blur, not per keystroke
    if (!prevCompRef.current) {
      prevCompRef.current = completeness;
      return;
    }
    const prev = prevCompRef.current;
    const newly = [...completeness.complete].filter(
      (id) => !prev.complete.has(id) && model.nodes[id],
    );
    if (newly.length) {
      setWinIds(new Set(newly));
      const maxLevel = Math.max(...newly.map((id) => LEVEL[model.nodes[id].kind]));
      playLevelWin(maxLevel);
      setTimeout(() => setWinIds(new Set()), 1500);
    }
    if (completeness.global && !prev.global) {
      setGrandWin(true);
      playGrandWin();
    }
    prevCompRef.current = completeness;
  }, [model, completeness, editingName]);

  // ── Column contents ──────────────────────────────────────────────────────
  const columns = useMemo(() => {
    if (!model) return null;
    const cols = { raw: [], file: [], folder: [], box: [], collection: [], archive: [] };
    const all = Object.values(model.nodes);
    // Collection focus: when a collection is selected in the switcher, only
    // its slots show (a trip can load many collections; you work one at a
    // time). The "to file" pool — Unclassified pages and loose files being
    // built — always shows regardless of focus. Guard against a stale id.
    const focusColl =
      focusedCollectionId && model.nodes[focusedCollectionId] ? focusedCollectionId : null;
    const collectionOf = (id) => {
      let cur = model.nodes[id];
      while (cur) {
        if (cur.kind === 'collection') return cur.id;
        cur = cur.parentId != null ? model.nodes[cur.parentId] : null;
      }
      return null;
    };
    const inFocus = (n) => {
      if (!focusColl) return true;
      if (n.kind === 'raw') return true; // Unclassified pool is shared
      if (n.kind === 'file' && n.parentId === null) return true; // loose, being built
      if (n.kind === 'collection') return n.id === focusColl;
      if (n.kind === 'archive')
        return all.some(
          (c) => c.kind === 'collection' && c.id === focusColl && c.parentId === n.id,
        );
      return collectionOf(n.id) === focusColl;
    };
    const spillCounts = new Map();
    for (const n of all) {
      if (n.parentId === null && n.origin) {
        spillCounts.set(n.origin, (spillCounts.get(n.origin) || 0) + 1);
      }
    }
    // Deliberately-skipped items (nested 2+ levels above their natural
    // parent, e.g. a page dropped straight onto a Collection) stay visible
    // as cards in their own column — struck-through chips mark the skipped
    // levels, and they stay draggable if the user later fills the gap in.
    const skippedFlat = (n) =>
      n.parentId !== null &&
      !n.bucket &&
      model.nodes[n.parentId] &&
      LEVEL[model.nodes[n.parentId].kind] - LEVEL[n.kind] >= 2;
    for (const n of all) {
      if (!inFocus(n)) continue;
      if (n.kind === 'raw') {
        if (n.parentId === null || skippedFlat(n)) {
          cols.raw.push({ key: n.id, type: 'card', node: n });
        }
      } else if (n.kind === 'file') {
        const pages = childrenOf(model, n.id);
        const shell = n.materialized && pages.length === 0;
        const partial = spillCounts.has(n.id);
        // Filed files live inside their folder's card; file-column cards are
        // the actionable ones — loose, mid-explode, deliberately skipped, or
        // in a bucket (bucket members render inside the bucket card instead).
        if (n.parentId === null || shell || partial || skippedFlat(n)) {
          if (!n.bucket) cols.file.push({ key: n.id, type: 'card', node: n, shell, partial });
        }
      } else {
        // Containers always show — they're the drop targets.
        cols[n.kind].push({
          key: n.id,
          type: 'card',
          node: n,
          spills: spillCounts.get(n.id) || 0,
        });
      }
    }
    // `?` buckets render one column below their parent, scoped to it.
    for (const n of all) {
      if (LEVEL[n.kind] < 2) continue;
      if (!inFocus(n)) continue;
      const members = childrenOf(model, n.id, { buckets: true });
      if (members.length) {
        cols[KINDS[LEVEL[n.kind] - 1]].push({
          key: `bucket-${n.id}`,
          type: 'bucket',
          parent: n,
          members,
        });
      }
    }
    const pathKey = (id) =>
      ancestry(model, id)
        .map((s) => s.name || s.state)
        .reverse()
        .join('/');
    for (const kind of KINDS) {
      cols[kind].sort((a, b) => {
        const ka = a.type === 'bucket' ? 1 : a.node.parentId === null ? 0 : 2;
        const kb = b.type === 'bucket' ? 1 : b.node.parentId === null ? 0 : 2;
        if (ka !== kb) return ka - kb;
        if (a.type === 'bucket' || b.type === 'bucket') return 0;
        const pa = pathKey(a.node.id) + (a.node.name || '');
        const pb = pathKey(b.node.id) + (b.node.name || '');
        return pa.localeCompare(pb, undefined, { numeric: true });
      });
    }
    return cols;
  }, [model, focusedCollectionId]);

  // ── Drag mechanics (custom pointer drag, same approach as before) ───────
  function dragIdsFor(itemId) {
    return selected.has(itemId) && selected.size > 1 ? [...selected] : [itemId];
  }

  function targetFromElement(el) {
    const dropEl = el?.closest('[data-drop]');
    if (!dropEl) return null;
    try {
      return JSON.parse(dropEl.getAttribute('data-drop'));
    } catch {
      return null;
    }
  }

  function targetKey(t) {
    if (!t) return null;
    return t.type === 'node'
      ? t.id
      : t.type === 'bucket'
        ? `bucket-${t.parentId}`
        : `new-${t.kind}`;
  }

  function anyValid(ids, target) {
    return ids.some((id) => dropOperation(model, id, target));
  }

  function onCardPointerDown(e, node) {
    if (e.button !== 0) return;
    if (e.target.closest('input, button, textarea')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      itemId: node.id,
      startX: e.clientX,
      startY: e.clientY,
      originRect: rect,
      started: false,
    };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.started && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) > 7) {
        d.started = true;
        setSuggested(suggestTargets(model, d.itemId));
      }
      if (d.started) {
        setDrag({ itemId: d.itemId, x: ev.clientX, y: ev.clientY });
        const target = targetFromElement(document.elementFromPoint(ev.clientX, ev.clientY));
        const ids = dragIdsFor(d.itemId);
        const selfDrop = target?.type === 'node' && ids.includes(target.id);
        if (target && !selfDrop && anyValid(ids, target)) {
          setDropTarget(targetKey(target));
          setInvalidHover(null);
        } else {
          setDropTarget(null);
          setInvalidHover(target && !selfDrop ? targetKey(target) : null);
        }
      }
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setSuggested(new Set());
      if (!d) return;
      if (!d.started) {
        setSelected((s) => {
          const next = new Set(s);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
        setDrag(null);
        return;
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = targetFromElement(el);
      const ids = dragIdsFor(d.itemId);
      const selfDrop = target?.type === 'node' && ids.includes(target.id);
      const valid = target && !selfDrop && anyValid(ids, target);

      if (valid) {
        const rect = el.closest('[data-drop]').getBoundingClientRect();
        setFlying({
          itemId: d.itemId,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          scale: 0.15,
          opacity: 0.5,
        });
        setTimeout(() => {
          setFlying(null);
          setDrag(null);
          setDropTarget(null);
          setInvalidHover(null);
          performDrop(ids, target);
        }, 170);
      } else {
        if (target && !selfDrop) {
          playNope();
          setShakeId(targetKey(target));
          setTimeout(() => setShakeId(null), 350);
        }
        setFlying({
          itemId: d.itemId,
          x: d.originRect.left + d.originRect.width / 2,
          y: d.originRect.top + d.originRect.height / 2,
          scale: 1,
          opacity: 0.3,
        });
        setTimeout(() => {
          setFlying(null);
          setDrag(null);
          setDropTarget(null);
          setInvalidHover(null);
        }, 180);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Computed synchronously from the current model (not in a setState
  // updater — updaters must stay pure, and we need the created ids here).
  function performDrop(ids, target) {
    pushUndo();
    const next = clone(model);
    let popKey = targetKey(target);
    let focus = null;
    let effectiveTarget = target;
    for (const id of ids) {
      const res = applyDrop(next, id, effectiveTarget, getParsed);
      if (res?.focusId) {
        focus = res.focusId;
        // Dropping a multi-selection on a "new container" target makes ONE
        // container: the rest of the selection joins it.
        if (effectiveTarget.type === 'new' && next.nodes[res.focusId]) {
          effectiveTarget = { type: 'node', id: res.focusId };
          popKey = res.focusId;
        }
        if (res.op === 'newFile') popKey = res.focusId;
      }
    }
    setModel(next);
    setSelected(new Set());
    playMergeDing();
    setPopId(popKey);
    setTimeout(() => setPopId(null), 400);
    if (focus) setFocusNameId(focus);
  }

  // ── Explode / gather ─────────────────────────────────────────────────────
  function doExplode(id) {
    pushUndo();
    const next = clone(model);
    const spilled = explodeNode(next, id, getParsed);
    setModel(next);
    playExplode();
    setSpillIds(new Set(spilled));
    setTimeout(() => setSpillIds(new Set()), 700);
    setSelected(new Set());
  }

  function doGather(id) {
    mutate((m) => gatherBack(m, id));
    playMergeDing();
    setPopId(id);
    setTimeout(() => setPopId(null), 400);
  }

  // ── Enlarged preview / drill-down ────────────────────────────────────────
  // Double-clicking any card opens it enlarged. Containers show their contents
  // as a grid you can click into (drilling one level down at a time); files
  // show their pages scrollable; a lone page shows itself. Reading only —
  // nothing mutates until you 💥 a page out of a document.
  function openPreview(e, id) {
    if (e.target.closest('input, button, textarea')) return;
    setPreview([id]);
  }

  // The pages of a file, as {fileId, pageIndex} refs, whether the file is
  // still a single pristine Drive PDF or already rebuilt from page nodes.
  function filePageRefs(node) {
    if (node.source) {
      const pc = node.meta?.pageCount || 1;
      return Array.from({ length: pc }, (_, i) => ({ fileId: node.source.fileId, pageIndex: i }));
    }
    return childrenOf(model, node.id).map((p) => ({
      fileId: p.ref.fileId,
      pageIndex: p.ref.pageIndex ?? 0,
    }));
  }

  // 💥 in the document view: separate one page back to Unclassified. Shows the
  // confirm first unless the user opted out this session.
  function requestSeparatePage(fileId, ordinal) {
    if (explodeConfirmSuppressed) doSeparatePage(fileId, ordinal);
    else setExplodeConfirm({ fileId, ordinal });
  }

  function doSeparatePage(fileId, ordinal) {
    pushUndo();
    const next = clone(model);
    const sepId = separatePage(next, fileId, ordinal, getParsed);
    setModel(next);
    playExplode();
    if (sepId) {
      setSpillIds(new Set([sepId]));
      setTimeout(() => setSpillIds(new Set()), 700);
    }
    // If the document is gone or emptied out, back out of its (now stale) view.
    if (!next.nodes[fileId] || childrenOf(next, fileId).length === 0) {
      setPreview((p) => (p && p.length > 1 ? p.slice(0, -1) : null));
    }
  }

  // ── Selection merge (kept gesture: several pages/files → one file) ──────
  const selectedNodes = model ? [...selected].map((id) => model.nodes[id]).filter(Boolean) : [];
  const canMergeSelection =
    selectedNodes.length >= 2 && selectedNodes.every((n) => n.kind === 'raw' || n.kind === 'file');

  function doMergeSelection() {
    if (!canMergeSelection) return;
    pushUndo();
    const next = clone(model);
    const created = mergeSelection(next, [...selected], getParsed);
    setModel(next);
    setSelected(new Set());
    playMergeDing();
    if (created) {
      setPopId(created);
      setFocusNameId(created);
      setTimeout(() => setPopId(null), 400);
    }
  }

  // ── Finding aid loading (any mode) ───────────────────────────────────────
  function onAidFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    file.text().then((text) => {
      try {
        const aids = parseManifest(JSON.parse(text));
        aidRef.current = aids;
        setAidInfo(aids);
        setFocusedCollectionId(null);
        mutate((m) => {
          for (const aid of aids) applyFindingAid(m, aid);
        });
      } catch (err) {
        alert(`Couldn't read that finding aid: ${err.message}`);
      }
    });
  }

  // ── Name / title editing ─────────────────────────────────────────────────
  function nameInput(node, placeholder) {
    return (
      <input
        className="name-input"
        value={node.kind === 'file' ? node.title : node.name}
        placeholder={placeholder}
        ref={(el) => {
          if (el && focusNameId === node.id) {
            el.focus({ preventScroll: true });
            setFocusNameId(null);
          }
        }}
        onFocus={() => {
          setEditingName(node.id);
          if (!editUndoPushed.current) {
            pushUndo();
            editUndoPushed.current = true;
          }
        }}
        onBlur={() => {
          setEditingName(null);
          editUndoPushed.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onChange={(e) => {
          const v = e.target.value;
          softMutate((m) => {
            const n = m.nodes[node.id];
            if (!n) return;
            if (n.kind === 'file') n.title = v;
            else n.name = v;
          });
        }}
      />
    );
  }

  // ── Save ────────────────────────────────────────────────────────────────
  const savePlan = useMemo(() => (model ? buildSavePlan(model) : null), [model]);
  const saveStats = useMemo(() => {
    if (!savePlan) return null;
    let unchanged = 0;
    let toWrite = 0;
    for (const unit of savePlan.units) {
      for (const f of unit.files) {
        const p = f.pristineFileId ? getParsed(f.pristineFileId) : null;
        if (
          p &&
          p.box === unit.box &&
          p.folder === unit.folder &&
          p.collection === unit.collection &&
          p.archiveName === unit.archiveName &&
          (p.title || '') === (f.title || '')
        ) {
          unchanged++;
        } else {
          toWrite++;
        }
      }
    }
    return { unchanged, toWrite };
  }, [savePlan, getParsed]);

  async function runSave() {
    setProgress([]);
    const log = (msg) => setProgress((p) => [...(p || []), msg]);
    let reloadNote = 'Refreshing…';
    try {
      const res = await saveFiling({ backend, nodes, roots, plan: savePlan, onProgress: log });
      if (res.failure) {
        // saveFiling stopped at the first failed write. Nothing was trashed
        // unless its replacement was confirmed written, so the worst case on
        // Drive is a duplicate, never a loss. Spell out exactly where it
        // stopped so this is resumable rather than start-over.
        log(
          `Save stopped: ${res.failure.completed} of ` +
            `${res.failure.completed + 1 + res.failure.notAttempted} documents were fully ` +
            `written before “${res.failure.label}” failed` +
            (res.failure.notAttempted > 0
              ? `; ${res.failure.notAttempted} weren't attempted.`
              : '.'),
        );
        log(
          'No original scans were removed without a confirmed replacement. After the ' +
            'board refreshes, whatever is still unfiled is exactly what remains to save — ' +
            'fix the problem (often just signing in again) and Save again.',
        );
        reloadNote = 'Refreshing to show what actually reached Drive…';
      } else {
        log(
          `Filed ${res.filed} document${res.filed === 1 ? '' : 's'} ` +
            `(${res.merged} assembled, ${res.unchanged} already in place). Refreshing…`,
        );
      }
    } catch (err) {
      // Unexpected (saveFiling reports normal failures in-band) — still
      // reload, so the board never lies about what's on Drive.
      log(`❌ Save failed: ${err.message || err}`);
      reloadNote = 'Refreshing to show what actually reached Drive…';
    }
    try {
      log(reloadNote);
      await onReload();
    } catch (err) {
      log(`❌ Couldn't refresh from Drive: ${err.message || err}. Reload the page to re-sync.`);
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  if (!model || !columns) {
    return (
      <div className="filing-main">
        <div className="empty-state">Loading…</div>
      </div>
    );
  }
  if (!allScopes && !scopeNode) {
    return (
      <div className="filing-main">
        <div className="empty-state">
          Pick a folder in the explorer, or switch on “All loaded folders”.
        </div>
      </div>
    );
  }

  const ghostNode = drag ? model.nodes[drag.itemId] : null;
  const dragCount = drag ? dragIdsFor(drag.itemId).length : 0;
  const flyingStyle = flying && {
    left: flying.x - 70,
    top: flying.y - 45,
    transform: `scale(${flying.scale})`,
    opacity: flying.opacity,
  };
  const dragStyle = drag && !flying && { left: drag.x - 70, top: drag.y - 45 };

  const cardStateClasses = (key, extra = '') =>
    [
      'card',
      extra,
      selected.has(key) ? 'selected' : '',
      dropTarget === key ? 'drop-target' : '',
      suggested.has(key) ? 'suggested' : '',
      drag?.itemId === key ? 'dragging-src' : '',
      popId === key ? 'merge-pop' : '',
      shakeId === key || (invalidHover === key && drag) ? 'shake' : '',
      spillIds.has(key) ? 'spill-in' : '',
      winIds.has(key) ? 'win-pop' : '',
    ]
      .filter(Boolean)
      .join(' ');

  function fileThumbProps(node) {
    if (node.source) return { fileId: node.source.fileId, pageIndex: 0 };
    const pages = childrenOf(model, node.id);
    if (pages.length)
      return { fileId: pages[0].ref.fileId, pageIndex: pages[0].ref.pageIndex ?? 0 };
    return null;
  }

  function renderRawCard(node) {
    const src = nodes.get(node.ref.fileId);
    return (
      <div
        key={node.id}
        className={cardStateClasses(node.id, 'raw-card')}
        data-drop={JSON.stringify({ type: 'node', id: node.id })}
        onPointerDown={(e) => onCardPointerDown(e, node)}
        onDoubleClick={(e) => openPreview(e, node.id)}
      >
        <span className="select-dot" />
        {node.meta?.omg && <span className="omg-flag">OMG</span>}
        <Thumb
          fileId={node.ref.fileId}
          pageIndex={node.ref.pageIndex ?? 0}
          backend={backend}
          className="thumb"
        />
        <div className="card-name">
          {node.ref.pageIndex === null
            ? displayName(src?.name || '', getParsed(node.ref.fileId))
            : `${node.meta?.label || ''} · ${displayName(src?.name || '', getParsed(node.ref.fileId))}`}
        </div>
        <div className="raw-badges">
          {node.meta?.commentCount > 0 && <span className="badge">💬{node.meta.commentCount}</span>}
          {node.meta?.hasBackup && (
            <span className="badge" title="has markup + clean backup">
              ✏️
            </span>
          )}
          {node.origin && model.nodes[node.origin] && (
            <span className="badge origin-badge" title="spilled from an exploded card">
              ⟲
            </span>
          )}
        </div>
        {node.parentId !== null && <Chips model={model} id={node.id} />}
      </div>
    );
  }

  function renderFileCard({ node, shell, partial }) {
    const pages = childrenOf(model, node.id);
    const pageCount = node.source ? node.meta?.pageCount || 1 : pages.length;
    const thumb = fileThumbProps(node);
    return (
      <div
        key={node.id}
        className={cardStateClasses(
          node.id,
          `file-card ${shell ? 'shell' : ''} ${partial ? 'inprogress' : ''}`,
        )}
        data-drop={JSON.stringify({ type: 'node', id: node.id })}
        onPointerDown={(e) => onCardPointerDown(e, node)}
        onDoubleClick={(e) => openPreview(e, node.id)}
      >
        <span className="select-dot" />
        <span className="pages-badge">{pageCount} pp</span>
        {node.origin && model.nodes[node.origin] && (
          <span className="badge origin-badge" title="spilled from an exploded card">
            ⟲
          </span>
        )}
        {thumb ? (
          <Thumb {...thumb} backend={backend} className="thumb" />
        ) : (
          <div className="thumb shell-thumb">⤓ pages out</div>
        )}
        {nameInput(node, 'Title (optional)…')}
        <Chips model={model} id={node.id} />
        <div className="card-actions">
          {pageCount > 1 && !shell && (
            <button
              className="mini-btn"
              title="Explode into pages"
              onClick={() => doExplode(node.id)}
            >
              💥
            </button>
          )}
          {(shell || partial) && (
            <button
              className="mini-btn"
              title="Gather spilled pages back"
              onClick={() => doGather(node.id)}
            >
              ⟲ gather
            </button>
          )}
        </div>
      </div>
    );
  }

  function containerSummary(node) {
    const kids = childrenOf(model, node.id);
    const bucketKids = childrenOf(model, node.id, { buckets: true });
    const parts = [];
    if (node.kind === 'folder') {
      const files = kids.filter((k) => k.kind === 'file' || k.kind === 'raw');
      parts.push(`${files.length} file${files.length === 1 ? '' : 's'}`);
    } else {
      const byKind = {};
      for (const k of kids) byKind[k.kind] = (byKind[k.kind] || 0) + 1;
      for (const [kind, n] of Object.entries(byKind)) {
        const word = KIND_LABEL[kind].toLowerCase();
        parts.push(`${n} ${n === 1 ? word : word === 'box' ? 'boxes' : `${word}s`}`);
      }
      if (!parts.length) parts.push('empty');
    }
    if (bucketKids.length) parts.push(`${bucketKids.length} in ?`);
    return parts.join(' · ');
  }

  function renderContainerCard({ node, spills }) {
    const kids = childrenOf(model, node.id);
    const complete = completeness?.complete.has(node.id);
    const inProgress =
      spills > 0 ||
      kids.some((k) => k.kind === 'file' && k.materialized && !childrenOf(model, k.id).length);
    const removable =
      !node.special && !kids.length && !childrenOf(model, node.id, { buckets: true }).length;
    const filePreviews = node.kind === 'folder' ? kids.filter((k) => k.kind !== 'folder') : [];
    return (
      <div
        key={node.id}
        className={cardStateClasses(
          node.id,
          `${node.kind} ${node.expected ? 'expected' : ''} ${inProgress ? 'inprogress' : ''} ${
            node.special ? 'special' : ''
          }`,
        )}
        data-drop={JSON.stringify({ type: 'node', id: node.id })}
        onPointerDown={(e) => onCardPointerDown(e, node)}
        onDoubleClick={(e) => openPreview(e, node.id)}
      >
        <span className="select-dot" />
        {complete && (
          <span className="complete-badge" title="Everything inside is resolved">
            ✓
          </span>
        )}
        {node.origin && model.nodes[node.origin] && (
          <span className="badge origin-badge" title="spilled from an exploded card">
            ⟲
          </span>
        )}
        <div className="card-label">
          {KIND_ICON[node.kind]}
          {node.special ? (
            <span className="special-name">{node.name}</span>
          ) : (
            nameInput(node, `${KIND_LABEL[node.kind]} name…`)
          )}
        </div>
        {node.kind === 'folder' && filePreviews.length > 0 && (
          <div className="mini-grid">
            {filePreviews.slice(0, 4).map((sub) => {
              const t =
                sub.kind === 'raw'
                  ? { fileId: sub.ref.fileId, pageIndex: sub.ref.pageIndex ?? 0 }
                  : fileThumbProps(sub);
              return t ? (
                <Thumb key={sub.id} {...t} backend={backend} className="mini-thumb" />
              ) : (
                <div key={sub.id} className="mini-more">
                  ⤓
                </div>
              );
            })}
            {filePreviews.length > 4 && <div className="mini-more">+{filePreviews.length - 4}</div>}
          </div>
        )}
        <div className="contents-note">
          {node.expected ? 'expected — from finding aid' : containerSummary(node)}
        </div>
        <Chips model={model} id={node.id} />
        <div className="card-actions">
          {['folder', 'box'].includes(node.kind) && kids.length > 0 && (
            <button
              className="mini-btn"
              title={`Explode into ${node.kind === 'folder' ? 'files' : 'folders'}`}
              onClick={() => doExplode(node.id)}
            >
              💥
            </button>
          )}
          {spills > 0 && (
            <button
              className="mini-btn"
              title="Gather spilled cards back"
              onClick={() => doGather(node.id)}
            >
              ⟲ gather {spills}
            </button>
          )}
          {removable && !node.special && (
            <button
              className="mini-btn"
              title="Remove empty slot"
              onClick={() => mutate((m) => removeContainer(m, node.id))}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderBucketCard({ parent, members, key }) {
    return (
      <div
        key={key}
        className={[
          'card bucket',
          dropTarget === key ? 'drop-target' : '',
          popId === key ? 'merge-pop' : '',
          shakeId === key || (invalidHover === key && drag) ? 'shake' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-drop={JSON.stringify({ type: 'bucket', parentId: parent.id })}
      >
        <div className="card-label bucket-label">
          <span className="q-glyph">?</span> in {KIND_LABEL[parent.kind]}{' '}
          {parent.special ? '' : parent.name || '(unnamed)'}
        </div>
        <div className="bucket-items">
          {members.map((m) => (
            <div
              key={m.id}
              className={`bucket-item ${selected.has(m.id) ? 'selected' : ''} ${
                drag?.itemId === m.id ? 'dragging-src' : ''
              }`}
              onPointerDown={(e) => onCardPointerDown(e, m)}
              onDoubleClick={(e) => openPreview(e, m.id)}
            >
              {m.kind === 'raw' ? (
                <Thumb
                  fileId={m.ref.fileId}
                  pageIndex={m.ref.pageIndex ?? 0}
                  backend={backend}
                  className="bucket-thumb"
                />
              ) : m.kind === 'file' ? (
                (() => {
                  const t = fileThumbProps(m);
                  return t ? (
                    <Thumb {...t} backend={backend} className="bucket-thumb" />
                  ) : (
                    <span>⤓</span>
                  );
                })()
              ) : (
                <span className="bucket-kind">{KIND_ICON[m.kind]}</span>
              )}
              <span className="bucket-name">
                {m.kind === 'raw'
                  ? displayName(nodes.get(m.ref.fileId)?.name || '', getParsed(m.ref.fileId))
                  : m.kind === 'file'
                    ? m.title ||
                      (m.source
                        ? displayName(
                            nodes.get(m.source.fileId)?.name || '',
                            getParsed(m.source.fileId),
                          )
                        : 'file')
                    : `${KIND_LABEL[m.kind]} ${m.name}`}
              </span>
            </div>
          ))}
        </div>
        <div className="contents-note">drag out to resolve</div>
      </div>
    );
  }

  function renderNewSlot(kind) {
    const key = `new-${kind}`;
    return (
      <div
        key={key}
        className={[
          'card newcard',
          dropTarget === key ? 'drop-target' : '',
          shakeId === key || (invalidHover === key && drag) ? 'shake' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-drop={JSON.stringify({ type: 'new', kind })}
        onClick={() => {
          // The File slot is drop-only — a file is made of pages, so it's born
          // by dropping a page here, never as an empty click-created shell.
          if (drag || kind === 'file') return;
          pushUndo();
          const next = clone(model);
          const container = addNode(next, { kind });
          setModel(next);
          setFocusNameId(container.id);
        }}
      >
        {kind === 'file' ? '＋ new file (drop a page)' : `+ new ${KIND_LABEL[kind].toLowerCase()}`}
      </div>
    );
  }

  // ── Preview rendering ────────────────────────────────────────────────────
  const previewLabel = (n) =>
    n.kind === 'raw'
      ? displayName(nodes.get(n.ref.fileId)?.name || '', getParsed(n.ref.fileId))
      : n.kind === 'file'
        ? n.title || 'Untitled file'
        : n.special
          ? n.name
          : n.name || `(unnamed ${KIND_LABEL[n.kind].toLowerCase()})`;

  const previewGlyph = (n) => KIND_ICON[n.kind] || (n.kind === 'file' ? '📄' : '🖼');

  function renderPreviewTile(child) {
    const thumb =
      child.kind === 'raw'
        ? { fileId: child.ref.fileId, pageIndex: child.ref.pageIndex ?? 0 }
        : child.kind === 'file'
          ? fileThumbProps(child)
          : null;
    const pageCount = child.source
      ? child.meta?.pageCount || 1
      : childrenOf(model, child.id).length;
    return (
      <button
        key={child.id}
        className={`preview-tile ${child.bucket ? 'is-bucket' : ''}`}
        onClick={() => setPreview((p) => [...p, child.id])}
        title={child.bucket ? 'In a ? bucket — click to view' : 'Click to open'}
      >
        {thumb ? (
          <Thumb {...thumb} backend={backend} size={260} className="preview-tile-thumb" />
        ) : (
          <span className="preview-tile-icon">{previewGlyph(child)}</span>
        )}
        <span className="preview-tile-name">{previewLabel(child)}</span>
        {child.kind === 'file' && <span className="preview-tile-badge">{pageCount} pp</span>}
        {child.bucket && <span className="preview-tile-q">?</span>}
      </button>
    );
  }

  function renderPreviewBody(node) {
    if (!node) return null;
    if (node.kind === 'raw') {
      return (
        <div className="preview-pages">
          <div className="preview-page">
            <Thumb
              fileId={node.ref.fileId}
              pageIndex={node.ref.pageIndex ?? 0}
              backend={backend}
              size={900}
              className="preview-page-img"
            />
          </div>
        </div>
      );
    }
    if (node.kind === 'file') {
      const refs = filePageRefs(node);
      return (
        <div className="preview-pages">
          {refs.map((r, i) => (
            <div className="preview-page" key={`${r.fileId}#${r.pageIndex}#${i}`}>
              <Thumb
                fileId={r.fileId}
                pageIndex={r.pageIndex}
                backend={backend}
                size={900}
                className="preview-page-img"
              />
              {refs.length > 1 && (
                <button
                  className="preview-explode"
                  title="Separate this page into the Unclassified column"
                  onClick={() => requestSeparatePage(node.id, i)}
                >
                  💥 page {i + 1}
                </button>
              )}
            </div>
          ))}
        </div>
      );
    }
    const kids = [...childrenOf(model, node.id), ...childrenOf(model, node.id, { buckets: true })];
    if (!kids.length) {
      return (
        <div className="preview-empty">This {KIND_LABEL[node.kind].toLowerCase()} is empty.</div>
      );
    }
    return <div className="preview-grid">{kids.map(renderPreviewTile)}</div>;
  }

  const blockers = completeness?.blockers;
  const totalUnits = savePlan?.units.reduce((a, u) => a + u.files.length, 0) || 0;

  return (
    <div className="filing-main" style={{ position: 'relative' }}>
      <div className="filing-head">
        <h2>Filing{allScopes ? '' : `: ${scopeNode?.name}`}</h2>
        <label className="scope-toggle">
          <input
            type="checkbox"
            checked={allScopes}
            onChange={(e) => setAllScopes(e.target.checked)}
          />
          All loaded folders
        </label>
        <span className="hint">
          Drop a card on a level to file it there — the drop fills in that metadata. ? buckets hold
          “belongs here, not placed yet”. 💥 explodes one level down.
        </span>
        <button className="btn small" onClick={() => fileInputRef.current?.click()}>
          Load finding aid…
        </button>
        <input ref={fileInputRef} type="file" accept=".json" hidden onChange={onAidFile} />
      </div>
      {aidInfo && aidInfo.length > 0 && (
        <div className="aid-bar">
          <div className="aid-note">
            {aidInfo.length === 1 ? (
              <>
                Finding aid: <b>{aidInfo[0].collectionTitle}</b>
                {aidInfo[0].dates ? `, ${aidInfo[0].dates}` : ''} — {aidInfo[0].archiveName}
                {aidInfo[0].url && (
                  <>
                    {' · '}
                    <a href={aidInfo[0].url} target="_blank" rel="noreferrer">
                      source
                    </a>
                  </>
                )}
              </>
            ) : (
              <>
                Manifest: <b>{aidInfo.length} collections</b> loaded
              </>
            )}
          </div>
          {(() => {
            const colls = Object.values(model.nodes)
              .filter((n) => n.kind === 'collection')
              .sort((a, b) =>
                (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }),
              );
            if (colls.length < 2) return null;
            return (
              <div className="coll-switch">
                <span className="coll-switch-label">Show:</span>
                <button
                  className={`coll-tab ${focusedCollectionId === null ? 'is-active' : ''}`}
                  onClick={() => setFocusedCollectionId(null)}
                >
                  All
                </button>
                {colls.map((c) => (
                  <button
                    key={c.id}
                    className={`coll-tab ${focusedCollectionId === c.id ? 'is-active' : ''}`}
                    onClick={() => setFocusedCollectionId(c.id)}
                  >
                    {c.name || 'Untitled'}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      <div className="filing-columns">
        {KINDS.map((kind) => (
          <div key={kind} className={`fcol fcol-${kind}`}>
            <div className="fcol-head">
              {KIND_LABEL[kind]}
              <span className="fcol-count">
                {columns[kind].filter((c) => c.type === 'card').length}
              </span>
            </div>
            <div className="fcol-body">
              {columns[kind].map((entry) =>
                entry.type === 'bucket'
                  ? renderBucketCard(entry)
                  : kind === 'raw'
                    ? renderRawCard(entry.node)
                    : kind === 'file'
                      ? renderFileCard(entry)
                      : renderContainerCard(entry),
              )}
              {['file', 'folder', 'box', 'collection', 'archive'].includes(kind) &&
                renderNewSlot(kind)}
              {columns[kind].length === 0 && kind === 'raw' && (
                <div className="fcol-empty">Pages appear here when you 💥 a file</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {ghostNode && (
        <div className={`ghost-card ${flying ? 'flying' : ''}`} style={flyingStyle || dragStyle}>
          <div className={`card ${LEVEL[ghostNode.kind] >= 2 ? ghostNode.kind : ''}`}>
            {ghostNode.kind === 'raw' ? (
              <Thumb
                fileId={ghostNode.ref.fileId}
                pageIndex={ghostNode.ref.pageIndex ?? 0}
                backend={backend}
                className="thumb"
              />
            ) : ghostNode.kind === 'file' ? (
              (() => {
                const t = fileThumbProps(ghostNode);
                return t ? (
                  <Thumb {...t} backend={backend} className="thumb" />
                ) : (
                  <div className="thumb" />
                );
              })()
            ) : (
              <div className="card-label">
                {KIND_ICON[ghostNode.kind]} {ghostNode.name}
              </div>
            )}
            {dragCount > 1 && <span className="drag-count">{dragCount}</span>}
          </div>
        </div>
      )}

      <div className="filing-bar">
        <span className="stats">
          {blockers &&
            [
              blockers.loose ? `${blockers.loose} loose` : '',
              blockers.buckets ? `${blockers.buckets} in ?` : '',
              blockers.unnamed ? `${blockers.unnamed} unnamed` : '',
              blockers.shells ? `${blockers.shells} mid-explode` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          {blockers &&
            !blockers.loose &&
            !blockers.buckets &&
            !blockers.unnamed &&
            !blockers.shells &&
            (completeness?.global ? '✦ everything filed' : 'nothing unresolved')}
        </span>
        {selected.size >= 2 && (
          <button className="btn" disabled={!canMergeSelection} onClick={doMergeSelection}>
            ⧉ Merge {selected.size} selected
          </button>
        )}
        <span className="spacer" />
        <button className="btn" disabled={!undoStack.current.length} onClick={undo}>
          ↩ Undo
        </button>
        <button className="btn" onClick={rebuild}>
          Reset arrangement
        </button>
        <button
          className="btn primary"
          disabled={!saveStats || saveStats.toWrite === 0}
          onClick={() => setSaveOpen(true)}
        >
          {backend.kind === 'demo' ? 'Save (sample)' : 'Save to Drive'}
          {saveStats && saveStats.toWrite > 0 ? ` — ${saveStats.toWrite}` : ''}
        </button>
      </div>

      {preview &&
        preview.length > 0 &&
        (() => {
          const stack = preview.map((id) => model.nodes[id]).filter(Boolean);
          if (!stack.length) return null;
          const cur = stack[stack.length - 1];
          return (
            <div className="preview-overlay" onClick={() => setPreview(null)}>
              <div className="preview-panel" onClick={(e) => e.stopPropagation()}>
                <div className="preview-head">
                  <div className="preview-crumbs">
                    {stack.map((n, i) => (
                      <span key={n.id} className="crumb-wrap">
                        {i > 0 && <span className="crumb-sep">›</span>}
                        <button
                          className="crumb"
                          disabled={i === stack.length - 1}
                          onClick={() => setPreview(stack.slice(0, i + 1).map((s) => s.id))}
                        >
                          {previewGlyph(n)} {previewLabel(n)}
                        </button>
                      </span>
                    ))}
                  </div>
                  <button className="preview-close" onClick={() => setPreview(null)}>
                    ✕
                  </button>
                </div>
                {cur.kind === 'file' && (
                  <div className="preview-rename">
                    <span className="preview-rename-label">Name</span>
                    {nameInput(cur, 'Untitled — type a name')}
                  </div>
                )}
                <div className="preview-hint">
                  {cur.kind === 'file'
                    ? 'Scroll the pages. 💥 separates a page into the Unclassified column.'
                    : cur.kind === 'raw'
                      ? 'A single unclassified page.'
                      : 'Click an item to open it.'}
                </div>
                <div className="preview-body">{renderPreviewBody(cur)}</div>
              </div>
            </div>
          );
        })()}

      {explodeConfirm && (
        <div
          className="modal-overlay"
          style={{ zIndex: 400 }}
          onClick={() => setExplodeConfirm(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Separate this page?</h3>
            <div className="note">
              This page will be separated from the document as a single-page PDF in the Unclassified
              column. Do you want to continue?
            </div>
            <label className="scope-toggle">
              <input
                type="checkbox"
                checked={dontAskExplode}
                onChange={(e) => setDontAskExplode(e.target.checked)}
              />
              Don’t show this message again (until I reload the page)
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setExplodeConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  if (dontAskExplode) explodeConfirmSuppressed = true;
                  const { fileId, ordinal } = explodeConfirm;
                  setExplodeConfirm(null);
                  setDontAskExplode(false);
                  doSeparatePage(fileId, ordinal);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {grandWin && (
        <div className="grand-overlay" onClick={() => setGrandWin(false)}>
          <div className="grand-card">
            <div className="grand-stars">✦ ✦ ✦</div>
            <h2>Everything’s filed</h2>
            <p>Every document has landed in an archive — nothing loose, nothing unresolved.</p>
            <button className="btn primary" onClick={() => setGrandWin(false)}>
              Continue
            </button>
          </div>
        </div>
      )}

      {saveOpen && savePlan && (
        <div className="modal-overlay" onClick={() => !progress && setSaveOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Save this arrangement</h3>
            <div className="note">
              {savePlan.units.length > 0 ? (
                <>
                  Writing <b>{saveStats.toWrite}</b> document{saveStats.toWrite === 1 ? '' : 's'}
                  {saveStats.unchanged > 0 && (
                    <> ({saveStats.unchanged} already in place, untouched)</>
                  )}{' '}
                  across{' '}
                  {[...new Set(savePlan.units.map((u) => u.collection))].map((c, i) => (
                    <span key={c}>
                      {i > 0 && ', '}
                      <b>Archive Capture — {c}</b>
                    </span>
                  ))}
                  . Boxes and Folders become real nested folders; assembled documents become
                  multi-page PDFs named by the same convention as the mobile app; sources whose
                  every page found a home go to the Drive trash.
                </>
              ) : (
                <>Nothing is fully resolved yet — place cards under a named collection first.</>
              )}
              {(savePlan.skipped.unresolved > 0 ||
                savePlan.skipped.loose > 0 ||
                savePlan.skipped.unnamed > 0) && (
                <div className="skip-note">
                  Left untouched:{' '}
                  {[
                    savePlan.skipped.unresolved
                      ? `${savePlan.skipped.unresolved} in ? buckets`
                      : '',
                    savePlan.skipped.loose ? `${savePlan.skipped.loose} loose` : '',
                    savePlan.skipped.unnamed
                      ? `${savePlan.skipped.unnamed} under unnamed slots`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  .
                </div>
              )}
            </div>
            {progress && (
              <div className="progress-log">
                {progress.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              {progress && progress.some((l) => l.startsWith('Filed')) ? (
                <button
                  className="btn primary"
                  onClick={() => {
                    setSaveOpen(false);
                    setProgress(null);
                  }}
                >
                  Done
                </button>
              ) : (
                <>
                  <button
                    className="btn"
                    disabled={Boolean(progress)}
                    onClick={() => setSaveOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn primary"
                    disabled={Boolean(progress) || totalUnits === 0}
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
