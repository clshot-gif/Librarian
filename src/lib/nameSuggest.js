// One shared source for "names already established" — fed to every Box /
// Folder / Collection / Archive text input in the app as <datalist>
// suggestions, so nobody retypes an established name slightly wrong and
// fragments one physical box into two Drive folders (`Box 4` vs `box four`).
//
// Established means: named in the archive's manifest (finding-aid expected
// slots), carried as metadata by any loaded file, or present as a
// convention-named folder (`Box n` / `Folder m` / `Archive Capture — X`) in
// the loaded corpus tree.
export function collectNameSuggestions(nodes, aids) {
  const archives = new Set();
  const collections = new Set();
  const boxes = new Set();
  const folders = new Set();

  if (nodes) {
    for (const n of nodes.values()) {
      if (n.isFolder) {
        let m;
        if ((m = /^Box (.+)$/.exec(n.name))) boxes.add(m[1]);
        else if ((m = /^Folder (.+)$/.exec(n.name))) folders.add(m[1]);
        else if ((m = /^Archive Capture — (.+)$/.exec(n.name))) collections.add(m[1]);
      } else if (n.parsed) {
        if (n.parsed.archiveName) archives.add(n.parsed.archiveName);
        if (n.parsed.collection) collections.add(n.parsed.collection);
        if (n.parsed.box) boxes.add(n.parsed.box);
        if (n.parsed.folder) folders.add(n.parsed.folder);
      }
    }
  }
  for (const aid of aids || []) {
    if (aid.archiveName) archives.add(aid.archiveName);
    if (aid.collectionTitle) collections.add(aid.collectionTitle);
    for (const b of aid.boxes || []) {
      if (b.name) boxes.add(b.name);
      for (const f of b.folders || []) folders.add(f);
    }
  }

  const sorted = (set) => [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return {
    archives: sorted(archives),
    collections: sorted(collections),
    boxes: sorted(boxes),
    folders: sorted(folders),
  };
}
