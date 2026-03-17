import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync } from "fs";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "background/service-worker": resolve(
          __dirname,
          "src/background/service-worker.ts"
        ),
        "content/index": resolve(__dirname, "src/content/index.ts"),
        "popup/popup": resolve(__dirname, "src/popup/popup.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        format: "es",
      },
    },
    target: "esnext",
    minify: false,
    sourcemap: true,
  },
  plugins: [
    {
      name: "copy-extension-files",
      closeBundle() {
        copyFileSync(
          resolve(__dirname, "manifest.json"),
          resolve(__dirname, "dist/manifest.json")
        );
        mkdirSync(resolve(__dirname, "dist/popup"), { recursive: true });
        copyFileSync(
          resolve(__dirname, "src/popup/popup.html"),
          resolve(__dirname, "dist/popup/popup.html")
        );
      },
    },
  ],
});
