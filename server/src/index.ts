import http from 'node:http';
import { Rivalis, TokenBucketRateLimiter, Transports } from '@rivalis/core';
import { ArenaRoom } from './arena-room.js';
import { TicketAuth, type ArenaActorData } from './auth.js';
import { serverConfig } from './config.js';
import { GuestIdentityService, type GuestIdentity } from './identity.js';
import { ARENA_ROOM_ID, normalizePlayerName } from './protocol.js';
import { FixedWindowLimiter, getClientAddress } from './rate-limit.js';
import { TicketService } from './tickets.js';

const MAX_IDENTITY_BODY_BYTES = 4_096;
const tickets = new TicketService(serverConfig.ticketSecret, serverConfig.ticketTtlSeconds);
const guests = new GuestIdentityService(
  serverConfig.ticketSecret,
  serverConfig.guestIdentityTtlSeconds,
  serverConfig.production
);
const ticketLimiter = new FixedWindowLimiter(serverConfig.ticketRequestsPerMinute, 60_000);
const identityLimiter = new FixedWindowLimiter(serverConfig.identityRequestsPerMinute, 60_000);

class RequestBodyError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function applySecurityHeaders(response: http.ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Vary', 'Origin');
}

function isAllowedOrigin(origin: string | undefined): boolean {
  return typeof origin === 'string' && serverConfig.allowedOrigins.includes(origin);
}

function applyCors(request: http.IncomingMessage, response: http.ServerResponse): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!isAllowedOrigin(origin)) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  response.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  value: unknown,
  statusMessage?: string
): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  response.statusCode = statusCode;
  response.statusMessage = statusMessage ?? http.STATUS_CODES[statusCode] ?? 'Unknown';
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', body.byteLength);
  response.setHeader('Cache-Control', 'no-store');
  response.end(body);
}

function sendOptions(response: http.ServerResponse, methods: string): void {
  response.statusCode = 204;
  response.setHeader('Allow', methods);
  response.setHeader('Access-Control-Allow-Methods', methods);
  response.end();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new RequestBodyError(415, 'Content-Type must be application/json.');
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_IDENTITY_BODY_BYTES) {
      throw new RequestBodyError(413, 'Request body is too large.');
    }
    chunks.push(buffer);
  }
  if (total === 0) throw new RequestBodyError(400, 'Request body is required.');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestBodyError(400, 'Request body must be valid JSON.');
  }
}

function guestFromRequest(request: http.IncomingMessage): GuestIdentity | null {
  const token = guests.readCookie(request.headers.cookie);
  return token ? guests.verify(token) : null;
}

