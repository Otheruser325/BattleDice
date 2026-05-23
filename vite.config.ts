import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  optimizeDeps: {
    exclude: ["lucide-react"],
  },
  base: process.env.REPO_FIX ? '/BattleDice/' : '/',
  build: {
    outDir: "dist",
  },
  define: {},
});