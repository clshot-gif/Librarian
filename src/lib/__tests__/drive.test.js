import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { uploadPdf, updatePdfContent } from '../drive.js';

// Fake fetch that scripts each call's reply and records every request.
function scriptedFetch(replies) {
  const calls = [];
  const fn = vi.fn(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const r = replies.shift();
    if (!r) throw new Error(`unscripted fetch call: ${url}`);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: new Headers(r.headers || {}),
      text: async () => r.body || '',
      json: async () => JSON.parse(r.body || '{}'),
    };
  });
  fn.calls = calls;
  return fn;
}

const MB = 1024 * 1024;

describe('Drive uploads and the 5MB simple-upload cap', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => vi.useRealTimers());

  it('small files keep the simple uploadType=media path', async () => {
    const fetch = scriptedFetch([
      { status: 200, body: '{"id":"f1"}' }, // metadata create
      { status: 200 }, // media PATCH
    ]);
    vi.stubGlobal('fetch', fetch);
    const id = await uploadPdf('tok', {
      bytes: new Uint8Array(1 * MB),
      filename: 'x.pdf',
      folderId: 'root',
      properties: {},
    });
    expect(id).toBe('f1');
    expect(fetch.calls[1].url).toContain('uploadType=media');
  });

  it('large files open a resumable session and upload in Content-Range chunks', async () => {
    const total = 9 * MB; // 2 chunks at 8MB
    const fetch = scriptedFetch([
      { status: 200, body: '{"id":"f2"}' },
      { status: 200, headers: { location: 'https://upload.example/session-1' } },
      { status: 308, headers: { range: `bytes=0-${8 * MB - 1}` } },
      { status: 200 },
    ]);
    vi.stubGlobal('fetch', fetch);
    await uploadPdf('tok', {
      bytes: new Uint8Array(total),
      filename: 'big.pdf',
      folderId: 'root',
      properties: {},
    });
    expect(fetch.calls[1].url).toContain('uploadType=resumable');
    expect(fetch.calls[1].options.headers['X-Upload-Content-Length']).toBe(String(total));
    expect(fetch.calls[2].url).toBe('https://upload.example/session-1');
    expect(fetch.calls[2].options.headers['Content-Range']).toBe(`bytes 0-${8 * MB - 1}/${total}`);
    expect(fetch.calls[3].options.headers['Content-Range']).toBe(
      `bytes ${8 * MB}-${total - 1}/${total}`,
    );
    expect(fetch.calls[3].options.body.length).toBe(total - 8 * MB);
  });

  it('resumes from the byte Drive reports when a chunk lands partially', async () => {
    const total = 9 * MB;
    const partial = 4 * MB; // Drive only kept half the first chunk
    const fetch = scriptedFetch([
      { status: 200, headers: { location: 'https://upload.example/session-2' } },
      { status: 308, headers: { range: `bytes=0-${partial - 1}` } },
      { status: 308, headers: { range: `bytes=0-${8 * MB - 1}` } },
      { status: 200 },
    ]);
    vi.stubGlobal('fetch', fetch);
    await updatePdfContent('tok', 'f3', new Uint8Array(total));
    expect(fetch.calls[2].options.headers['Content-Range']).toBe(
      `bytes ${partial}-${total - 1}/${total}`,
    );
  });

  it('a non-retryable session failure surfaces instead of hanging or silently passing', async () => {
    const fetch = scriptedFetch([
      { status: 200, headers: { location: 'https://upload.example/session-3' } },
      { status: 403, body: 'storageQuotaExceeded' },
    ]);
    vi.stubGlobal('fetch', fetch);
    await expect(updatePdfContent('tok', 'f4', new Uint8Array(6 * MB))).rejects.toThrow(
      /403 storageQuotaExceeded/,
    );
  });
});
