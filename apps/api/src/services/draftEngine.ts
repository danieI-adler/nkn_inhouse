import { Server as SocketIOServer, Socket } from 'socket.io';
import { DraftState, DRAFT_SEQUENCE, TeamSide, Lane } from '@nkn/shared';

export interface DraftRoom {
  matchId: string;
  state: DraftState;
  blueCaptainToken: string;
  redCaptainToken: string;
  spectatorToken: string;
  timerInterval?: NodeJS.Timeout;
  onDraftCompleted?: (finalState: DraftState) => void;
  onActionLogged?: (log: string) => void;
}

export class DraftEngine {
  private rooms: Map<string, DraftRoom> = new Map();
  private io: SocketIOServer;

  constructor(io: SocketIOServer) {
    this.io = io;
  }

  createRoom(
    matchId: string,
    blueToken: string,
    redToken: string,
    specToken: string,
    blueSlots?: { discordTag: string; riotId: string; riotGameName?: string; lane: Lane }[],
    redSlots?: { discordTag: string; riotId: string; riotGameName?: string; lane: Lane }[],
    onDraftCompleted?: (state: DraftState) => void,
    onActionLogged?: (msg: string) => void
  ): DraftRoom {
    const firstStep = DRAFT_SEQUENCE[0];

    const state: DraftState = {
      matchId,
      phase: 'READY_CHECK',
      currentTurn: firstStep.team,
      currentActionType: firstStep.type,
      stepIndex: 0,
      timerSecondsRemaining: 45,
      blueReady: false,
      redReady: false,
      blueConnected: false,
      redConnected: false,
      blueHasExtraTime: false,
      redHasExtraTime: false,
      blueUsedExtraTime: false,
      redUsedExtraTime: false,
      blueBans: [],
      redBans: [],
      blueSlots: blueSlots || [],
      redSlots: redSlots || [],
      bluePicks: [],
      redPicks: [],
      blueHover: null,
      redHover: null,
      isCompleted: false,
    };

    const room: DraftRoom = {
      matchId,
      state,
      blueCaptainToken: blueToken,
      redCaptainToken: redToken,
      spectatorToken: specToken,
      onDraftCompleted,
      onActionLogged,
    };

    this.rooms.set(matchId, room);
    return room;
  }

  getRoom(matchId: string): DraftRoom | undefined {
    return this.rooms.get(matchId);
  }

  handleSocketConnection(socket: Socket) {
    socket.on('join_draft', ({ matchId, token }) => {
      const room = this.rooms.get(matchId);
      if (!room) {
        socket.emit('error', { message: 'Sala de draft não encontrada.' });
        return;
      }

      let role: 'BLUE_CAPTAIN' | 'RED_CAPTAIN' | 'SPECTATOR' = 'SPECTATOR';
      if (token === room.blueCaptainToken) {
        role = 'BLUE_CAPTAIN';
        room.state.blueConnected = true;
      } else if (token === room.redCaptainToken) {
        role = 'RED_CAPTAIN';
        room.state.redConnected = true;
      }

      socket.join(`draft:${matchId}`);
      socket.emit('draft_init', {
        state: room.state,
        userRole: role,
      });

      this.io.to(`draft:${matchId}`).emit('user_joined', {
        role,
        totalConnected: this.getConnectedCount(matchId),
        state: room.state,
      });
    });

    socket.on('captain_ready', ({ matchId, token }) => {
      const room = this.rooms.get(matchId);
      if (!room || room.state.phase !== 'READY_CHECK') return;

      if (token === room.blueCaptainToken) {
        room.state.blueReady = true;
        room.onActionLogged?.('🔵 Capitão Azul confirmou que está pronto!');
      } else if (token === room.redCaptainToken) {
        room.state.redReady = true;
        room.onActionLogged?.('🔴 Capitão Vermelho confirmou que está pronto!');
      }

      // Se ambos os capitães estão prontos, inicia o draft!
      if (room.state.blueReady && room.state.redReady) {
        room.state.phase = 'BAN_1';
        room.state.timerSecondsRemaining = 45;
        this.io.to(`draft:${matchId}`).emit('draft_started', { state: room.state });
        room.onActionLogged?.('🚀 Ambos os capitães estão prontos! O draft começou.');
        this.startTurnTimer(matchId);
      } else {
        this.io.to(`draft:${matchId}`).emit('ready_status_update', { state: room.state });
      }
    });

    socket.on('hover_champion', ({ matchId, token, championId, championName }) => {
      const room = this.rooms.get(matchId);
      if (!room || room.state.isCompleted) return;

      if (token === room.blueCaptainToken) {
        room.state.blueHover = championId ? { championId, championName: championName || championId } : null;
        this.io.to(`draft:${matchId}`).emit('hover_updated', { team: 'BLUE', hover: room.state.blueHover });
      } else if (token === room.redCaptainToken) {
        room.state.redHover = championId ? { championId, championName: championName || championId } : null;
        this.io.to(`draft:${matchId}`).emit('hover_updated', { team: 'RED', hover: room.state.redHover });
      }
    });

    socket.on('submit_action', ({ matchId, token, championId, championName }) => {
      this.processAction(matchId, token, championId, championName);
    });

    socket.on('swap_roles', ({ matchId, token, side, picksWithLanes }) => {
      this.handleRoleSwap(matchId, token, side, picksWithLanes);
    });
  }

