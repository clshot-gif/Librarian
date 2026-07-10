import { useMemo, useState } from 'react';
import {
  inlineCitation,
  bibliographyCitation,
  citationComplete,
  citationText,
} from '../lib/citation.js';
import { collectTagPools, suggestTags } from '../lib/tagStore.js';

function CitationLine({ label, segs }) {
  const ok = citationComplete(segs);
  return (
    <div>
      <div className="cite-label">
        {label}
        <button
          className="copy-btn"
          onClick={() => navigator.clipboard?.writeText(citationText(segs))}
        >
          copy
        </button>
        <span className={`cite-status ${ok ? 'ok' : 'incomplete'}`}>
          {ok ? '✓ ready' : '⚠ incomplete'}
        </span>
      </div>
      <div className="cite-line">
        {segs.map((s, i) => (
          <span key={i} className={`cite-seg ${s.missing ? 'missing' : ''}`}>
            {s.text}{' '}
          </span>
        ))}
      </div>
    </div>
  );
}

// Tag multi-select working exactly like the mobile app's: the collection's
// own tags are offered as one-tap chips; typing a new one gets autocomplete
// suggestions from the cross-collection master pool (tagStore.suggestTags —
// the same logic as archive-capture's useTagAutocomplete hook).
function TagInput({ draft, pools, onAdd, onRemove }) {
  const [text, setText] = useState('');
  const collectionTags = [...(pools.perCollection.get(draft.collection || '') || [])].sort();
  const suggestions = suggestTags(text, pools.master, draft.tags);

  function commit(tag) {
    const clean = tag.trim();
    if (clean) onAdd(clean);
    setText('');
  }

  return (
    <>
      <div className="tag-row">
        {draft.tags.map((tag) => {
          const who = draft.tagLog.find((e) => e.tag === tag)?.user;
          return (
            <span key={tag} className="tag-chip" title={who ? `added by ${who}` : undefined}>
              {tag}
              <button onClick={() => onRemove(tag)} aria-label={`remove ${tag}`}>
                ✕
              </button>
            </span>
          );
        })}
        <span className="tag-input-wrap">
          <input
            value={text}
            placeholder="+ add tag…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(text);
            }}
          />
          {suggestions.length > 0 && (
            <div className="tag-suggest">
              {suggestions.map((s) => (
                <button key={s} onClick={() => commit(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </span>
      </div>
      {collectionTags.filter((t) => !draft.tags.includes(t)).length > 0 && (
        <div className="tag-row">
          {collectionTags
            .filter((t) => !draft.tags.includes(t))
            .map((t) => (
              <button key={t} className="tag-chip ghost" onClick={() => onAdd(t)}>
                + {t}
              </button>
            ))}
        </div>
      )}
    </>
  );
}

export default function MetadataPanel({
  draft,
  nodes,
  version,
  nameSuggestions,
  currentPage,
  user,
  onField,
  onAddComment,
  onAddTag,
  onRemoveTag,
  onToggleOmg,
}) {
  const [commentText, setCommentText] = useState('');
  // Tag pools derive from what's actually on the loaded files (plus this
  // browser's history) — recomputed when the corpus version changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pools = useMemo(() => collectTagPools(nodes), [nodes, version]);

  const omgOn = draft.omgPages.includes(currentPage);
  const omgWho = draft.omgLog
    .filter((e) => (e.page || 0) === currentPage)
    .map((e) => e.user)
    .join(', ');

  return (
    <div className="meta-panel">
      <div className="citation-card">
        <CitationLine label="Footnote" segs={inlineCitation(draft)} />
        <CitationLine label="Bibliography" segs={bibliographyCitation(draft)} />
      </div>

      <div className="fields-grid">
        {/* Suggestions = names already established (manifest slots + what's
            actually on the loaded files), so an established name never gets
            retyped slightly wrong and fragments a box in two. */}
        <div className="field">
          <label>Archive Name</label>
          <input
            value={draft.archiveName}
            list="meta-suggest-archive"
            onChange={(e) => onField('archiveName', e.target.value)}
            placeholder="e.g. Five Forks"
          />
        </div>
        <div className="field">
          <label>Collection</label>
          <input
            value={draft.collection}
            list="meta-suggest-collection"
            onChange={(e) => onField('collection', e.target.value)}
            placeholder="e.g. Good Poems"
          />
        </div>
        <div className="field">
          <label>Box</label>
          <input
            value={draft.box}
            list="meta-suggest-box"
            onChange={(e) => onField('box', e.target.value)}
            placeholder="e.g. 3 or XIV"
          />
        </div>
        <div className="field">
          <label>Folder</label>
          <input
            value={draft.folder}
            list="meta-suggest-folder"
            onChange={(e) => onField('folder', e.target.value)}
            placeholder="e.g. 2"
          />
        </div>
        <datalist id="meta-suggest-archive">
          {(nameSuggestions?.archives || []).map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <datalist id="meta-suggest-collection">
          {(nameSuggestions?.collections || []).map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <datalist id="meta-suggest-box">
          {(nameSuggestions?.boxes || []).map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <datalist id="meta-suggest-folder">
          {(nameSuggestions?.folders || []).map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>File Title</label>
          <input
            value={draft.title}
            onChange={(e) => onField('title', e.target.value)}
            placeholder="e.g. Letter re: county hearing, 12 Mar 1947"
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button className={`omg-btn ${omgOn ? 'on' : ''}`} onClick={onToggleOmg}>
          OMG
        </button>
        <span className="omg-who">
          {omgOn
            ? `page ${currentPage + 1} flagged${omgWho ? ` by ${omgWho}` : ''}`
            : `flags page ${currentPage + 1}`}
        </span>
      </div>

      <div>
        <div className="section-title">Tags</div>
        <div style={{ height: 8 }} />
        <TagInput draft={draft} pools={pools} onAdd={onAddTag} onRemove={onRemoveTag} />
      </div>

      <div>
        <div className="section-title">Comments</div>
        <div style={{ height: 8 }} />
        <div className="comments-list">
          {draft.comments.map((c, i) => (
            <div key={i} className="comment-item">
              <div className="comment-meta">
                <b>{c.user || 'Unknown'}</b>
                {' · '}p.{(c.page || 0) + 1}
                {c.ts ? ` · ${c.ts.slice(0, 10)}` : ''}
              </div>
              {c.text}
            </div>
          ))}
          <div className="comment-add">
            <textarea
              className="comment-box"
              value={commentText}
              placeholder={`Add a note as ${user.name} (attaches to page ${currentPage + 1})…`}
              onChange={(e) => setCommentText(e.target.value)}
            />
            <button
              className="btn"
              disabled={!commentText.trim()}
              onClick={() => {
                onAddComment(commentText.trim());
                setCommentText('');
              }}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
