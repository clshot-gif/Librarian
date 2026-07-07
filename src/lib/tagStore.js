// Tag pools, mirroring the mobile app's model: a per-collection tag list
// (only tags relevant to this collection are offered) plus a cross-collection
// master pool that feeds autocomplete when typing a new tag (same behavior
// as archive-capture/src/hooks/useTagAutocomplete.js). The mobile app keeps
// these in on-device AsyncStorage, which this web tool can't read — so pools
// are derived from the tags actually present on the loaded files, merged
// with what this browser has seen before (localStorage).
const LS_ALL = 'reviewui.allTagsEver';
const LS_COLLECTION = (c) => `reviewui.collectionTags.${c}`;

function readLs(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}

function writeLs(key, arr) {
  localStorage.setItem(key, JSON.stringify([...new Set(arr)].sort()));
}

export function collectTagPools(nodes) {
  const perCollection = new Map();
  const master = new Set(readLs(LS_ALL));
  for (const node of nodes.values()) {
    if (node.isFolder || !node.parsed) continue;
    const key = node.parsed.collection || '';
    if (!perCollection.has(key)) {
      perCollection.set(key, new Set(key ? readLs(LS_COLLECTION(key)) : []));
    }
    for (const tag of node.parsed.tags) {
      perCollection.get(key).add(tag);
      master.add(tag);
    }
  }
  writeLs(LS_ALL, [...master]);
  return { perCollection, master };
}

export function rememberTag(collection, tag) {
  writeLs(LS_ALL, [...readLs(LS_ALL), tag]);
  if (collection) writeLs(LS_COLLECTION(collection), [...readLs(LS_COLLECTION(collection)), tag]);
}

// Same suggestion logic as the mobile app's useTagAutocomplete: prefix
// match against the master pool, excluding what's already applied, max 5.
export function suggestTags(query, masterPool, excludeTags) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exclude = new Set(excludeTags);
  return [...masterPool]
    .filter((t) => !exclude.has(t))
    .filter((t) => t.toLowerCase().startsWith(q))
    .slice(0, 5);
}
