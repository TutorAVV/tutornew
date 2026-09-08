import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Vite is only for rapid React work. It sends the browser's relative /api
// requests to this folder's standalone Node server, never to the old site.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiOrigin = env.API_ORIGIN || process.env.API_ORIGIN || "http://localhost:3000";

  return {
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
  };
});
