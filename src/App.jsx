import { useState, useRef, useCallback } from 'react';
import PickerScreen from './components/PickerScreen.jsx';
import Explorer from './components/Explorer.jsx';
import MarkingMode from './components/MarkingMode.jsx';
import FilingMode from './components/FilingMode.jsx';
import { DemoBackend, DriveBackend } from './lib/backend.js';
import { initAuth, signIn, fetchUserInfo } from './lib/auth.js';
import { pickFolders } from './lib/picker.js';
import { loadCorpus, refreshHighlights } from './lib/corpus.js';

export default function App() {
  const [stage, setStage] = useState('pick'); // pick | loading | work
  const [mode, setMode] = useState('marking'); // marking | filing
  const [openFileId, setOpenFileId] = useState(null);
  const [scopeId, setScopeId] = useState(null); // Filing Mode's working folder
  const [version, setVersion] = useState(0); // bumped on any nodes mutation
  const [loadCount, setLoadCount] = useState(0);
  const [error, setError] = useState('');

  const backendRef = useRef(null);
  const nodesRef = useRef(new Map());
  const rootsRef = useRef([]);
  // Marking Mode reports unsaved changes here so file switches can warn.
  const markingDirtyRef = useRef(false);

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

  async function startDrive() {
    try {
      await initAuth();
      const token = await signIn();
      const user = await fetchUserInfo(token);
      const folders = await pickFolders(token);
      if (!folders.length) return; // user cancelled the picker
      await loadRoots(new DriveBackend(token, user), folders);
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
        if (folders.length) await loadRoots(backend, folders);
      } catch (err) {
        setError(`Folder picker failed: ${err.message || err}`);
      }
    } else {
      setStage('pick');
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

  // Explorer drag-and-drop → real Drive move (plus local tree update).
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
    try {
      await backendRef.current.move(dragId, targetFolderId, node.parentId);
      mutate((n) => {
        const oldParent = n.get(node.parentId);
        if (oldParent) oldParent.children = oldParent.children.filter((c) => c !== dragId);
        node.parentId = targetFolderId;
        const setRoot = (id, rootId) => {
          const x = n.get(id);
          x.rootId = rootId;
          x.children?.forEach((c) => setRoot(c, rootId));
        };
        setRoot(dragId, target.rootId);
        target.children.push(dragId);
      });
    } catch (err) {
      alert(`Move failed: ${err.message || err}`);
    }
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
            onReload={() => loadRoots(backend, rootsRef.current)}
          />
        )}
      </div>
    </div>
  );
}
