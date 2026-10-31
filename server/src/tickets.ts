import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizePlayerName } from './protocol.js';

const TICKET_VERSION = 'v1';
const TICKET_AUDIENCE = 'battle-dice';
const MAX_TICKET_LENGTH = 1024;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const PLAYER_ID_PATTERN = /^p_[A-Za-z0-9_-]{16,64}$/;
const TICKET_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export interface TicketSubject {
  playerId: string;
  playerName: string;
}

export interface TicketClaims {
  sub: string;
  name: string;
  jti: string;
  iat: number;
  exp: number;
  ip?: string;
}

interface StoredClaims extends TicketClaims {
  v: typeof TICKET_VERSION;
  aud: typeof TICKET_AUDIENCE;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function createId(prefix: string): string {
  return `${prefix}${randomBytes(18).toString('base64url')}`;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isCanonicalBase64Url(value: string): boolean {
  try {
    return Buffer.from(value, 'base64url').toString('base64url') === value;
  } catch {
    return false;
  }
}

export class TicketService {
  private readonly key: Buffer;
  private readonly consumed = new Map<string, number>();

  constructor(
    secret: string,
    private readonly ttlSeconds: number
  ) {
    if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Ticket secret must be at least 32 bytes.');
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400) {
      throw new Error('Ticket TTL must be between 60 and 86400 seconds.');
    }
    this.key = Buffer.from(secret, 'utf8');
  }

  issue(subject: TicketSubject, ip?: string, now = nowSeconds()): { ticket: string; claims: TicketClaims } {
    if (!PLAYER_ID_PATTERN.test(subject.playerId)) throw new Error('Ticket subject player ID is invalid.');
    const playerName = normalizePlayerName(subject.playerName);
    if (!playerName) throw new Error('Ticket subject display name is invalid.');
    const iat = Math.floor(now);
    const claims: StoredClaims = {
      v: TICKET_VERSION,
      aud: TICKET_AUDIENCE,
      sub: subject.playerId,
      name: playerName,
      jti: createId(''),
      iat,
      exp: iat + this.ttlSeconds,
      ...(ip ? { ip } : {})
    };
    const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const signingInput = `${TICKET_VERSION}.${payload}`;
    const signature = createHmac('sha256', this.key).update(signingInput).digest('base64url');
    return {
      ticket: `${signingInput}.${signature}`,
      claims: {
        sub: claims.sub,
        name: claims.name,
        jti: claims.jti,
        iat: claims.iat,
        exp: claims.exp,
        ...(claims.ip ? { ip: claims.ip } : {})
      }
    };
  }

  consume(ticket: string, now = nowSeconds()): TicketClaims | null {
    const claims = this.verify(ticket, now);
    if (!claims) return null;
    this.pruneConsumed(now);
    if (this.consumed.has(claims.jti)) return null;
    this.consumed.set(claims.jti, claims.exp);
    return claims;
  }

  verify(ticket: string, now = nowSeconds()): TicketClaims | null {
    if (typeof ticket !== 'string' || ticket.length < 32 || ticket.length > MAX_TICKET_LENGTH) return null;
    const parts = ticket.split('.');
    if (parts.length !== 3) return null;
    const [version, payloadPart, signaturePart] = parts;
    if (version !== TICKET_VERSION) return null;
    if (!payloadPart || !signaturePart) return null;
    if (!BASE64URL_PATTERN.test(payloadPart) || !BASE64URL_PATTERN.test(signaturePart)) return null;
    if (!isCanonicalBase64Url(payloadPart) || !isCanonicalBase64Url(signaturePart)) return null;

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
    if (raw.v !== TICKET_VERSION || raw.aud !== TICKET_AUDIENCE) return null;
    if (typeof raw.sub !== 'string' || !PLAYER_ID_PATTERN.test(raw.sub)) return null;
    if (typeof raw.name !== 'string') return null;
    const playerName = normalizePlayerName(raw.name);
    if (!playerName || playerName !== raw.name) return null;
    if (typeof raw.jti !== 'string' || !TICKET_ID_PATTERN.test(raw.jti)) return null;
    if (!isSafeInteger(raw.iat) || !isSafeInteger(raw.exp)) return null;
    if (raw.iat > now + 60 || raw.exp <= now) return null;
    if (raw.exp - raw.iat > this.ttlSeconds + 60) return null;
    const ip = typeof raw.ip === 'string' && raw.ip.length > 0 && raw.ip.length <= 64 ? raw.ip : undefined;

    return {
      sub: raw.sub,
      name: playerName,
      jti: raw.jti,
      iat: raw.iat,
      exp: raw.exp,
      ...(ip ? { ip } : {})
    };
  }

  private pruneConsumed(now: number): void {
    for (const [ticketId, expiresAt] of this.consumed) {
      if (expiresAt > now) continue;
      this.consumed.delete(ticketId);
    }
  }
}
