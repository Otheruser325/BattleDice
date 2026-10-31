import { randomBytes } from 'node:crypto';

const DEFAULT_DEV_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];
const PRODUCTION = process.env.NODE_ENV === 'production';

function readInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`${name} must be a boolean.`);
}

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return url.origin;
  } catch {
    throw new Error(`Invalid origin: ${value}`);
  }
}

function readAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw) {
    if (PRODUCTION) throw new Error('ALLOWED_ORIGINS is required in production.');
    return [...DEFAULT_DEV_ORIGINS];
  }
  const origins = raw.split(',').map((value) => normalizeOrigin(value.trim())).filter(Boolean);
  if (origins.length === 0) throw new Error('ALLOWED_ORIGINS must contain at least one origin.');
  return [...new Set(origins)];
}

function readTicketSecret(): string {
  const configured = process.env.TICKET_SECRET?.trim();
  if (configured) {
    if (Buffer.byteLength(configured, 'utf8') < 32) {
      throw new Error('TICKET_SECRET must be at least 32 bytes.');
    }
    return configured;
  }
  if (PRODUCTION) throw new Error('TICKET_SECRET is required in production.');
  console.warn('[server] TICKET_SECRET is unset; using an ephemeral development secret.');
  return randomBytes(32).toString('base64url');
}

export const serverConfig = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  production: PRODUCTION,
  host: process.env.HOST?.trim() || '0.0.0.0',
  port: readInteger('PORT', 8080, 1, 65535),
  trustProxy: readBoolean('TRUST_PROXY', false),
  allowedOrigins: readAllowedOrigins(),
  ticketSecret: readTicketSecret(),
  ticketTtlSeconds: readInteger('TICKET_TTL_SECONDS', 7200, 60, 86400),
  ticketRequestsPerMinute: readInteger('TICKET_REQUESTS_PER_MINUTE', 30, 1, 300),
  guestIdentityTtlSeconds: readInteger('GUEST_IDENTITY_TTL_SECONDS', 2_592_000, 3600, 31_536_000),
  identityRequestsPerMinute: readInteger('IDENTITY_REQUESTS_PER_MINUTE', 20, 1, 300),
  maxActors: readInteger('MAX_ACTORS', 512, 2, 5000),
  maxQueue: readInteger('MAX_QUEUE', 200, 1, 5000),
  maxLobbies: readInteger('MAX_LOBBIES', 100, 1, 5000),
  maxMatches: readInteger('MAX_MATCHES', 100, 1, 5000),
  queueTtlMs: readInteger('QUEUE_TTL_SECONDS', 300, 30, 3600) * 1000,
  lobbyTtlMs: readInteger('LOBBY_TTL_SECONDS', 900, 60, 86400) * 1000,
  matchTtlMs: readInteger('MATCH_TTL_SECONDS', 1800, 60, 86400) * 1000,
  reconnectGraceMs: readInteger('RECONNECT_GRACE_SECONDS', 45, 5, 300) * 1000,
  actionLimit: readInteger('ACTION_LIMIT', 12, 1, 300),
  actionWindowMs: readInteger('ACTION_WINDOW_SECONDS', 60, 1, 3600) * 1000,
  lobbyJoinLimit: readInteger('LOBBY_JOIN_LIMIT', 8, 1, 100),
  lobbyJoinWindowMs: readInteger('LOBBY_JOIN_WINDOW_SECONDS', 60, 1, 3600) * 1000
});
