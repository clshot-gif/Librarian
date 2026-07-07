import React, { useState } from 'react';
import { pickerConfigured } from '../lib/picker.js';

export default function PickerScreen({ onDemo, onDrive, error }) {
  const [busy, setBusy] = useState(false);
  const ready = pickerConfigured();

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="picker-screen">
      <div style={{ textAlign: 'center' }}>
        <h1>Archive <span style={{ color: 'var(--sage)' }}>Review</span></h1>
        <p className="tagline">Browse, mark up, and file your scanned documents.</p>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className="picker-cards">
        <div className="picker-card">
          <h2>Open your Drive</h2>
          <p>
            Sign in with Google, then choose the folder or folders you want to
            work in — a filed collection, an “Unprocessed” batch, or both at
            once. You can switch folders any time.
          </p>
          {!ready && (
            <div className="setup-note">
              One-time setup needed: the Drive folder picker requires an API
              key. Instructions are at the top of <code>src/config.js</code> —
              about two minutes in Google Cloud Console.
            </div>
          )}
          <button className="btn primary" disabled={busy || !ready} onClick={() => run(onDrive)}>
            Sign in with Google
          </button>
        </div>
        <div className="picker-card">
          <h2>Explore the sample archive</h2>
          <p>
            A realistic pretend corpus: one filed collection (“Good Poems”)
            and one unfiled batch-upload tree, with real PDFs you can open,
            mark up, and file. Nothing touches your Drive.
          </p>
          <button className="btn" disabled={busy} onClick={() => run(onDemo)}>
            Open sample archive
          </button>
        </div>
      </div>
    </div>
  );
}
