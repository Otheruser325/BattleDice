import { AuthMiddleware, type AuthResult } from '@rivalis/core';
import type { TicketService } from './tickets.js';

export interface ArenaActorData {
  playerId: string;
  playerName: string;
  ticketId: string;
  clientAddress?: string;
}

export class TicketAuth extends AuthMiddleware<ArenaActorData> {
  constructor(
    private readonly tickets: TicketService,
    private readonly roomId: string
  ) {
    super();
  }

  override async authenticate(ticket: string): Promise<AuthResult<ArenaActorData> | null> {
    const claims = this.tickets.consume(ticket);
    if (!claims) return null;
    return {
      data: {
        playerId: claims.sub,
        playerName: claims.name,
        ticketId: claims.jti,
        ...(claims.ip ? { clientAddress: claims.ip } : {})
      },
      roomId: this.roomId
    };
  }
}
