import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Single source of truth for the app version: package.json. Injected into the
// bundle at build time via `define` (a global text replacement that reaches the
// concatenated UI bundle too), so code can read __APP_VERSION__ without an
// import. See js/09c-debug.js for a consumer (with a runtime fallback).
const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./package.json", import.meta.url)),
    "utf8",
  ),
);

// v2 GitHub Pages project site: https://mehdizle.github.io/portfolio_tracker_v2/
// base MUST match the repo name or built asset URLs 404.
export default defineConfig({
  base: "/portfolio_tracker_v2/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: "oxc", // Vite 8 default (Rolldown + Oxc). Mangling is safe (see note in src/main.js).
    rolldownOptions: {
      output: {
        entryFileNames: "assets/app.[hash].js",
        assetFileNames: "assets/[name].[hash][extname]",
      },
    },
  },
  // Vitest configuration (unit + reference tests for the financial core).
  test: {
    include: ["test/**/*.test.js"],
    environment: "node",
  },
});
