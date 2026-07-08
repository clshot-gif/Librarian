// Drive REST calls — same calling pattern (and retry policy) as
// batch-uploader/src/drive.js, extended with the read/move/update operations
// this tool needs that the uploader didn't.
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

const FILE_FIELDS = 'id,name,mimeType,parents,createdTime,webViewLink,properties';

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status, bodyText) {
  if (status === 429) return true;
  if (status >= 500) return true;
  if (status === 403 && /rateLimitExceeded|userRateLimitExceeded|backendError/.test(bodyText))
    return true;
  return false;
}

async function fetchWithRetry(url, options, { retries = 4, baseDelayMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, options);
    if (res.ok) return res;
    const bodyText = await res.text();
    if (attempt >= retries || !isRetryable(res.status, bodyText)) {
      throw new Error(`${res.status} ${bodyText}`);
    }
    await sleep(baseDelayMs * 2 ** attempt);
  }
}

// One folder's direct children (files and subfolders), following pagination.
export async function listChildren(token, folderId) {
  const results = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: '1000',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetchWithRetry(`${FILES_URL}?${params}`, { headers: authHeaders(token) });
    const data = await res.json();
    results.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return results;
}

export async function getFileMeta(token, fileId) {
  const res = await fetchWithRetry(`${FILES_URL}/${fileId}?fields=${FILE_FIELDS}`, {
    headers: authHeaders(token),
  });
  return res.json();
}

export async function downloadFile(token, fileId) {
  const res = await fetchWithRetry(`${FILES_URL}/${fileId}?alt=media`, {
    headers: authHeaders(token),
  });
  return new Uint8Array(await res.arrayBuffer());
}

// Drive merges `properties` per-key on PATCH; setting a key to null deletes it.
export async function updateProperties(token, fileId, properties) {
  await fetchWithRetry(`${FILES_URL}/${fileId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties }),
  });
}

export async function renameFile(token, fileId, name) {
  await fetchWithRetry(`${FILES_URL}/${fileId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function moveFile(token, fileId, newParentId, oldParentId) {
  const params = new URLSearchParams({ addParents: newParentId });
  if (oldParentId) params.set('removeParents', oldParentId);
  await fetchWithRetry(`${FILES_URL}/${fileId}?${params}`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function trashFile(token, fileId) {
  await fetchWithRetry(`${FILES_URL}/${fileId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

export async function createFolder(token, name, parentId) {
  const body = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const res = await fetchWithRetry(FILES_URL, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const folder = await res.json();
  return folder.id;
}

// Two-step upload (metadata, then binary), same as the uploader.
export async function uploadPdf(token, { bytes, filename, folderId, properties }) {
  const metaRes = await fetchWithRetry(FILES_URL, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: filename, parents: [folderId], properties }),
  });
  const { id: fileId } = await metaRes.json();

  await fetchWithRetry(`${UPLOAD_URL}/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/pdf' },
    body: bytes,
  });
  return fileId;
}

// Replace an existing file's PDF bytes in place (markup bake, notes page).
export async function updatePdfContent(token, fileId, bytes) {
  await fetchWithRetry(`${UPLOAD_URL}/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/pdf' },
    body: bytes,
  });
}
