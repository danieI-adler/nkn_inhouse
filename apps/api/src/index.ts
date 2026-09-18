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
import { calculateMatchOpenSkill, DEFAULT_SIGMA, MMR_SCALE } from './services/mmr';
import { db } from './services/db';

const riotService = new RiotService(process.env.RIOT_API_KEY);

const server = Fastify({ logger: true });

async function start() {
  // Aguarda a conexão e sincronização com o Supabase antes de aceitar requisições
  await db.init();

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

  // Health check para o Render
  server.get('/', async (_request, reply) => {
    return reply.send({ status: 'ok', service: 'nkn-inhouse-api' });
  });

  // 1. Rota de Vinculação de Conta Riot
  server.post<{
    Body: { discordId: string; discordTag: string; gameName: string; tagLine: string };
  }>('/api/players/link', async (request, reply) => {
    const { discordId, discordTag, gameName, tagLine } = request.body;

    try {
      const riotAcc = await riotService.getAccountByRiotId(gameName, tagLine);
      const rankInfo = await riotService.getSoloQRankByPuuid(riotAcc.puuid);
      const topChamps = await riotService.getTopChampionMasteries(riotAcc.puuid);

      let profile = await db.getPlayerAsync(discordId);
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
          mu: rankInfo.mu,
          sigma: rankInfo.sigma,
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          registeredLanes: ['FILL'],
          topChampions: topChamps,
        };
      } else {
        profile.riotGameName = riotAcc.gameName;
        profile.riotTagLine = riotAcc.tagLine;
        profile.puuid = riotAcc.puuid;
        profile.riotRankTier = rankInfo.tier;
        profile.riotRankDivision = rankInfo.division;
        profile.riotLp = rankInfo.lp;
        profile.topChampions = topChamps;
        if (profile.matchesPlayed === 0) {
          profile.internalMmr = rankInfo.seedMmr;
          profile.mu = rankInfo.mu;
          profile.sigma = rankInfo.sigma;
        }
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
    const profile = await db.getPlayerAsync(discordId);
    if (!profile) {
      return reply.status(404).send({ success: false, message: 'Perfil não encontrado.' });
    }

    profile.registeredLanes = lanes;
    db.setPlayer(discordId, profile);
    return reply.send({ success: true, profile });
  });

  // 3. Rota de Perfil
  server.get<{ Params: { discordId: string } }>('/api/players/:discordId', async (request, reply) => {
    const profile = await db.getPlayerAsync(request.params.discordId);
    if (!profile) {
      return reply.status(404).send({ success: false, message: 'Perfil não encontrado.' });
    }

    // Se ainda não tiver topChampions salvo no perfil, tenta buscar dinamicamente
    if ((!profile.topChampions || profile.topChampions.length === 0) && profile.puuid) {
      try {
        profile.topChampions = await riotService.getTopChampionMasteries(profile.puuid);
        db.setPlayer(profile.discordId, profile);
      } catch (e) {
        // Ignora erro eventual
      }
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

  server.post<{ Body: { channelId: string; messageId: string } }>('/api/settings/queue-message', async (request, reply) => {
    db.setQueueMessage(request.body.channelId, request.body.messageId);
    return reply.send({ success: true, settings: db.getSettings() });
  });

  server.post<{ Body: { channelId: string; messageId: string } }>('/api/settings/ranking-message', async (request, reply) => {
    db.setRankingMessage(request.body.channelId, request.body.messageId);
    return reply.send({ success: true, settings: db.getSettings() });
  });

  server.post<{ Body: { mode: GameMode } }>('/api/settings/queue-mode', async (request, reply) => {
    db.setQueueMode(request.body.mode);
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

    const participants = (
      await Promise.all(playerIds.map((id) => db.getPlayerAsync(id)))
    ).filter(Boolean) as PlayerProfile[];
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
      riotGameName: s.player.riotGameName,
      lane: s.assignedLane,
    }));

    const redSlots = match.redTeam.map((s) => ({
      discordTag: s.player.discordTag,
      riotId: `${s.player.riotGameName}#${s.player.riotTagLine}`,
      riotGameName: s.player.riotGameName,
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

        // Notifica o bot do Discord para postar a imagem do card finalizado
        io.emit('draft_completed_broadcast', { matchId });
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
    const cleanId = (matchId || '').trim().replace(/^#/, '').toLowerCase();
    let match = db.getMatch(matchId) || db.getMatch(cleanId) || db.getMatch(`nkn-${cleanId}`);

    if (!match) {
      // Procura por id ignorando case
      const all = (db as any).matches;
      if (all) {
        for (const [id, m] of all.entries()) {
          if (id.toLowerCase() === cleanId || id.toLowerCase().includes(cleanId)) {
            match = m;
            break;
          }
        }
      }
    }

    if (!match) {
      return reply.status(400).send({ message: `Partida #${matchId} não encontrada.` });
    }

    if (match.status === 'FINISHED') {
      return reply.status(400).send({ message: `A partida #${matchId} já foi finalizada anteriormente.` });
    }

    match.status = 'FINISHED';
    match.winner = winner;
    db.setMatch(matchId, match);

    const blueAvg = match.blueTeam.reduce((acc, s) => acc + s.player.internalMmr, 0) / 5;
    const redAvg = match.redTeam.reduce((acc, s) => acc + s.player.internalMmr, 0) / 5;

    const resultsSummary: any[] = [];

    // Atualiza MMR usando OpenSkill / Weng-Lin com incerteza sigma dinâmica
    if (match.mode !== 'CASUAL_ARAM_ZOACAO') {
      const teamAPlayers = match.blueTeam.map((slot) => {
        const p = db.getPlayer(slot.player.discordId);
        const mu = p?.mu ?? (p?.internalMmr ? p.internalMmr / MMR_SCALE : 25);
        const sigma = p?.sigma ?? DEFAULT_SIGMA;
        return {
          discordId: slot.player.discordId,
          mu,
          sigma,
          internalMmr: p?.internalMmr,
          matchesPlayed: p?.matchesPlayed,
        };
      });

      const teamBPlayers = match.redTeam.map((slot) => {
        const p = db.getPlayer(slot.player.discordId);
        const mu = p?.mu ?? (p?.internalMmr ? p.internalMmr / MMR_SCALE : 25);
        const sigma = p?.sigma ?? DEFAULT_SIGMA;
        return {
          discordId: slot.player.discordId,
          mu,
          sigma,
          internalMmr: p?.internalMmr,
          matchesPlayed: p?.matchesPlayed,
        };
      });

      const openSkillResults = calculateMatchOpenSkill(teamAPlayers, teamBPlayers, winner === 'BLUE');

      // Aplica atualização ao Time Azul
      openSkillResults.teamAUpdates.forEach((upd: any, idx: number) => {
        const pid = teamAPlayers[idx].discordId;
        const p = db.getPlayer(pid);
        if (p) {
          p.mu = upd.newMu;
          p.sigma = upd.newSigma;
          p.internalMmr = upd.newMmr;
          p.matchesPlayed++;
          if (winner === 'BLUE') p.wins++; else p.losses++;
          db.setPlayer(p.discordId, p);
          resultsSummary.push({
            discordId: p.discordId,
            riotGameName: p.riotGameName,
            newMmr: upd.newMmr,
            delta: upd.delta,
            won: winner === 'BLUE',
          });
        }
      });

      // Aplica atualização ao Time Vermelho
      openSkillResults.teamBUpdates.forEach((upd: any, idx: number) => {
        const pid = teamBPlayers[idx].discordId;
        const p = db.getPlayer(pid);
        if (p) {
          p.mu = upd.newMu;
          p.sigma = upd.newSigma;
          p.internalMmr = upd.newMmr;
          p.matchesPlayed++;
          if (winner === 'RED') p.wins++; else p.losses++;
          db.setPlayer(p.discordId, p);
          resultsSummary.push({
            discordId: p.discordId,
            riotGameName: p.riotGameName,
            newMmr: upd.newMmr,
            delta: upd.delta,
            won: winner === 'RED',
          });
        }
      });
    }

    return reply.send({ success: true, winner, results: resultsSummary });
  });

  const PORT = Number(process.env.PORT) || 3001;
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`🚀 API Nukenin Inhouse rodando na porta ${PORT}`);

  // Auto-ping para manter o Render free tier acordado (a cada 5 minutos)
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.API_PUBLIC_URL;
  if (RENDER_URL) {
    const pingUrl = RENDER_URL.replace(/\/+$/, '') + '/';
    setInterval(async () => {
      try {
        await fetch(pingUrl);
        console.log(`🏓 Keep-alive ping enviado para ${pingUrl}`);
      } catch (e) {
        console.warn('⚠️ Falha no keep-alive ping:', (e as Error).message);
      }
    }, 5 * 60 * 1000); // 5 minutos
    console.log(`🏓 Keep-alive configurado: ping a cada 5min em ${pingUrl}`);
  } else {
    console.log('ℹ️ RENDER_EXTERNAL_URL não definida, keep-alive desativado (apenas em produção).');
  }
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
