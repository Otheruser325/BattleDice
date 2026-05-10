const env = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env ?? {};

function isEnabled(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

const explicitDevMenuFlag = isEnabled(env.VITE_ENABLE_DEV_MENU);

export const ENABLE_DEV_MENU = explicitDevMenuFlag ?? env.DEV === true;
