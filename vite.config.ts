import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["lucide-react"],
  },
  base: "./",
  build: {
    outDir: "dist",
  },
  define: {
	'process.env': {},
    'process.platform': '""',
    'process.version': '""',
    'import.meta.env.VITE_ENABLE_DEV_MENU': JSON.stringify(process.env.VITE_ENABLE_DEV_MENU || 'true'),
    'import.meta.env.VITE_DEBUG_LOGS': JSON.stringify(process.env.VITE_DEBUG_LOGS || 'true'),
  },
});