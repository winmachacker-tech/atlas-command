import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

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
    // 👇 Allow your ngrok domain so you can access Atlas via HTTPS tunnel
    allowedHosts: [
      "unconcernedly-unlarge-adaline.ngrok-free.dev",
      "localhost",
      "127.0.0.1",
    ],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
