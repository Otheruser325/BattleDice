import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function resolveBasePath(): string {
  const explicit = process.env.REPO_FIX?.trim() || process.env.VITE_BASE_PATH?.trim();
  if (explicit) {
    const normalized = explicit.replace(/^\/+|\/+$/g, '');
    return normalized ? `/${normalized}/` : '/';
  }

  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]?.trim();
  if (repo) return `/${repo}/`;
  return '/';
}

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["lucide-react"],
  },
  base: resolveBasePath(),
  build: {
    outDir: "dist",
  },
  define: {},
});
