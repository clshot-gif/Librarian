import { useState } from 'react';
import { displayName } from '../lib/naming.js';

// The always-visible file tree. Handles both corpus shapes without caring
// which is which — it just mirrors whatever folder structure exists. Rows
// carry the marking-density highlight tier (0–3) computed in corpus.js.
function Row({
  nodeId,
  nodes,
  depth,
  mode,
  selectedId,
  onOpenFile,
  onSelectFolder,
  onMove,
  isRoot,
  isArchiveRoot,
}) {
  const node = nodes.get(nodeId);
  const [open, setOpen] = useState(depth === 0);
  const [dropHover, setDropHover] = useState(false);
  if (!node) return null;

  const tier = node.tier || 0;
  const classes = [
    'tree-row',
    tier ? `tier${tier}` : '',
    selectedId === nodeId ? 'selected' : '',
    dropHover ? 'drop-hover' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const parsed = node.parsed;
  const label = node.isFolder ? node.name : displayName(node.name, parsed);
  const isUnprocessedRoot = isRoot && /^Unprocessed /.test(node.name);
  const rootChip = isArchiveRoot ? 'archive' : isUnprocessedRoot ? 'unfiled' : 'collection';

  function handleClick() {
    if (node.isFolder) {
      setOpen(!open);
      if (mode === 'filing') onSelectFolder(nodeId);
    } else {
      onOpenFile(nodeId);
    }
  }

  return (
    <>
      <div
        className={classes}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={handleClick}
        title={node.name}
        draggable={!isRoot}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', nodeId);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={
          node.isFolder
            ? (e) => {
                e.preventDefault();
                setDropHover(true);
              }
            : undefined
        }
        onDragLeave={node.isFolder ? () => setDropHover(false) : undefined}
        onDrop={
          node.isFolder
            ? (e) => {
                e.preventDefault();
                setDropHover(false);
                const dragId = e.dataTransfer.getData('text/plain');
                if (dragId) onMove(dragId, nodeId);
              }
            : undefined
        }
      >
        <span className="tree-chevron">{node.isFolder ? (open ? '▼' : '▶') : ''}</span>
        <span className="tree-icon">{node.isFolder ? '📁' : '📄'}</span>
        <span className="tree-name">{label}</span>
        {isRoot && (
          <span className={`root-chip ${isUnprocessedRoot ? 'unfiled' : ''}`}>{rootChip}</span>
        )}
        {!node.isFolder && parsed && (
          <span className="tree-badges">
            {parsed.omgPages.length > 0 && <span className="badge omg">OMG</span>}
            {parsed.comments.length > 0 && (
              <span className="badge">💬{parsed.comments.length}</span>
            )}
            {parsed.hasMarkup && <span className="badge">✏️</span>}
            {parsed.pageCount > 1 && <span className="badge">{parsed.pageCount}pp</span>}
          </span>
        )}
      </div>
      {node.isFolder &&
        open &&
        node.children.map((childId) => (
          <Row
            key={childId}
            nodeId={childId}
            nodes={nodes}
            depth={depth + 1}
            mode={mode}
            selectedId={selectedId}
            onOpenFile={onOpenFile}
            onSelectFolder={onSelectFolder}
            onMove={onMove}
            isRoot={false}
          />
        ))}
    </>
  );
}

export default function Explorer({
  nodes,
  roots,
  mode,
  selectedId,
  onOpenFile,
  onSelectFolder,
  onMove,
  canUndoMove,
  onUndoMove,
}) {
  return (
    <div className="explorer">
      <div className="explorer-hint">
        {mode === 'filing'
          ? 'Click a folder to load its files into the filing table →'
          : 'Click a file to review it. Drag files or folders to move them.'}
        {canUndoMove && (
          <button
            className="btn small undo-move-btn"
            title="Undo the last drag-move (restores location, name, and metadata) — repeatable back to the last save/reload"
            onClick={onUndoMove}
          >
            ↩ Undo move
          </button>
        )}
      </div>
      {/* `version` isn't in the key — a bump re-renders rows (they read the
          mutated nodes Map) without remounting, so expand state survives. */}
      {roots.map((root) => (
        <Row
          key={root.id}
          nodeId={root.id}
          nodes={nodes}
          depth={0}
          mode={mode}
          selectedId={selectedId}
          onOpenFile={onOpenFile}
          onSelectFolder={onSelectFolder}
          onMove={onMove}
          isRoot
          isArchiveRoot={Boolean(root.archiveDest)}
        />
      ))}
    </div>
  );
}
