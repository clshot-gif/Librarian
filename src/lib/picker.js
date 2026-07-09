import { PICKER_API_KEY, GOOGLE_APP_ID } from '../config.js';

// Google Picker — the "browse your real Drive" folder chooser. Loaded on
// demand like the GSI script (see auth.js for why).
let pickerLoadPromise = null;

function loadPickerScript() {
  if (pickerLoadPromise) return pickerLoadPromise;
  pickerLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => {
      window.gapi.load('picker', { callback: resolve, onerror: reject });
    };
    script.onerror = () => reject(new Error('Failed to load Google Picker script'));
    document.head.appendChild(script);
  });
  return pickerLoadPromise;
}

export function pickerConfigured() {
  return Boolean(PICKER_API_KEY);
}

// How long the Picker gets to signal life (its LOADED callback) before we
// declare it broken. Generous — this only has to beat "never", which is what
// a failed Picker used to deliver: no PICKED, no CANCEL, no throw, promise
// pending forever, UI trapped behind it (the "developer key is invalid"
// incident). Once LOADED fires the timeout is cancelled — the user can
// browse folders for an hour if they like.
const PICKER_LOAD_TIMEOUT_MS = 30_000;

// Opens the picker in folder-selection mode with multi-select on (filing
// often means an Unprocessed batch and its destination collection at once).
// Resolves to [{id, name}] — empty array if the user cancels. Rejects (never
// hangs) when the Picker fails to come up.
export async function pickFolders(oauthToken) {
  await loadPickerScript();
  return new Promise((resolve, reject) => {
    let picker = null;
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try {
        picker?.setVisible(false);
        picker?.dispose?.();
      } catch {
        /* already broken — nothing to clean up */
      }
      settle(
        reject,
        new Error(
          `Google's folder picker didn't load within ${PICKER_LOAD_TIMEOUT_MS / 1000}s. ` +
            `This is usually its "developer key is invalid" failure (which reports ` +
            `nothing back to the page) or a network problem — try again, and check the ` +
            `Picker API key/config if it keeps happening.`,
        ),
      );
    }, PICKER_LOAD_TIMEOUT_MS);

    try {
      const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setMode(window.google.picker.DocsViewMode.LIST);

      picker = new window.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(oauthToken)
        .setDeveloperKey(PICKER_API_KEY)
        .setAppId(GOOGLE_APP_ID)
        .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
        .setTitle('Choose the folder(s) to work in')
        .setCallback((data) => {
          if (data.action === window.google.picker.Action.PICKED) {
            settle(
              resolve,
              data.docs.map((d) => ({ id: d.id, name: d.name })),
            );
          } else if (data.action === window.google.picker.Action.CANCEL) {
            settle(resolve, []);
          } else if (data.action === window.google.picker.Action.LOADED) {
            // Alive — from here on the user controls the pace.
            clearTimeout(timer);
          }
        })
        .build();
      picker.setVisible(true);
    } catch (err) {
      // A throw during construction used to escape this promise entirely.
      settle(reject, err instanceof Error ? err : new Error(String(err)));
    }
  });
}
