import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  optimizeDeps: {
    exclude: ["lucide-react"],
  },
  base: '/BattleDice/' || '/',
  build: {
    outDir: "dist",
  },
  define: {},
});
