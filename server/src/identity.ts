import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizePlayerName } from './protocol.js';

const IDENTITY_VERSION = 'g1';
const IDENTITY_AUDIENCE = 'battle-dice-guest';
const MAX_TOKEN_LENGTH = 2048;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const PLAYER_ID_PATTERN = /^p_[A-Za-z0-9_-]{16,64}$/;

export const GUEST_COOKIE_NAME = 'bd_guest';

export interface GuestIdentity {
  playerId: string;
  playerName: string;
  issuedAt: number;
  expiresAt: number;
}

interface StoredClaims {
  v: typeof IDENTITY_VERSION;
  aud: typeof IDENTITY_AUDIENCE;
  sub: string;
  name: string;
  iat: number;
  exp: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function createPlayerId(): string {
  return `p_${randomBytes(18).toString('base64url')}`;
}

function defaultPlayerName(): string {
  return `Duelist-${randomBytes(2).toString('hex').toUpperCase()}`;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export class GuestIdentityService {
  private readonly key: Buffer;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
    private readonly secureCookies: boolean
  ) {
    if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Guest identity secret must be at least 32 bytes.');
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 3600 || ttlSeconds > 365 * 24 * 60 * 60) {
      throw new Error('Guest identity TTL must be between 1 hour and 365 days.');
    }
    this.key = createHmac('sha256', secret).update('guest-identity-v1').digest();
  }

  create(playerName?: string, now = nowSeconds()): GuestIdentity {
    const normalized = normalizePlayerName(playerName ?? '') ?? defaultPlayerName();
    const iat = Math.floor(now);
    return {
      playerId: createPlayerId(),
      playerName: normalized,
      issuedAt: iat,
      expiresAt: iat + this.ttlSeconds
    };
  }

  rename(identity: GuestIdentity, playerName: string, now = nowSeconds()): GuestIdentity | null {
    const normalized = normalizePlayerName(playerName);
    if (!normalized) return null;
    const iat = Math.floor(now);
    return {
      ...identity,
      playerName: normalized,
      issuedAt: iat,
      expiresAt: iat + this.ttlSeconds
    };
  }

  encode(identity: GuestIdentity): string {
    const claims: StoredClaims = {
      v: IDENTITY_VERSION,
      aud: IDENTITY_AUDIENCE,
      sub: identity.playerId,
      name: identity.playerName,
      iat: identity.issuedAt,
      exp: identity.expiresAt
    };
    const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const signingInput = `${IDENTITY_VERSION}.${payload}`;
    const signature = createHmac('sha256', this.key).update(signingInput).digest('base64url');
    return `${signingInput}.${signature}`;
  }

  verify(token: string, now = nowSeconds()): GuestIdentity | null {
    if (typeof token !== 'string' || token.length < 32 || token.length > MAX_TOKEN_LENGTH) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [version, payloadPart, signaturePart] = parts;
    if (version !== IDENTITY_VERSION) return null;
    if (!payloadPart || !signaturePart) return null;
    if (!BASE64URL_PATTERN.test(payloadPart) || !BASE64URL_PATTERN.test(signaturePart)) return null;

    const expected = createHmac('sha256', this.key)
      .update(`${version}.${payloadPart}`)
      .digest();
    const provided = Buffer.from(signaturePart, 'base64url');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

    let claims: unknown;
    try {
      claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) return null;
    const raw = claims as Record<string, unknown>;
    if (raw.v !== IDENTITY_VERSION || raw.aud !== IDENTITY_AUDIENCE) return null;
    if (typeof raw.sub !== 'string' || !PLAYER_ID_PATTERN.test(raw.sub)) return null;
    if (typeof raw.name !== 'string') return null;
    const playerName = normalizePlayerName(raw.name);
    if (!playerName || playerName !== raw.name) return null;
    if (!isSafeInteger(raw.iat) || !isSafeInteger(raw.exp)) return null;
    if (raw.iat > now + 60 || raw.exp <= now) return null;
    if (raw.exp - raw.iat > this.ttlSeconds + 60) return null;

    return {
      playerId: raw.sub,
      playerName,
      issuedAt: raw.iat,
      expiresAt: raw.exp
    };
  }

  readCookie(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0) continue;
      if (part.slice(0, separator).trim() !== GUEST_COOKIE_NAME) continue;
      const value = part.slice(separator + 1).trim();
      return value.length > 0 ? value : null;
    }
    return null;
  }

  cookie(identity: GuestIdentity, now = nowSeconds()): string {
    const maxAge = Math.max(0, identity.expiresAt - Math.floor(now));
    const sameSite = this.secureCookies ? 'None' : 'Lax';
    const secure = this.secureCookies ? '; Secure' : '';
    return `${GUEST_COOKIE_NAME}=${this.encode(identity)}; Path=/api; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure}`;
  }
}
