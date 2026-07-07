// OAuth client: reuses the batch uploader's "Web application" client ID
// (Google Cloud project 526107030062 — same project as the mobile app, which
// matters: drive.file visibility is per-project, so this tool can see the
// files the mobile app and batch uploader created without any extra sharing).
// http://localhost:5173 is already an authorized origin on that client.
// If this tool ever gets its own hosted URL (e.g. GitHub Pages), add that
// origin to the same client in Cloud Console -> APIs & Services -> Credentials.
export const GOOGLE_CLIENT_ID =
  '526107030062-6oi1efntt7ube02q4v1l63gv0k2hpn4p.apps.googleusercontent.com';

// drive.file (not full drive): only files/folders this Cloud project's apps
// created, or that the user explicitly opens via the Google Picker below.
// userinfo scopes are for attribution — first name on comments/tags.
export const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

// The Google Picker (the "browse your real Drive" folder chooser) needs a
// plain API key in addition to the OAuth token. One-time setup, ~2 minutes:
//   Google Cloud Console, project 526107030062
//   1. APIs & Services -> Library -> enable "Google Picker API"
//   2. APIs & Services -> Credentials -> Create Credentials -> API key
//   3. (Recommended) restrict the key: API restrictions -> Google Picker API;
//      Website restrictions -> http://localhost:5173/*
//   4. Paste the key below. Like the client ID it is a public identifier,
//      not a secret — safe to commit once restricted.
// Until this is filled in, the app still fully works in Sample mode.
export const PICKER_API_KEY = '';

// The Cloud project number — the Picker uses it to tell Drive which "app"
// is being granted drive.file access to the picked folders.
export const GOOGLE_APP_ID = '526107030062';
