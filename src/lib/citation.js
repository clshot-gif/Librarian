// Citations in the historical convention, built from the document's
// metadata. Missing fields render as an explicit placeholder segment
// (flagged `missing: true`) so the researcher sees the citation is not
// ready to use, rather than silently getting a shorter one.

function seg(text, missing = false) {
  return { text, missing };
}

// Footnote style:
//   "Letter to E. Debs," 12 Mar 1947, Box 3, Folder 2, Good Poems
//   Collection, Five Forks Archive.
export function inlineCitation(p) {
  const segs = [];
  segs.push(p.title ? seg(`“${p.title},”`) : seg('[untitled document]', true));
  segs.push(p.box ? seg(`Box ${p.box},`) : seg('[box?]', true));
  segs.push(p.folder ? seg(`Folder ${p.folder},`) : seg('[folder?]', true));
  segs.push(p.collection ? seg(`${p.collection} Collection,`) : seg('[collection?]', true));
  segs.push(p.archiveName ? seg(`${p.archiveName} Archive.`) : seg('[archive?]', true));
  return segs;
}

// Bibliography style:
//   Good Poems Collection. Five Forks Archive. Box 3, Folder 2.
export function bibliographyCitation(p) {
  const segs = [];
  segs.push(p.collection ? seg(`${p.collection} Collection.`) : seg('[collection?]', true));
  segs.push(p.archiveName ? seg(`${p.archiveName} Archive.`) : seg('[archive?]', true));
  segs.push(p.box ? seg(`Box ${p.box},`) : seg('[box?]', true));
  segs.push(p.folder ? seg(`Folder ${p.folder}.`) : seg('[folder?]', true));
  return segs;
}

export function citationComplete(segs) {
  return segs.every((s) => !s.missing);
}

export function citationText(segs) {
  return segs.map((s) => s.text).join(' ');
}
