import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const DEV_ONLY_FLAGS = ['VITE_ENABLE_DEV_MENU', 'VITE_DEBUG_LOGS'];
const TRUTHY_VALUES = ['1', 'true', 'yes', 'on'];

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

function guardDevOnlyFlags(env: Record<string, string>, mode: string): Plugin {
  return {
    name: 'battle-dice-guard-dev-flags',
    apply: 'build',
    configResolved() {
      if (mode === 'development') return;
      const enabled = DEV_ONLY_FLAGS.filter((key) => TRUTHY_VALUES.includes(env[key]?.trim().toLowerCase()));
      if (enabled.length > 0) {
        throw new Error(`Refusing to ship a non-development build with dev-only flags enabled: ${enabled.join(', ')}`);
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), guardDevOnlyFlags(env, mode)],
    optimizeDeps: {
      exclude: ["lucide-react"],
    },
    base: resolveBasePath(),
    build: {
      outDir: "dist",
    },
    define: {},
  };
});
