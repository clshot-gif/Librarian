import { GOOGLE_CLIENT_ID, OAUTH_SCOPES } from '../config.js';

// Same on-demand GSI script loading approach as batch-uploader/src/auth.js —
// avoids racing a <script async> tag on slow connections.
let tokenClient = null;
let accessToken = null;
let scriptLoadPromise = null;

function loadGsiScript() {
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Google sign-in script'));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export async function initAuth() {
  await loadGsiScript();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: OAUTH_SCOPES,
    callback: () => {}, // overridden per-call by signIn()
  });
}

export function signIn() {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      accessToken = response.access_token;
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

// Who is signed in — used to attribute comments/tags ("Hannah — 'this
// contradicts the earlier letter'"). First name preferred, email fallback.
export async function fetchUserInfo(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { name: 'Unknown', email: '' };
  const data = await res.json();
  return {
    name: data.given_name || data.name || data.email || 'Unknown',
    email: data.email || '',
  };
}

export function signOut() {
  if (accessToken) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
}

export function getAccessToken() {
  return accessToken;
}
