import { defineConfig, loadEnv } from 'vite'
import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    build: {
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },
    server: {
      proxy: {
        "/api/v1": {
          target: env.API_PROXY_TARGET || "http://localhost:8000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/v1/, "/v1"),
          secure: false,
        },
      },
    },
  };
})
