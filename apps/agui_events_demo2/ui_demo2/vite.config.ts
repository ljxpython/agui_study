import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  const port = Number(env.VITE_DEV_PORT ?? 5174);
  const backendUrl = env.VITE_BACKEND_URL ?? "http://localhost:8123";

  return {
    plugins: [react()],
    server: {
      port,
      strictPort: true,
      proxy: {
        "/api": {
          target: backendUrl,
          changeOrigin: true,
          secure: false,
          ws: false,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
