// Loads the picked folder(s) into one in-memory tree and computes the
// marking-density highlight tiers. Multi-folder selections show as separate
// roots (clearer than a merged tree when filing across an Unprocessed batch
// and a destination collection side by side).
import { parseProps, markingScore, computeTiers } from './metadata.js';

export async function loadCorpus(backend, roots, onProgress) {
  const nodes = new Map();
  for (const root of roots) {
    nodes.set(root.id, {
      id: root.id, name: root.name, isFolder: true, parentId: null,
      rootId: root.id, children: [], parsed: null,
    });
  }
  // Breadth-first walk; each level's folders are fetched in parallel.
  let frontier = roots.map((r) => r.id);
  let count = 0;
  while (frontier.length > 0) {
    const batches = await Promise.all(frontier.map((fid) => backend.listChildren(fid)));
    const next = [];
    frontier.forEach((fid, i) => {
      const parent = nodes.get(fid);
      for (const child of batches[i]) {
        const node = {
          id: child.id, name: child.name, isFolder: child.isFolder,
          parentId: fid, rootId: parent.rootId, children: [],
          parsed: child.isFolder ? null : parseProps(child.properties),
        };
        nodes.set(node.id, node);
        parent.children.push(node.id);
        if (child.isFolder) next.push(child.id);
        count++;
      }
    });
    onProgress?.(count);
    frontier = next;
  }
  sortChildren(nodes);
  computeHighlights(nodes);
  return nodes;
}

export function sortChildren(nodes) {
  for (const node of nodes.values()) {
    if (!node.isFolder) continue;
    node.children.sort((a, b) => {
      const na = nodes.get(a); const nb = nodes.get(b);
      if (na.isFolder !== nb.isFolder) return na.isFolder ? -1 : 1;
      return na.name.localeCompare(nb.name, undefined, { numeric: true });
    });
  }
}

// Percentile-ranked highlight tiers, computed within each collection (files
// with no collection value group by their root folder instead — e.g. an
// Unprocessed tree ranks against itself, not against a filed collection).
export function computeHighlights(nodes) {
  const groups = new Map();
  for (const node of nodes.values()) {
    if (node.isFolder) continue;
    const key = node.parsed?.collection || `root:${node.rootId}`;
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key).set(node.id, markingScore(node.parsed));
  }
  for (const scores of groups.values()) {
    const tiers = computeTiers(scores);
    for (const [id, tier] of tiers) nodes.get(id).tier = tier;
  }
  // Folders glow as bright as their brightest descendant, so a heavily
  // marked file draws the eye even while its parents are collapsed.
  const folderTier = (id) => {
    const node = nodes.get(id);
    if (!node.isFolder) return node.tier || 0;
    node.tier = Math.max(0, ...node.children.map(folderTier));
    return node.tier;
  };
  for (const node of nodes.values()) {
    if (node.parentId === null) folderTier(node.id);
  }
}

// After an in-session mutation (props edit, move), recompute cheaply.
export function refreshHighlights(nodes) {
  computeHighlights(nodes);
}
