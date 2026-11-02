import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The client lives in client/ and is served by the Express server in production (client/dist).
// In development Vite serves it and forwards /api to the server on :8080 (npm run dev starts both).
export default defineConfig({
    root: 'client',
    plugins: [react()],
    server: {
        port: 5173,
        proxy: { '/api': 'http://127.0.0.1:8080' },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        chunkSizeWarningLimit: 700,
    },
});
