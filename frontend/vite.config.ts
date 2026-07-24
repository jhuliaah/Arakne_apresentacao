import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_URL = process.env.API_URL || "http://localhost:8000";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // @breeztech/breez-sdk-spark carrega um módulo WebAssembly em runtime
  // (await init(), ver src/lib/breez-wallet.ts) — excluir do pre-bundling
  // do Vite é o ajuste mais comum pra pacotes WASM não quebrarem no dev
  // server. Se o npm run dev reclamar de algo relacionado a esse pacote
  // mesmo assim, essa é a primeira config a revisar.
  optimizeDeps: {
    exclude: ["@breeztech/breez-sdk-spark"],
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: API_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
