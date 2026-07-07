import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 5173 is pinned (strictPort) because the Google OAuth client this tool
// reuses (see src/config.js) has http://localhost:5173 as its only authorized
// local origin — a fallback port would silently break real sign-in.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, host: true },
});