function setGuestCookie(response: http.ServerResponse, identity: GuestIdentity): void {
  response.setHeader('Set-Cookie', guests.cookie(identity));
}

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  applySecurityHeaders(response);
  const originAllowed = applyCors(request, response);
  const url = new URL(request.url ?? '/', 'http://server.local');

  if (url.pathname === '/healthz') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (url.pathname === '/api/multiplayer/identity') {
    if (!originAllowed) {
      sendJson(response, 403, { error: 'Origin not allowed.' });
      return;
    }
    if (request.method === 'OPTIONS') {
      sendOptions(response, 'POST, OPTIONS');
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST, OPTIONS');
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }

    const clientAddress = getClientAddress(request, serverConfig.trustProxy);
    if (!identityLimiter.take(clientAddress)) {
      response.setHeader('Retry-After', '60');
      sendJson(response, 429, { error: 'Too many identity requests.' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = await readJsonBody(request);
    } catch (error) {
      const statusCode = error instanceof RequestBodyError ? error.statusCode : 400;
      const message = error instanceof RequestBodyError ? error.message : 'Invalid request body.';
      sendJson(response, statusCode, { error: message });
      return;
    }
    const playerName = isRecord(parsed) && typeof parsed.name === 'string' ? parsed.name : '';
    if (playerName.trim() && !normalizePlayerName(playerName)) {
      sendJson(response, 400, { error: 'Display name must be 1-24 printable characters.' });
      return;
    }
    const existing = guestFromRequest(request);
    const identity = existing
      ? guests.rename(existing, playerName)
      : guests.create(playerName);
    if (!identity) {
      sendJson(response, 400, { error: 'Display name must be 1-24 printable characters.' });
      return;
    }
    setGuestCookie(response, identity);
    sendJson(response, 200, {
      playerId: identity.playerId,
      playerName: identity.playerName,
      expiresAt: identity.expiresAt * 1000
    });
    return;
  }

  if (url.pathname === '/api/rivalis-ticket') {
    if (!originAllowed) {
      sendJson(response, 403, { error: 'Origin not allowed.' });
      return;
    }
    if (request.method === 'OPTIONS') {
      sendOptions(response, 'GET, OPTIONS');
      return;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET, OPTIONS');
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }

    const clientAddress = getClientAddress(request, serverConfig.trustProxy);
    if (!ticketLimiter.take(clientAddress)) {
      response.setHeader('Retry-After', '60');
      sendJson(response, 429, { error: 'Too many ticket requests.' });
      return;
    }

    const identity = guestFromRequest(request);
    if (!identity) {
      sendJson(response, 401, { error: 'Guest identity required.' });
      return;
    }
    const issued = tickets.issue({
      playerId: identity.playerId,
      playerName: identity.playerName
    }, clientAddress);
    sendJson(response, 200, {
      ticket: issued.ticket,
      playerName: issued.claims.name,
      expiresAt: issued.claims.exp * 1000
    });
    return;
  }

  if (url.pathname === '/ws') {
    response.statusCode = 426;
    response.setHeader('Connection', 'close');
    sendJson(response, 426, { error: 'WebSocket upgrade required.' });
    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
}

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error('[server] request failed.', error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: 'Internal server error.' });
    } else if (!response.writableEnded) {
      response.end();
    }
  });
});
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;

server.on('clientError', (_error, socket) => {
  if (!socket.writable) return;
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

const rivalis = new Rivalis<ArenaActorData>({
  transports: [
    new Transports.WSTransport(
      {
        server,
        path: '/ws',
        verifyClient: (info, done) => {
          if (isAllowedOrigin(info.origin)) done(true);
          else done(false, 403, 'Forbidden');
        }
      },
      null,
      {
        ticketSource: 'protocol',
        allowedOrigins: serverConfig.allowedOrigins,
        maxPayload: 16 * 1024,
        maxBufferedBytes: 256 * 1024
      }
    )
  ],
  authMiddleware: new TicketAuth(tickets, ARENA_ROOM_ID),
  rateLimiter: new TokenBucketRateLimiter({ capacity: 20, refillPerSecond: 5 })
});

rivalis.rooms.define(ARENA_ROOM_ID, ArenaRoom);
const arenaRoom = rivalis.rooms.create(ARENA_ROOM_ID, ARENA_ROOM_ID) as ArenaRoom;
arenaRoom.configure({
  maxActors: serverConfig.maxActors,
  maxQueue: serverConfig.maxQueue,
  maxLobbies: serverConfig.maxLobbies,
  maxMatches: serverConfig.maxMatches,
  queueTtlMs: serverConfig.queueTtlMs,
  lobbyTtlMs: serverConfig.lobbyTtlMs,
  matchTtlMs: serverConfig.matchTtlMs,
  reconnectGraceMs: serverConfig.reconnectGraceMs,
  actionLimit: serverConfig.actionLimit,
  actionWindowMs: serverConfig.actionWindowMs,
  lobbyJoinLimit: serverConfig.lobbyJoinLimit,
  lobbyJoinWindowMs: serverConfig.lobbyJoinWindowMs
});

server.on('error', (error) => {
  console.error('[server] HTTP server error.', error);
  process.exitCode = 1;
});

server.listen(serverConfig.port, serverConfig.host, () => {
  console.log(`[server] listening on ${serverConfig.host}:${serverConfig.port}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received; shutting down.`);
  const forceExit = setTimeout(() => process.exit(1), 8_000);
  forceExit.unref();
  server.close();
  try {
    await rivalis.shutdown({ timeoutMs: 5_000 });
  } catch (error) {
    console.error('[server] shutdown failed.', error);
  }
  clearTimeout(forceExit);
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
