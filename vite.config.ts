import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["lucide-react"],
  },
  base: process.env.REPO_FIX || '/',
  build: {
    outDir: "dist",
  },
  define: {},
});
