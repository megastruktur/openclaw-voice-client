import { defineConfig } from "vite";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig({
  clearScreen: false,
  root: "src",
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup.html"),
        settings: resolve(__dirname, "src/settings.html"),
      },
    },
    outDir: "../dist",
    emptyOutDir: true,
  },
});
