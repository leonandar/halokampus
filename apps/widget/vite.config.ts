import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Single self-contained IIFE bundle, served by the web app at /widget/halokampus-widget.js (FR-45, ADR-03).
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: "../web/public/widget",
    emptyOutDir: true,
    lib: { entry: "src/main.tsx", name: "HaloKampusWidget", formats: ["iife"], fileName: () => "halokampus-widget.js" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
