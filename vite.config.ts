import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { assertNoDevOnlyFlags } from "./scripts/env-utils.mjs";

function resolveBasePath(env: Record<string, string>): string {
  const explicit = process.env.REPO_FIX?.trim() || env.VITE_BASE_PATH?.trim();
  if (explicit) {
    const normalized = explicit.replace(/^\/+|\/+$/g, '');
    return normalized ? `/${normalized}/` : '/';
  }

  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]?.trim();
  if (repo) return `/${repo}/`;
  return '/';
}

function guardDevOnlyFlags(env: Record<string, string>): Plugin {
  return {
    name: 'battle-dice-guard-dev-flags',
    apply: 'build',
    configResolved() {
      // A Vite build always bakes PROD=true/DEV=false, so dev-only flags must never ship here.
      assertNoDevOnlyFlags(env, { isDevBuild: false, buildLabel: 'a non-development build' });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), guardDevOnlyFlags(env)],
    optimizeDeps: {
      exclude: ["lucide-react"],
    },
    base: resolveBasePath(env),
    build: {
      outDir: "dist",
    },
    define: {},
  };
});
