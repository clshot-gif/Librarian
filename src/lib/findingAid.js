// Finding-aid ingestion — the flat JSON shape only (no EAD-XML parsing, by
// design; converting other finding aids into this shape by hand or one-off
// script is the intended path).
//
// Expected shape (see findingAidSeed.json for a real example):
// {
//   "_status": "optional human note about data completeness",
//   "repository": { "name": "...", "unit": "..." },
//   "collection": { "title": "...", "dates": "...", "finding_aid_url": "...", "summary": "..." },
//   "boxes": [
//     { "box": "1", "title": "optional box title",
//       "folders": [ { "folder": "2", "title": "Correspondence" }, "or a bare string" ] }
//   ]
// }
//
// Box/folder entries become *expected* slots in Filing Mode — named drop
// targets waiting to be filled, so the user never has to invent names. The
// seed's `boxes` array being empty is a known, documented limitation (the
// source site blocks automated retrieval); ingestion degrades gracefully to
// collection-level slots alone.

export function parseFindingAid(json) {
  if (!json || typeof json !== 'object' || !json.collection?.title) {
    throw new Error('Not a finding-aid JSON: missing collection.title');
  }
  const repo = json.repository || {};
  const folders = (arr) =>
    (arr || [])
      .map((f) => (typeof f === 'string' ? f : f.title || String(f.folder ?? '')))
      .filter(Boolean);
  return {
    status: json._status || '',
    // "Archive Name" = where the physical documents live. The unit (e.g.
    // "Sallie Bingham Center…") is the specific place; fall back to the
    // repository name.
    archiveName: repo.unit || repo.name || '',
    repositoryName: repo.name || '',
    collectionTitle: json.collection.title,
    dates: json.collection.dates || '',
    url: json.collection.finding_aid_url || '',
    summary: json.collection.summary || '',
    boxes: (json.boxes || [])
      .map((b) => ({
        name: String(b.box ?? b.title ?? '').trim(),
        folders: folders(b.folders),
      }))
      .filter((b) => b.name),
  };
}
