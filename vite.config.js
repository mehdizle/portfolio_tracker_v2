import { defineConfig } from "vite";

// v2 GitHub Pages project site: https://mehdizle.github.io/portfolio_tracker_v2/
// base MUST match the repo name or built asset URLs 404.
export default defineConfig({
  base: "/portfolio_tracker_v2/",
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
