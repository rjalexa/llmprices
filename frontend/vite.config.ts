import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = process.env.VITE_BACKEND_URL ?? "http://localhost:8000";

// GitHub Pages serves a project site from /<repo>/, so assets need that prefix.
// Docker and local dev serve from the root and leave it unset.
const base = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: backend, changeOrigin: true },
    },
  },
});
