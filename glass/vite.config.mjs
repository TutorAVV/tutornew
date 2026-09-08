import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local development talks to the existing Tutor Booking server through Vite.
// In Render production, glass/server.js provides the same relative /api proxy.
const apiOrigin = process.env.API_ORIGIN || "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiOrigin,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
  },
});
