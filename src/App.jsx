import { useState, useRef, useCallback } from 'react';
import PickerScreen from './components/PickerScreen.jsx';
import Explorer from './components/Explorer.jsx';
import MarkingMode from './components/MarkingMode.jsx';
import FilingMode from './components/FilingMode.jsx';
import { DemoBackend, DriveBackend } from './lib/backend.js';
import { initAuth, signIn, fetchUserInfo } from './lib/auth.js';
import { pickFolders } from './lib/picker.js';
import { loadCorpus, loadSubtree, removeSubtree, refreshHighlights } from './lib/corpus.js';
import { refileFile, undoRefile, derivePlacement } from './lib/refile.js';
import {
  getStoredArchiveScans,
  setStoredArchiveScans,
  isInsideArchiveScans,
  fetchArchiveManifest,
} from './lib/archiveScans.js';

export default function App() {
  const [stage, setStage] = useState('pick'); // pick | loading | work
  const [mode, setMode] = useState('marking'); // marking | filing
  const [openFileId, setOpenFileId] = useState(null);
  const [scopeId, setScopeId] = useState(null); // Filing Mode's working folder
  const [version, setVersion] = useState(0); // bumped on any nodes mutation
  const [loadCount, setLoadCount] = useState(0);
  const [error, setError] = useState('');
  // The canonical filing structure: Archive Scans (hand-made in Drive, picked
  // once per user and persisted) and the archive folder currently chosen as
  // the filing destination, plus the finding aids parsed from that archive's
  // Contents/manifest.json (null when it has none).
  const [archiveScans, setArchiveScans] = useState(null); // {id, name} | null
  const [archiveDest, setArchiveDest] = useState(null); // {id, name} | null
  const [archiveAids, setArchiveAids] = useState(null);
  const [canUndoMove, setCanUndoMove] = useState(false);

  const backendRef = useRef(null);
  const nodesRef = useRef(new Map());
  const rootsRef = useRef([]);
  // Marking Mode reports unsaved changes here so file switches can warn.
  const markingDirtyRef = useRef(false);
  // Explorer drag-moves are instant Drive writes; each one records enough to
  // restore exactly (name + parent + properties), so they stay undoable
  // until the corpus is next reloaded (a save or folder switch).
  const moveUndoRef = useRef([]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const mutate = useCallback(
    (fn) => {
      fn(nodesRef.current);
      refreshHighlights(nodesRef.current);
      bump();
    },
    [bump],
  );

  async function loadRoots(backend, roots) {
    setStage('loading');
    setLoadCount(0);
    setError('');
    try {
      nodesRef.current = await loadCorpus(backend, roots, setLoadCount);
      backendRef.current = backend;
      rootsRef.current = roots;
      setOpenFileId(null);
      setScopeId(roots[0]?.id ?? null);
      markingDirtyRef.current = false;
      moveUndoRef.current = [];
      setCanUndoMove(false);
      // A fresh corpus means the destination archive (if any) must be
      // re-selected — its subtree is loaded on selection.
      setArchiveDest(null);
      setArchiveAids(null);
      setArchiveScans(
        backend.kind === 'demo'
          ? { id: backend.archiveScansId, name: 'Archive Scans' }
          : getStoredArchiveScans(),
      );
      setStage('work');
      bump();
    } catch (err) {
      setError(`Couldn't load folders: ${err.message || err}`);
      setStage('pick');
    }
  }

  async function startDemo() {
    const backend = new DemoBackend();
    await loadRoots(backend, backend.demoRoots());
  }

  // Warn — never block — when a picked *source* folder is Archive Scans
  // itself or inside it. There's a real case for re-opening an already-filed
  // folder as material to fix, so the user can always proceed.
  async function confirmSourcePick(backend, folders, scans) {
    if (!scans) return true;
    for (const f of folders) {
      let inside = false;
      try {
        inside = await isInsideArchiveScans(backend, f.id, scans.id);
      } catch {
        // Can't check (e.g. no access to an ancestor) — don't get in the way.
      }
      if (inside) {
        const ok = window.confirm(
          `“${f.name}” is inside your Archive Scans structure. This picker chooses ` +
            `material to organize — the archive to file INTO is chosen inside the app. ` +
            `Open it as source material anyway?`,
        );
        if (!ok) return false;
      }
    }
    return true;
  }

  async function startDrive() {
    try {
      await initAuth();
      const token = await signIn();
      const user = await fetchUserInfo(token);
      const backend = new DriveBackend(token, user);
      const folders = await pickFolders(token);
      if (!folders.length) return; // user cancelled the picker
      if (!(await confirmSourcePick(backend, folders, getStoredArchiveScans()))) return;
      await loadRoots(backend, folders);
    } catch (err) {
      setError(`Google sign-in failed: ${err.message || err}`);
    }
  }

  // "Switch folders" — any time, not just first launch. Drive mode reopens
  // the picker; sample mode goes back to the landing screen.
  async function switchFolders() {
    if (
      markingDirtyRef.current &&
      !window.confirm('You have unsaved changes. Switch folders anyway?')
    )
      return;
    const backend = backendRef.current;
    if (backend?.kind === 'drive') {
      try {
        const folders = await pickFolders(backend.token);
        if (!folders.length) return;
        if (!(await confirmSourcePick(backend, folders, archiveScans))) return;
        await loadRoots(backend, folders);
      } catch (err) {
        setError(`Folder picker failed: ${err.message || err}`);
      }
    } else {
      setStage('pick');
    }
  }

  // First run (or "the folder moved / wrong account"): the user points the
  // app at their hand-made Archive Scans folder once, via the existing
  // Picker — which is also what grants this user's drive.file token access
  // to it. Persisted in localStorage; changeable any time.
  async function setupArchiveScans() {
    const backend = backendRef.current;
    if (backend?.kind !== 'drive') return;
    try {
      const folders = await pickFolders(backend.token);
      if (!folders.length) return;
      const f = { id: folders[0].id, name: folders[0].name };
      setStoredArchiveScans(f);
      setArchiveScans(f);
      setArchiveDest(null);
      setArchiveAids(null);
    } catch (err) {
      setError(`Couldn't set the Archive Scans folder: ${err.message || err}`);
    }
  }

  // Choose the archive to file into (a direct child of Archive Scans). Its
  // real subtree joins the corpus (so existing collections/boxes/folders are
  // visible and reused, never duplicated) and its Contents/manifest.json —
  // if present — pre-populates Filing Mode's expected slots.
  async function selectArchiveDest(folder) {
    const backend = backendRef.current;
    const nodes = nodesRef.current;
    try {
      const prev = rootsRef.current.find((r) => r.archiveDest);
      if (prev && prev.id !== folder.id) {
        removeSubtree(nodes, prev.id);
        rootsRef.current = rootsRef.current.filter((r) => r.id !== prev.id);
      }
      if (!nodes.has(folder.id)) {
        await loadSubtree(backend, nodes, folder, { excludeNames: ['Contents'] });
        rootsRef.current = [
          ...rootsRef.current,
          { id: folder.id, name: folder.name, archiveDest: true },
        ];
      }
      let aids = null;
      try {
        aids = await fetchArchiveManifest(backend, folder.id);
        if (aids) {
          for (const aid of aids) {
            if (!aid.archiveName) aid.archiveName = folder.name;
          }
        }
      } catch (err) {
        setError(
          `Couldn't read “${folder.name}”'s Contents/manifest.json: ${err.message || err}. ` +
            `Filing still works — expected slots just won't be pre-populated.`,
        );
      }
      setArchiveAids(aids);
      setArchiveDest({ id: folder.id, name: folder.name });
      refreshHighlights(nodes);
      bump();
    } catch (err) {
      setError(`Couldn't open archive “${folder.name}”: ${err.message || err}`);
    }
  }

  // Full corpus refresh (after a Filing save), keeping the chosen archive
  // destination selected — its subtree and manifest are re-fetched through
  // the same path that selected it, so Contents/ stays excluded.
  async function reloadCorpus() {
    const backend = backendRef.current;
    const dest = archiveDest;
    const keptRoots = rootsRef.current.filter((r) => !r.archiveDest);
    await loadRoots(backend, keptRoots);
    if (dest) await selectArchiveDest(dest);
  }

  // Corpus roots that are canonical archive folders (destinations inside
  // Archive Scans) — the anchor for deriving metadata from folder ancestry.
  function archiveRootIds() {
    return new Set(rootsRef.current.filter((r) => r.archiveDest).map((r) => r.id));
  }

  // Unlink a node from its parent and relink it under another, keeping
  // rootId correct across the whole moved subtree.
  function relinkLocal(nodes, id, newParentId) {
    const node = nodes.get(id);
    const oldParent = node.parentId != null ? nodes.get(node.parentId) : null;
    if (oldParent) oldParent.children = oldParent.children.filter((c) => c !== id);
    node.parentId = newParentId;
    const target = nodes.get(newParentId);
    const setRoot = (nid, rootId) => {
      const x = nodes.get(nid);
      if (!x) return;
      x.rootId = rootId;
      x.children?.forEach((c) => setRoot(c, rootId));
    };
    if (target) {
      setRoot(id, target.rootId);
      if (!target.children.includes(id)) target.children.push(id);
    }
  }

  // Explorer drag-and-drop. For files dropped inside a recognizable filing
  // structure (a chosen archive under Archive Scans, or a legacy
  // `Archive Capture — X` tree), the move routes through refileFile — the
  // same operation Marking Mode saves use — so the file's properties and
  // filename move WITH it instead of drifting out of sync. Drops anywhere
  // else (reorganizing an Unprocessed tree) move the file physically and
  // leave metadata alone; folders always move physically (their descendants'
  // metadata is not rewritten — flagged, deliberately out of scope).
  async function handleMove(dragId, targetFolderId) {
    const nodes = nodesRef.current;
    const node = nodes.get(dragId);
    const target = nodes.get(targetFolderId);
    if (!node || !target || !target.isFolder || dragId === targetFolderId) return;
    if (node.parentId === targetFolderId) return;
    // A folder can't move into its own descendant.
    for (let anc = target; anc; anc = anc.parentId ? nodes.get(anc.parentId) : null) {
      if (anc.id === dragId) return;
    }
    const prev = {
      fileId: dragId,
      prevName: node.name,
      prevParentId: node.parentId,
      prevParsed: node.parsed,
    };
    try {
      const placement = node.isFolder
        ? null
        : derivePlacement(nodes, targetFolderId, { archiveRootIds: archiveRootIds() });
      if (placement) {
        // Which archive_name to stamp: the manifest's (matched by
        // collection), the archive folder's own name, or — in a legacy
        // tree, which encodes no archive — whatever the file already had.
        const archiveName = placement.archiveRootId
          ? archiveAids?.find((a) => a.collectionTitle === placement.collection)?.archiveName ||
            archiveAids?.[0]?.archiveName ||
            nodes.get(placement.archiveRootId)?.name ||
            ''
          : node.parsed?.archiveName || '';
        const parsed = {
          ...node.parsed,
          collection: placement.collection,
          box: placement.box,
          folder: placement.folder,
          archiveName,
        };
        await refileFile({
          backend: backendRef.current,
          nodes,
          roots: rootsRef.current,
          fileId: dragId,
          parsed,
          destFolderId: targetFolderId,
        });
        moveUndoRef.current.push({ ...prev, refiled: true });
      } else {
        await backendRef.current.move(dragId, targetFolderId, node.parentId);
        relinkLocal(nodes, dragId, targetFolderId);
        moveUndoRef.current.push({ ...prev, refiled: false });
      }
      if (moveUndoRef.current.length > 50) moveUndoRef.current.shift();
      setCanUndoMove(true);
      mutate(() => {});
    } catch (err) {
      alert(`Move failed: ${err.message || err}`);
    }
  }

  // Undo the most recent Explorer move — restores name, properties, and
  // location exactly. Repeatable back to the last corpus reload.
  async function undoLastMove() {
    const entry = moveUndoRef.current.pop();
    setCanUndoMove(moveUndoRef.current.length > 0);
    if (!entry) return;
    const nodes = nodesRef.current;
    try {
      if (entry.refiled) {
        await undoRefile({ backend: backendRef.current, nodes, ...entry });
      } else {
        const node = nodes.get(entry.fileId);
        if (!node) return;
        await backendRef.current.move(entry.fileId, entry.prevParentId, node.parentId);
        relinkLocal(nodes, entry.fileId, entry.prevParentId);
      }
      mutate(() => {});
    } catch (err) {
      alert(`Undo failed: ${err.message || err}`);
    }
  }

  function guardedOpenFile(id) {
    if (
      id !== openFileId &&
      markingDirtyRef.current &&
      !window.confirm('You have unsaved changes on this document. Discard them?')
    ) {
      return;
    }
    markingDirtyRef.current = false;
    setOpenFileId(id);
    if (mode === 'filing') setMode('marking');
  }

  function guardedSetMode(next) {
    if (next === mode) return;
    if (
      mode === 'marking' &&
      markingDirtyRef.current &&
      !window.confirm('You have unsaved changes on this document. Discard them?')
    ) {
      return;
    }
    markingDirtyRef.current = false;
    setMode(next);
  }

  if (stage === 'pick') {
    return <PickerScreen onDemo={startDemo} onDrive={startDrive} error={error} />;
  }
  if (stage === 'loading') {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <div>Reading folders… {loadCount} items found</div>
      </div>
    );
  }

  const backend = backendRef.current;
  const user = backend.user();

  return (
    <div style={{ height: '100%' }}>
      {/* Errors hit while already working (e.g. the folder picker failing on
          "Change folders") used to be stored but rendered nowhere — the only
          error display lived on the pick screen. */}
      {error && (
        <div className="work-error-banner" role="alert">
          <span>{error}</span>
          <button className="btn" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}
      <header className="app-header">
        <div className="brand">
          Archive <span>Review</span>
        </div>
        <div className="mode-toggle">
          <button
            className={`mode-btn ${mode === 'marking' ? 'active' : ''}`}
            onClick={() => guardedSetMode('marking')}
          >
            Marking
          </button>
          <button
            className={`mode-btn ${mode === 'filing' ? 'active' : ''}`}
            onClick={() => guardedSetMode('filing')}
          >
            Filing
          </button>
        </div>
        <div className="header-right">
          <button className="btn" onClick={switchFolders}>
            ⇄ Change folders
          </button>
          <div className="user-chip">
            {backend.kind === 'demo' ? 'Sample data · ' : ''}signed in as <b>{user.name}</b>
          </div>
        </div>
      </header>
      <div className="main-split">
        <Explorer
          nodes={nodesRef.current}
          roots={rootsRef.current}
          mode={mode}
          selectedId={mode === 'filing' ? scopeId : openFileId}
          onOpenFile={guardedOpenFile}
          onSelectFolder={(id) => setScopeId(id)}
          onMove={handleMove}
          canUndoMove={canUndoMove}
          onUndoMove={undoLastMove}
        />
        {mode === 'marking' ? (
          <MarkingMode
            key={openFileId || 'none'}
            backend={backend}
            nodes={nodesRef.current}
            roots={rootsRef.current}
            version={version}
            fileId={openFileId}
            user={user}
            mutate={mutate}
            archiveAids={archiveAids}
            onDirtyChange={(d) => {
              markingDirtyRef.current = d;
            }}
          />
        ) : (
          <FilingMode
            backend={backend}
            nodes={nodesRef.current}
            version={version}
            scopeId={scopeId}
            roots={rootsRef.current}
            archiveScans={archiveScans}
            archiveDest={archiveDest}
            archiveAids={archiveAids}
            onSelectArchive={selectArchiveDest}
            onSetupArchiveScans={setupArchiveScans}
            onReload={reloadCorpus}
          />
        )}
      </div>
    </div>
  );
}