  private getConnectedCount(matchId: string): number {
    const clients = this.io.sockets.adapter.rooms.get(`draft:${matchId}`);
    return clients ? clients.size : 0;
  }

  private startTurnTimer(matchId: string) {
    const room = this.rooms.get(matchId);
    if (!room) return;

    if (room.timerInterval) {
      clearInterval(room.timerInterval);
    }

    room.timerInterval = setInterval(() => {
      if (room.state.isCompleted) {
        clearInterval(room.timerInterval);
        return;
      }

      room.state.timerSecondsRemaining--;

      // Dispara o tick com o valor exibido no cronômetro da tela
      // Quando timerSecondsRemaining está entre -1 e -3, na interface aparece 0
      const displayTime = Math.max(0, room.state.timerSecondsRemaining);
      this.io.to(`draft:${matchId}`).emit('timer_tick', {
        secondsRemaining: displayTime,
      });

      // O tempo oficial acaba em 0, e o jogador ganha 3 segundos escondidos (-3s) antes do auto-lock
      if (room.state.timerSecondsRemaining <= -3) {
        this.autoLockAction(matchId);
      }
    }, 1000);
  }

  grantExtraTime(matchId: string, token: string) {
    const room = this.rooms.get(matchId);
    if (!room || room.state.isCompleted) return;

    if (token === room.blueCaptainToken && room.state.currentTurn === 'BLUE' && !room.state.blueUsedExtraTime) {
      room.state.blueUsedExtraTime = true;
      room.state.blueHasExtraTime = false;
      room.state.timerSecondsRemaining += 15;
      this.io.to(`draft:${matchId}`).emit('extra_time_applied', { team: 'BLUE', newTime: room.state.timerSecondsRemaining });
    } else if (token === room.redCaptainToken && room.state.currentTurn === 'RED' && !room.state.redUsedExtraTime) {
      room.state.redUsedExtraTime = true;
      room.state.redHasExtraTime = false;
      room.state.timerSecondsRemaining += 15;
      this.io.to(`draft:${matchId}`).emit('extra_time_applied', { team: 'RED', newTime: room.state.timerSecondsRemaining });
    }
  }

  processAction(matchId: string, token: string, championId: string, championName: string) {
    const room = this.rooms.get(matchId);
    if (!room || room.state.isCompleted) return;

    const currentSide = room.state.currentTurn;
    const isAuthorized =
      (currentSide === 'BLUE' && token === room.blueCaptainToken) ||
      (currentSide === 'RED' && token === room.redCaptainToken);

    if (!isAuthorized) return;

    // Limpa o hover ao confirmar
    if (currentSide === 'BLUE') room.state.blueHover = null;
    else room.state.redHover = null;

    // Registra pick ou ban
    if (room.state.currentActionType === 'BAN') {
      if (currentSide === 'BLUE') room.state.blueBans.push(championId);
      else room.state.redBans.push(championId);
      room.onActionLogged?.(`🛡️ **${currentSide}** baniu **${championName}**`);
    } else {
      if (currentSide === 'BLUE') room.state.bluePicks.push({ championId, championName });
      else room.state.redPicks.push({ championId, championName });
      room.onActionLogged?.(`⚔️ **${currentSide}** escolheu **${championName}**`);
    }

    this.advanceTurn(matchId);
  }

