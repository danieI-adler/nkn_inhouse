import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';
import { PlayerProfile, MatchData, GameMode } from '@nkn/shared';
import { RiotService } from './services/riot';
import { balanceTeams } from './services/matchmaker';
import { DraftEngine } from './services/draftEngine';
import { generateMatchCard } from './services/cardRenderer';
import { calculateNewMmr } from './services/mmr';
import { db } from './services/db';

const riotService = new RiotService(process.env.RIOT_API_KEY);

const server = Fastify({ logger: true });

async function start() {
  await server.register(cors, {
    origin: '*',
  });

  const io = new SocketIOServer(server.server, {
    cors: { origin: '*' },
  });

  const draftEngine = new DraftEngine(io);

  io.on('connection', (socket) => {
    draftEngine.handleSocketConnection(socket);
  });

  // 1. Rota de Vinculação de Conta Riot
  server.post<{
    Body: { discordId: string; discordTag: string; gameName: string; tagLine: string };
  }>('/api/players/link', async (request, reply) => {
    const { discordId, discordTag, gameName, tagLine } = request.body;

    try {
      const riotAcc = await riotService.getAccountByRiotId(gameName, tagLine);
      const rankInfo = await riotService.getSoloQRankByPuuid(riotAcc.puuid);

      let profile = db.getPlayer(discordId);
      if (!profile) {
        profile = {
          id: discordId,
          discordId,
          discordTag,
          riotGameName: riotAcc.gameName,
          riotTagLine: riotAcc.tagLine,
          puuid: riotAcc.puuid,
          riotRankTier: rankInfo.tier,
          riotRankDivision: rankInfo.division,
          riotLp: rankInfo.lp,
          internalMmr: rankInfo.seedMmr,
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          registeredLanes: ['FILL'],
        };
      } else {
        profile.riotGameName = riotAcc.gameName;
        profile.riotTagLine = riotAcc.tagLine;
        profile.puuid = riotAcc.puuid;
        profile.riotRankTier = rankInfo.tier;
        profile.riotRankDivision = rankInfo.division;
        profile.riotLp = rankInfo.lp;
      }

      db.setPlayer(discordId, profile);
      return reply.send({ success: true, profile });
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  });

  // 2. Rota de Atualização de Rotas (Lanes)
  server.post<{
    Body: { discordId: string; lanes: any[] };
  }>('/api/players/lanes', async (request, reply) => {
    const { discordId, lanes } = request.body;
    const profile = db.getPlayer(discordId);
    if (!profile) {
      return reply.status(404).send({ success: false, message: 'Perfil não encontrado.' });
    }

    profile.registeredLanes = lanes;
    db.setPlayer(discordId, profile);
    return reply.send({ success: true, profile });
  });

  // 3. Rota de Perfil
  server.get<{ Params: { discordId: string } }>('/api/players/:discordId', async (request, reply) => {
    const profile = db.getPlayer(request.params.discordId);
    if (!profile) {
      return reply.status(404).send({ success: false, message: 'Perfil não encontrado.' });
    }
    return reply.send({ success: true, profile });
  });

  // 3.1. Rota de Leaderboard / Ranking Geral
  server.get('/api/leaderboard', async (_request, reply) => {
    const all = db.getAllPlayers();
    // Ordena por MMR decrescente
    all.sort((a, b) => b.internalMmr - a.internalMmr);
    return reply.send({ success: true, leaderboard: all.slice(0, 20) });
  });

  // 3.2. Rotas de Configuração (Waiting Room)
  server.get('/api/settings', async (_request, reply) => {
    return reply.send({ success: true, settings: db.getSettings() });
  });

  server.post<{ Body: { waitingRoomVoiceId: string } }>('/api/settings/waiting-room', async (request, reply) => {
    db.setWaitingRoom(request.body.waitingRoomVoiceId);
    return reply.send({ success: true, settings: db.getSettings() });
  });

  // 4. Criação de Partida a partir de 10 jogadores
  server.post<{
    Body: { playerIds: string[]; mode: GameMode };
  }>('/api/matches/create', async (request, reply) => {
    const { playerIds, mode } = request.body;

    if (playerIds.length !== 10) {
      return reply.status(400).send({ message: 'Necessário 10 jogadores.' });
    }

    const participants = playerIds.map((id) => db.getPlayer(id)).filter(Boolean) as PlayerProfile[];
    if (participants.length !== 10) {
      return reply.status(400).send({ message: 'Um ou mais jogadores não estão cadastrados.' });
    }

    const matchId = `nkn-${Math.floor(1000 + Math.random() * 9000)}`;
    const mm = balanceTeams(participants);

    const blueToken = `blue-${Math.random().toString(36).substring(2, 10)}`;
    const redToken = `red-${Math.random().toString(36).substring(2, 10)}`;
    const specToken = `spec-${Math.random().toString(36).substring(2, 10)}`;

    const match: MatchData = {
      id: matchId,
      mode,
      roomName: `NUKENIN-${matchId.toUpperCase()}`,
      roomPassword: Math.random().toString(36).substring(2, 6).toUpperCase(),
      blueTeam: mm.blueTeam,
      redTeam: mm.redTeam,
      createdAt: Date.now(),
      status: 'DRAFTING',
      blueCaptainToken: blueToken,
      redCaptainToken: redToken,
      spectatorToken: specToken,
    };

    db.setMatch(matchId, match);

    const blueSlots = match.blueTeam.map((s) => ({
      discordTag: s.player.discordTag,
      riotId: `${s.player.riotGameName}#${s.player.riotTagLine}`,
      lane: s.assignedLane,
    }));

    const redSlots = match.redTeam.map((s) => ({
      discordTag: s.player.discordTag,
      riotId: `${s.player.riotGameName}#${s.player.riotTagLine}`,
      lane: s.assignedLane,
    }));

    // Inicializa a sala no motor de draft com os jogadores reais
    draftEngine.createRoom(
      matchId,
      blueToken,
      redToken,
      specToken,
      blueSlots,
      redSlots,
      async (finalDraftState) => {
        // Callback de Draft Concluído
        match.status = 'IN_PROGRESS';
        db.setMatch(matchId, match);
      }
    );

    return reply.send({
      success: true,
      match,
      blueCaptainUrl: `/draft/${matchId}?token=${blueToken}`,
      redCaptainUrl: `/draft/${matchId}?token=${redToken}`,
      spectatorUrl: `/draft/${matchId}?token=${specToken}`,
    });
  });

  // 5. Rota para Gerar Imagem do Card de Partida
  server.get<{ Params: { matchId: string } }>('/api/matches/:matchId/card', async (request, reply) => {
    const match = db.getMatch(request.params.matchId);
    if (!match) {
      return reply.status(404).send('Partida não encontrada.');
    }

    const room = draftEngine.getRoom(match.id);
    const draftState = room ? room.state : {
      matchId: match.id,
      phase: 'FINISHED',
      currentTurn: 'BLUE',
      currentActionType: 'PICK',
      stepIndex: 20,
      timerSecondsRemaining: 0,
      blueHasExtraTime: false,
      redHasExtraTime: false,
      blueUsedExtraTime: false,
      redUsedExtraTime: false,
      blueBans: [],
      redBans: [],
      bluePicks: [],
      redPicks: [],
      isCompleted: true,
    };

    const imageBuffer = await generateMatchCard(match, draftState as any);
    reply.header('Content-Type', 'image/png');
    return reply.send(imageBuffer);
  });

  // 6. Rota para Reportar Resultado e Atualizar MMR
  server.post<{
    Body: { matchId: string; winner: 'BLUE' | 'RED' };
  }>('/api/matches/report', async (request, reply) => {
    const { matchId, winner } = request.body;
    const match = db.getMatch(matchId);
    if (!match || match.status === 'FINISHED') {
      return reply.status(400).send({ message: 'Partida inválida ou já finalizada.' });
    }

    match.status = 'FINISHED';
    match.winner = winner;
    db.setMatch(matchId, match);

    const blueAvg = match.blueTeam.reduce((acc, s) => acc + s.player.internalMmr, 0) / 5;
    const redAvg = match.redTeam.reduce((acc, s) => acc + s.player.internalMmr, 0) / 5;

    const resultsSummary: any[] = [];

    // Atualiza MMR se não for modo zoação
    if (match.mode !== 'CASUAL_ARAM_ZOACAO') {
      for (const slot of match.blueTeam) {
        const p = db.getPlayer(slot.player.discordId);
        if (p) {
          const isWinner = winner === 'BLUE';
          const { newMmr, delta } = calculateNewMmr(p.internalMmr, p.matchesPlayed, isWinner, blueAvg, redAvg);
          p.internalMmr = newMmr;
          p.matchesPlayed++;
          if (isWinner) p.wins++; else p.losses++;
          db.setPlayer(p.discordId, p);
          resultsSummary.push({ discordId: p.discordId, newMmr, delta, won: isWinner });
        }
      }

      for (const slot of match.redTeam) {
        const p = db.getPlayer(slot.player.discordId);
        if (p) {
          const isWinner = winner === 'RED';
          const { newMmr, delta } = calculateNewMmr(p.internalMmr, p.matchesPlayed, isWinner, redAvg, blueAvg);
          p.internalMmr = newMmr;
          p.matchesPlayed++;
          if (isWinner) p.wins++; else p.losses++;
          db.setPlayer(p.discordId, p);
          resultsSummary.push({ discordId: p.discordId, newMmr, delta, won: isWinner });
        }
      }
    }

    return reply.send({ success: true, winner, results: resultsSummary });
  });

  const PORT = Number(process.env.PORT) || 3001;
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`🚀 API Nukenin Inhouse rodando na porta ${PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
