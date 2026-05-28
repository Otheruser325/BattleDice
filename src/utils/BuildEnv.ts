type BuildEnvValue = string | boolean | undefined;
type BuildEnv = Record<string, BuildEnvValue> & {
  BASE_URL?: string;
  DEV?: boolean;
  MODE?: string;
  PROD?: boolean;
  VITE_RIVALIS_TICKET?: string;
  VITE_RIVALIS_WS_URL?: string;
};

const TRUTHY_VALUES = ['1', 'true', 'yes', 'on'];
const FALSY_VALUES = ['0', 'false', 'no', 'off'];

export const BUILD_ENV = (import.meta as unknown as { env?: BuildEnv }).env ?? {};

export function readBooleanEnv(key: string): boolean | undefined {
  const value = BUILD_ENV[key];
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (TRUTHY_VALUES.includes(normalized)) return true;
  if (FALSY_VALUES.includes(normalized)) return false;
  return undefined;
}

export function isDevBuild(): boolean {
  return BUILD_ENV.DEV === true;
}

export function withBasePath(path: string): string {
  const base = typeof BUILD_ENV.BASE_URL === 'string' ? BUILD_ENV.BASE_URL : '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return `${normalizedBase}${normalizedPath}`;
}
