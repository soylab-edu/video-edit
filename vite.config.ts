import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.data/**', '**/.venv/**'],
    },
    watch: { ignored: ["**/.data/**", "**/.venv/**", "**/test-results/**"] },
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/media": "http://127.0.0.1:3001",
    },
  },
  build: { outDir: "dist" },
});
