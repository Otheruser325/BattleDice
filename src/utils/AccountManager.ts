import { readIntegrityChecked, removeIntegrityChecked, writeIntegrityChecked } from './SecureStorage';
import { secureRandomBytes } from './RandomManager';

const SESSION_KEY = 'account:session';
const GUEST_KEY = 'account:guest';

export const ACCOUNT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AccountProvider = 'google' | 'discord' | 'guest';

export interface AccountSession {
  provider: AccountProvider;
  accountId: string;
  displayName: string;
  createdAt: string;
  expiresAt: number;
}

export interface GuestAccountRecord {
  accountId: string;
  displayName: string;
  createdAt: string;
  lastSeenAt: string;
}

const PROVIDERS: AccountProvider[] = ['google', 'discord', 'guest'];

function randomAccountId(provider: AccountProvider): string {
  return `${provider}-${Array.from(secureRandomBytes(16), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function isProvider(value: unknown): value is AccountProvider {
  return typeof value === 'string' && PROVIDERS.includes(value as AccountProvider);
}

function isSession(value: unknown): value is AccountSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<AccountSession>;
  return isProvider(session.provider)
    && typeof session.accountId === 'string'
    && session.accountId.length > 0
    && typeof session.displayName === 'string'
    && typeof session.createdAt === 'string'
    && typeof session.expiresAt === 'number'
    && Number.isFinite(session.expiresAt);
}

function isGuestAccount(value: unknown): value is GuestAccountRecord {
  if (!value || typeof value !== 'object') return false;
  const guest = value as Partial<GuestAccountRecord>;
  return typeof guest.accountId === 'string'
    && guest.accountId.length > 0
    && typeof guest.displayName === 'string'
    && typeof guest.createdAt === 'string'
    && typeof guest.lastSeenAt === 'string';
}

function normalizeDisplayName(displayName: string | undefined): string {
  const trimmed = (displayName ?? '').trim().slice(0, 18);
  return trimmed || 'Guest';
}

function saveSession(provider: AccountProvider, accountId: string, displayName: string): AccountSession {
  const now = Date.now();
  const session: AccountSession = {
    provider,
    accountId,
    displayName,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + ACCOUNT_SESSION_TTL_MS
  };
  writeIntegrityChecked(SESSION_KEY, session);
  return session;
}

export function getGuestAccount(): GuestAccountRecord | undefined {
  const guest = readIntegrityChecked<GuestAccountRecord>(GUEST_KEY);
  return isGuestAccount(guest) ? guest : undefined;
}

export function signInAsGuest(displayName?: string): AccountSession {
  const now = new Date().toISOString();
  const existing = getGuestAccount();
  const guest: GuestAccountRecord = {
    accountId: existing?.accountId ?? randomAccountId('guest'),
    displayName: normalizeDisplayName(displayName || existing?.displayName),
    createdAt: existing?.createdAt ?? now,
    lastSeenAt: now
  };
  writeIntegrityChecked(GUEST_KEY, guest);
  return saveSession('guest', guest.accountId, guest.displayName);
}

export function startAccountSession(
  provider: Exclude<AccountProvider, 'guest'>,
  accountId: string,
  displayName: string
): AccountSession {
  return saveSession(provider, accountId, normalizeDisplayName(displayName));
}

export function getValidSession(now = Date.now()): AccountSession | null {
  const session = readIntegrityChecked<AccountSession>(SESSION_KEY);
  if (!isSession(session)) {
    if (session) removeIntegrityChecked(SESSION_KEY);
    return null;
  }
  if (session.expiresAt <= now) {
    removeIntegrityChecked(SESSION_KEY);
    return null;
  }
  return session;
}

export function clearAccountSession(): void {
  removeIntegrityChecked(SESSION_KEY);
}
