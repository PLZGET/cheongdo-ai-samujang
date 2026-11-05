import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // API_TARGET을 주면 배포된 백엔드로 프록시해 로컬 토큰 없이 화면을 확인할 수 있다.
    proxy: { "/api": { target: process.env.API_TARGET ?? "http://127.0.0.1:8000", changeOrigin: true } },
  },
});
