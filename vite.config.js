import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// ---------------------------------------------------------------------------
// Enterprise-grade Vite config for Atlas Command
// - Enables "@" import alias that points to ./src
// - Compatible with React + Supabase + Tailwind
// - Removes duplicate React declaration
// ---------------------------------------------------------------------------

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    open: true,
    hmr: {
      overlay: true,
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
