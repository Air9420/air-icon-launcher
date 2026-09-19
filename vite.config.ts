/// <reference types="vitest" />
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function normalizeId(id: string): string {
  return id.replace(/\\/g, "/");
}

export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      "@solar-icons/vue": path.resolve(__dirname, "src/icons/solar-icons.ts"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // 环境区分配置
  envPrefix: ["VITE_"],

  // 生产环境构建优化
  build: {
    target: "esnext",
    minify: "esbuild",
    cssMinify: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        // PERF-A: keep icons / cordis / marked out of the main index chunk.
        // Icons are also side-effect-free re-exports (see src/icons/*).
        manualChunks(id: string) {
          const n = normalizeId(id);
          if (n.includes("/src/icons/") || n.includes("src/icons/")) return "icons";
          if (n.includes("node_modules/cordis") || n.includes("/cordis/")) return "cordis";
          if (n.includes("node_modules/marked") || n.includes("/marked/")) return "marked";
          if (n.includes("@solar-icons")) return "icons";
          if (n.includes("@tauri-apps/api/core") || n.includes("@tauri-apps/api/event")) {
            return "tauri";
          }
          if (
            n.includes("node_modules/vue/") ||
            n.includes("node_modules/vue-router/") ||
            n.includes("node_modules/pinia/")
          ) {
            return "vendor";
          }
          if (n.includes("@vueuse/core")) return "utils";
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 500,
    reportCompressedSize: false,
  },

  // 依赖优化
  optimizeDeps: {
    include: ["vue", "vue-router", "pinia", "@vueuse/core", "cordis"],
  },
});