  private autoLockAction(matchId: string) {
    const room = this.rooms.get(matchId);
    if (!room) return;

    const currentSide = room.state.currentTurn;
    const currentHover = currentSide === 'BLUE' ? room.state.blueHover : room.state.redHover;

    // 4. Se alguém estiver dando hovering em um champion, ele deverá ser selecionado no fim do tempo
    if (currentHover && currentHover.championId && currentHover.championId !== 'None') {
      const champId = currentHover.championId;
      const champName = currentHover.championName || champId;

      if (room.state.currentActionType === 'BAN') {
        if (currentSide === 'BLUE') room.state.blueBans.push(champId);
        else room.state.redBans.push(champId);
        room.onActionLogged?.(`⏰ Tempo esgotado! **${currentSide}** baniu **${champName}** (selecionado no hover).`);
      } else {
        if (currentSide === 'BLUE') room.state.bluePicks.push({ championId: champId, championName: champName });
        else room.state.redPicks.push({ championId: champId, championName: champName });
        room.onActionLogged?.(`⏰ Tempo esgotado! **${currentSide}** escolheu **${champName}** (selecionado no hover).`);
      }

      if (currentSide === 'BLUE') room.state.blueHover = null;
      else room.state.redHover = null;

      this.advanceTurn(matchId);
      return;
    }

    // Se nenhum campeão estiver em hover:
    const fallbackId = 'None';
    const fallbackName = 'Nenhum';

    if (room.state.currentActionType === 'BAN') {
      if (room.state.currentTurn === 'BLUE') room.state.blueBans.push(fallbackId);
      else room.state.redBans.push(fallbackId);
      room.onActionLogged?.(`⏰ Tempo esgotado! **${room.state.currentTurn}** não baniu nenhum campeão.`);
    } else {
      const randomChamp = 'Teemo';
      if (room.state.currentTurn === 'BLUE') room.state.bluePicks.push({ championId: randomChamp, championName: randomChamp });
      else room.state.redPicks.push({ championId: randomChamp, championName: randomChamp });
      room.onActionLogged?.(`⏰ Tempo esgotado! **${room.state.currentTurn}** recebeu **${randomChamp}** automaticamente.`);
    }

    if (currentSide === 'BLUE') room.state.blueHover = null;
    else room.state.redHover = null;

    this.advanceTurn(matchId);
  }

  private advanceTurn(matchId: string) {
    const room = this.rooms.get(matchId);
    if (!room) return;

    room.state.stepIndex++;

    if (room.state.stepIndex >= DRAFT_SEQUENCE.length) {
      // Fim das escolhas e bans -> Fase de organização de rotas (Swap Roles) de 30 segundos
      room.state.phase = 'SWAP_ROLES';
      room.state.timerSecondsRemaining = 30;
      this.io.to(`draft:${matchId}`).emit('draft_update', { state: room.state });
      room.onActionLogged?.('🔄 Escolhas finalizadas! Fase de troca de campeões iniciada (30s).');

      if (room.timerInterval) clearInterval(room.timerInterval);

      room.timerInterval = setInterval(() => {
        room.state.timerSecondsRemaining--;
        this.io.to(`draft:${matchId}`).emit('timer_tick', {
          secondsRemaining: room.state.timerSecondsRemaining,
        });

        if (room.state.timerSecondsRemaining <= 0) {
          if (room.timerInterval) clearInterval(room.timerInterval);
          room.state.isCompleted = true;
          this.io.to(`draft:${matchId}`).emit('draft_completed', { state: room.state });
          room.onDraftCompleted?.(room.state);
        }
      }, 1000);

      return;
    }

    const nextStep = DRAFT_SEQUENCE[room.state.stepIndex];
    room.state.currentTurn = nextStep.team;
    room.state.currentActionType = nextStep.type;
    room.state.timerSecondsRemaining = 45;

    // Atualiza nome da fase
    if (room.state.stepIndex < 6) room.state.phase = 'BAN_1';
    else if (room.state.stepIndex < 12) room.state.phase = 'PICK_1';
    else if (room.state.stepIndex < 16) room.state.phase = 'BAN_2';
    else room.state.phase = 'PICK_2';

    this.io.to(`draft:${matchId}`).emit('draft_update', { state: room.state });
  }

  handleRoleSwap(
    matchId: string,
    token: string,
    side: TeamSide,
    picksWithLanes: { championId: string; championName: string; lane?: Lane; playerPuuid?: string }[]
  ) {
    const room = this.rooms.get(matchId);
    if (!room) return;

    if (side === 'BLUE' && token === room.blueCaptainToken) {
      room.state.bluePicks = picksWithLanes;
    } else if (side === 'RED' && token === room.redCaptainToken) {
      room.state.redPicks = picksWithLanes;
    }

    this.io.to(`draft:${matchId}`).emit('roles_updated', { state: room.state });
  }
}
