import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';
import { PlayerProfile, MatchData, GameMode, Lane } from '@nkn/shared';
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
    const all = await db.getAllPlayersAsync();
    // Ordena primariamente por Vitórias decrescentes, depois Winrate e MMR
    all.sort((a, b) => {
      const winsDiff = (b.wins || 0) - (a.wins || 0);
      if (winsDiff !== 0) return winsDiff;
      const wrA = (a.matchesPlayed || 0) > 0 ? (a.wins || 0) / a.matchesPlayed : 0;
      const wrB = (b.matchesPlayed || 0) > 0 ? (b.wins || 0) / b.matchesPlayed : 0;
      if (wrB !== wrA) return wrB - wrA;
      return (b.internalMmr || 1200) - (a.internalMmr || 1200);
    });
    return reply.send({ success: true, leaderboard: all.slice(0, 50) });
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

  // 3.3. Rota para Gerar Partida / Draft de Teste Imediato (sem precisar de 10 jogadores reais)
  server.post('/api/matches/create-test', async (_request, reply) => {
    const matchId = `test-${Math.floor(1000 + Math.random() * 9000)}`;
    const blueToken = `blue-${Math.random().toString(36).substring(2, 10)}`;
    const redToken = `red-${Math.random().toString(36).substring(2, 10)}`;
    const specToken = `spec-${Math.random().toString(36).substring(2, 10)}`;

    const lanes: Lane[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
    const dbPlayers = (await db.getAllPlayersAsync()).filter((p) => p && p.discordId);

    const getSlotPlayer = (teamPrefix: string, index: number): PlayerProfile => {
      if (dbPlayers[index]) return dbPlayers[index];
      const lane = lanes[index];
      const slotName = `${teamPrefix} ${lane}`;
      return {
        id: `slot-${teamPrefix.toLowerCase()}-${lane.toLowerCase()}`,
        discordId: `slot-${teamPrefix.toLowerCase()}-${lane.toLowerCase()}`,
        discordTag: slotName,
        riotGameName: slotName,
        riotTagLine: 'NKN',
        puuid: `puuid-${teamPrefix.toLowerCase()}-${lane.toLowerCase()}`,
        riotRankTier: 'UNRANKED',
        riotRankDivision: 'I',
        riotLp: 0,
        internalMmr: 1200,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        registeredLanes: [lane],
      };
    };

    const blueSlots = lanes.map((lane, i) => {
      const p = getSlotPlayer('Azul', i);
      return {
        discordTag: p.discordTag || p.riotGameName,
        riotId: `${p.riotGameName}#${p.riotTagLine || 'NKN'}`,
        riotGameName: p.riotGameName,
        lane,
      };
    });

    const redSlots = lanes.map((lane, i) => {
      const p = getSlotPlayer('Vermelho', i + 5);
      return {
        discordTag: p.discordTag || p.riotGameName,
        riotId: `${p.riotGameName}#${p.riotTagLine || 'NKN'}`,
        riotGameName: p.riotGameName,
        lane,
      };
    });

    const match: MatchData = {
      id: matchId,
      mode: 'RANKED_AUTO',
      roomName: `NUKENIN-${matchId.toUpperCase()}`,
      roomPassword: Math.random().toString(36).substring(2, 6).toUpperCase(),
      blueTeam: lanes.map((lane, i) => ({
        player: getSlotPlayer('Azul', i),
        assignedLane: lane,
        team: 'BLUE',
        isCaptain: i === 0,
      })),
      redTeam: lanes.map((lane, i) => ({
        player: getSlotPlayer('Vermelho', i + 5),
        assignedLane: lane,
        team: 'RED',
        isCaptain: i === 0,
      })),
      createdAt: Date.now(),
      status: 'DRAFTING',
      blueCaptainToken: blueToken,
      redCaptainToken: redToken,
      spectatorToken: specToken,
    };

    db.setMatch(matchId, match);

    draftEngine.createRoom(
      matchId,
      blueToken,
      redToken,
      specToken,
      blueSlots,
      redSlots,
      async (finalDraftState) => {
        match.status = 'IN_PROGRESS';
        db.setMatch(matchId, match);
        io.emit('draft_completed_broadcast', { matchId });
      }
    );

    const draftBase = (process.env.WEB_DRAFT_URL || 'https://daniei-adler.github.io/nkn_inhouse').replace(/\/+$/, '');

    return reply.send({
      success: true,
      matchId,
      blueCaptainUrl: `${draftBase}/#/draft/${matchId}?token=${blueToken}`,
      redCaptainUrl: `${draftBase}/#/draft/${matchId}?token=${redToken}`,
      spectatorUrl: `${draftBase}/#/draft/${matchId}?token=${specToken}`,
    });
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
        // Callback de Draft Concluído: atualiza os campeões escolhidos (e trocados) em cada slot
        if (finalDraftState.bluePicks && finalDraftState.bluePicks.length === 5) {
          match.blueTeam.forEach((slot, idx) => {
            if (finalDraftState.bluePicks[idx]) {
              slot.championId = finalDraftState.bluePicks[idx].championId;
              slot.championName = finalDraftState.bluePicks[idx].championName;
            }
          });
        }
        if (finalDraftState.redPicks && finalDraftState.redPicks.length === 5) {
          match.redTeam.forEach((slot, idx) => {
            if (finalDraftState.redPicks[idx]) {
              slot.championId = finalDraftState.redPicks[idx].championId;
              slot.championName = finalDraftState.redPicks[idx].championName;
            }
          });
        }

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

  // 4.1. Rota para Obter Dados da Partida
  server.get<{ Params: { matchId: string } }>('/api/matches/:matchId', async (request, reply) => {
    const cleanId = (request.params.matchId || '').trim().replace(/^#/, '').toLowerCase();
    const match = db.getMatch(request.params.matchId) || db.getMatch(cleanId) || db.getMatch(`nkn-${cleanId}`);
    if (!match) return reply.status(404).send({ message: 'Partida não encontrada.' });
    return reply.send({ success: true, match });
  });

  // 4.2. Rota para Atualizar Campeão e Rota Escolhidos pelo Jogador no Discord
  server.post<{
    Params: { matchId: string };
    Body: { discordId: string; championName?: string; championId?: string; lane?: Lane };
  }>('/api/matches/:matchId/player-selection', async (request, reply) => {
    const cleanId = (request.params.matchId || '').trim().replace(/^#/, '').toLowerCase();
    const match = db.getMatch(request.params.matchId) || db.getMatch(cleanId) || db.getMatch(`nkn-${cleanId}`);
    if (!match) return reply.status(404).send({ message: 'Partida não encontrada.' });

    const { discordId, championName, championId, lane } = request.body;
    let updatedSlot: any = null;

    const findAndApply = (slots: any[]) => {
      const s = slots.find((slot) => slot.player.discordId === discordId);
      if (s) {
        if (championName) s.championName = championName;
        if (championId) s.championId = championId;
        if (lane) s.assignedLane = lane;
        updatedSlot = s;
      }
    };

    findAndApply(match.blueTeam);
    findAndApply(match.redTeam);

    if (!updatedSlot) {
      return reply.status(400).send({ message: 'Jogador não pertence a esta partida.' });
    }

    db.setMatch(match.id, match);
    return reply.send({ success: true, match, slot: updatedSlot });
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
      for (let idx = 0; idx < teamAPlayers.length; idx++) {
        const upd = openSkillResults.teamAUpdates[idx];
        const pid = teamAPlayers[idx].discordId;
        const slot = match.blueTeam[idx];
        const p = db.getPlayer(pid);
        if (p) {
          p.mu = upd.newMu;
          p.sigma = upd.newSigma;
          p.internalMmr = upd.newMmr;
          p.matchesPlayed++;
          const won = winner === 'BLUE';
          if (won) p.wins++; else p.losses++;

          // Atualiza estatísticas por rota
          if (slot && slot.assignedLane) {
            p.laneStats = p.laneStats || {};
            const laneKey = slot.assignedLane;
            if (!p.laneStats[laneKey]) p.laneStats[laneKey] = { wins: 0, losses: 0 };
            if (won) p.laneStats[laneKey].wins++; else p.laneStats[laneKey].losses++;
          }

          // Atualiza estatísticas por campeão
          if (slot && slot.championName) {
            p.championStats = p.championStats || {};
            const champKey = slot.championName;
            if (!p.championStats[champKey]) p.championStats[champKey] = { name: champKey, wins: 0, losses: 0 };
            if (won) p.championStats[champKey].wins++; else p.championStats[champKey].losses++;
          }

          await db.setPlayerAsync(p.discordId, p);
          resultsSummary.push({
            discordId: p.discordId,
            riotGameName: p.riotGameName,
            newMmr: upd.newMmr,
            delta: upd.delta,
            won,
          });
        }
      }

      // Aplica atualização ao Time Vermelho
      for (let idx = 0; idx < teamBPlayers.length; idx++) {
        const upd = openSkillResults.teamBUpdates[idx];
        const pid = teamBPlayers[idx].discordId;
        const slot = match.redTeam[idx];
        const p = db.getPlayer(pid);
        if (p) {
          p.mu = upd.newMu;
          p.sigma = upd.newSigma;
          p.internalMmr = upd.newMmr;
          p.matchesPlayed++;
          const won = winner === 'RED';
          if (won) p.wins++; else p.losses++;

          // Atualiza estatísticas por rota
          if (slot && slot.assignedLane) {
            p.laneStats = p.laneStats || {};
            const laneKey = slot.assignedLane;
            if (!p.laneStats[laneKey]) p.laneStats[laneKey] = { wins: 0, losses: 0 };
            if (won) p.laneStats[laneKey].wins++; else p.laneStats[laneKey].losses++;
          }

          // Atualiza estatísticas por campeão
          if (slot && slot.championName) {
            p.championStats = p.championStats || {};
            const champKey = slot.championName;
            if (!p.championStats[champKey]) p.championStats[champKey] = { name: champKey, wins: 0, losses: 0 };
            if (won) p.championStats[champKey].wins++; else p.championStats[champKey].losses++;
          }

          await db.setPlayerAsync(p.discordId, p);
          resultsSummary.push({
            discordId: p.discordId,
            riotGameName: p.riotGameName,
            newMmr: upd.newMmr,
            delta: upd.delta,
            won,
          });
        }
      }
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
