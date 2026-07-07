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

// Opens the picker in folder-selection mode with multi-select on (filing
// often means an Unprocessed batch and its destination collection at once).
// Resolves to [{id, name}] — empty array if the user cancels.
export async function pickFolders(oauthToken) {
  await loadPickerScript();
  return new Promise((resolve) => {
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setIncludeFolders(true)
      .setMode(window.google.picker.DocsViewMode.LIST);

    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(oauthToken)
      .setDeveloperKey(PICKER_API_KEY)
      .setAppId(GOOGLE_APP_ID)
      .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
      .setTitle('Choose the folder(s) to work in')
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) {
          resolve(data.docs.map((d) => ({ id: d.id, name: d.name })));
        } else if (data.action === window.google.picker.Action.CANCEL) {
          resolve([]);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
