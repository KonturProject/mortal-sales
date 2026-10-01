import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    phaser: ['phaser']
                }
            }
        },
    },
    server: {
        port: 8080,
        // Explicit IPv4: "localhost" can resolve to ::1 only, which browsers/preview panes that try 127.0.0.1 never reach.
        host: '127.0.0.1'
    }
});
