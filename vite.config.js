import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { fileURLToPath, URL } from "node:url";
import manifest from "./manifest.json";

const SRC_DIR = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig(({ command }) => ({
  plugins: [crx({ manifest })],
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "preact",
    },
  },
  resolve: {
    alias: {
      "@": SRC_DIR,
      src: SRC_DIR,
      react: "preact/compat",
      "react-dom": "preact/compat",
      "react-dom/test-utils": "preact/test-utils",
      "react/jsx-runtime": "preact/jsx-runtime",
      "react/jsx-dev-runtime": "preact/jsx-runtime",
    },
  },
  build: {
    outDir: command === "build" ? "dist" : "dev",
    emptyOutDir: command === "build",
  },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    cors: {
      origin: "*",
    },
    hmr: {
      host: "localhost",
      protocol: "ws",
      port: 5173,
      clientPort: 5173,
    },
  },
  test: {
    include: ["tests/**/*.test.js"],
  },
}));
