import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base '/Librarian/' for the production build only, because GitHub Pages serves
// a project site under /<repo>/ (https://clshot-gif.github.io/Librarian/). Dev
// stays at '/' so localhost:5173 (the OAuth-authorized origin) is unchanged.
//
// Port 5173 is pinned (strictPort) because the Google OAuth client this tool
// reuses (see src/config.js) has http://localhost:5173 as an authorized local
// origin — a fallback port would silently break real sign-in.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/Librarian/' : '/',
  server: { port: 5173, strictPort: true, host: true },
}));
