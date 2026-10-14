/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // 正式包挂在 /dist/ 下。开发仍在站点根，避免本地和 e2e 跟着改地址
  base: mode === "production" ? "/dist/" : "/",
  plugins: [react(), tailwindcss()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/i18n/test-setup.ts"],
  },
}));
