import { Lane, PlayerProfile, MatchSlot } from '@nkn/shared';

const LANES: Lane[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

export interface MatchmakingResult {
  blueTeam: MatchSlot[];
  redTeam: MatchSlot[];
  blueAvgMmr: number;
  redAvgMmr: number;
  mmrDiff: number;
  autofilledPlayers: string[]; // PUUIDs or IDs
}

/**
 * Balanceia 10 jogadores em duas equipes de 5, com rotas Top, Jg, Mid, Adc, Sup
 * e aplicando regra de Autofill nos menores MMRs caso faltem rotas.
 */
export function balanceTeams(players: PlayerProfile[]): MatchmakingResult {
  if (players.length !== 10) {
    throw new Error('Matchmaking requer exatamente 10 jogadores.');
  }

  // Clona e ordena por MMR decrescente
  const sortedPlayers = [...players].sort((a, b) => b.internalMmr - a.internalMmr);

  // Mapeia quem tem preferência para cada rota (FILL conta para todas)
  const playersByLanePreference: Record<Lane, PlayerProfile[]> = {
    TOP: [],
    JUNGLE: [],
    MID: [],
    ADC: [],
    SUPPORT: [],
    FILL: [],
  };

  for (const p of sortedPlayers) {
    if (p.registeredLanes.includes('FILL')) {
      LANES.forEach((l) => playersByLanePreference[l].push(p));
    } else {
      p.registeredLanes.forEach((l) => {
        if (playersByLanePreference[l]) {
          playersByLanePreference[l].push(p);
        }
      });
    }
  }

  // Identifica lanes com carência (< 2 jogadores)
  const autofilledIds: string[] = [];
  const assigned = new Map<string, Lane>();

  // Ordena os jogadores por menor MMR para candidatos a Autofill se necessário
  const lowestMmrFirst = [...sortedPlayers].sort((a, b) => a.internalMmr - b.internalMmr);

  // Algoritmo de atribuição de rota com backtracking simples
  function solveLanes(playerIndex: number, currentAssigned: Map<string, Lane>, laneCounts: Record<Lane, number>): boolean {
    if (playerIndex === sortedPlayers.length) {
      return LANES.every((l) => laneCounts[l] === 2);
    }

    const player = sortedPlayers[playerIndex];
    let eligibleLanes = player.registeredLanes.includes('FILL')
      ? [...LANES]
      : player.registeredLanes.filter((l) => l !== 'FILL');

    // Se as rotas elegíveis estiverem cheias ou vazias, permite qualquer lane disponível (autofill)
    const availableEligible = eligibleLanes.filter((l) => laneCounts[l] < 2);
    const lanesToTry = availableEligible.length > 0
      ? availableEligible
      : LANES.filter((l) => laneCounts[l] < 2);

    if (availableEligible.length === 0 && !player.registeredLanes.includes('FILL')) {
      if (!autofilledIds.includes(player.id)) {
        autofilledIds.push(player.id);
      }
    }

    for (const lane of lanesToTry) {
      currentAssigned.set(player.id, lane);
      laneCounts[lane]++;

      if (solveLanes(playerIndex + 1, currentAssigned, laneCounts)) {
        return true;
      }

      currentAssigned.delete(player.id);
      laneCounts[lane]--;
    }

    return false;
  }

  const laneCounts: Record<Lane, number> = {
    TOP: 0,
    JUNGLE: 0,
    MID: 0,
    ADC: 0,
    SUPPORT: 0,
    FILL: 0,
  };

  const success = solveLanes(0, assigned, laneCounts);
  if (!success) {
    // Fallback garantido: aloca pares pelas rotas
    let idx = 0;
    for (const lane of LANES) {
      assigned.set(sortedPlayers[idx++].id, lane);
      assigned.set(sortedPlayers[idx++].id, lane);
    }
  }

  // Agora que temos 2 jogadores para cada lane, distribuímos entre Azul e Vermelho
  // minimizando a diferença absoluta de MMR entre os dois times
  const lanePairs: Record<Lane, PlayerProfile[]> = {
    TOP: [],
    JUNGLE: [],
    MID: [],
    ADC: [],
    SUPPORT: [],
    FILL: [],
  };

  for (const p of sortedPlayers) {
    const l = assigned.get(p.id)!;
    lanePairs[l].push(p);
  }

  // Existem 2^5 = 32 combinações para os 5 confrontos de rotas. Testamos todas e pegamos a de menor delta.
  let bestBlue: PlayerProfile[] = [];
  let bestRed: PlayerProfile[] = [];
  let minDiff = Infinity;

  const totalCombinations = 1 << 5; // 32
  for (let mask = 0; mask < totalCombinations; mask++) {
    const blue: PlayerProfile[] = [];
    const red: PlayerProfile[] = [];

    LANES.forEach((lane, i) => {
      const pair = lanePairs[lane];
      const p1 = pair[0];
      const p2 = pair[1] || pair[0];

      if ((mask & (1 << i)) === 0) {
        blue.push(p1);
        red.push(p2);
      } else {
        blue.push(p2);
        red.push(p1);
      }
    });

    const blueSum = blue.reduce((acc, p) => acc + p.internalMmr, 0);
    const redSum = red.reduce((acc, p) => acc + p.internalMmr, 0);
    const diff = Math.abs(blueSum - redSum);

    if (diff < minDiff) {
      minDiff = diff;
      bestBlue = blue;
      bestRed = red;
    }
  }

  // Define capitães como os maiores MMRs de cada lado
  const blueCaptain = [...bestBlue].sort((a, b) => b.internalMmr - a.internalMmr)[0];
  const redCaptain = [...bestRed].sort((a, b) => b.internalMmr - a.internalMmr)[0];

  const blueSlots: MatchSlot[] = bestBlue.map((p) => ({
    player: p,
    assignedLane: assigned.get(p.id)!,
    team: 'BLUE',
    isCaptain: p.id === blueCaptain.id,
  }));

  const redSlots: MatchSlot[] = bestRed.map((p) => ({
    player: p,
    assignedLane: assigned.get(p.id)!,
    team: 'RED',
    isCaptain: p.id === redCaptain.id,
  }));

  // Ordena os slots na ordem clássica: TOP, JUNGLE, MID, ADC, SUPPORT
  const laneOrder: Record<Lane, number> = { TOP: 0, JUNGLE: 1, MID: 2, ADC: 3, SUPPORT: 4, FILL: 5 };
  blueSlots.sort((a, b) => laneOrder[a.assignedLane] - laneOrder[b.assignedLane]);
  redSlots.sort((a, b) => laneOrder[a.assignedLane] - laneOrder[b.assignedLane]);

  const blueAvg = Math.round(blueSlots.reduce((s, x) => s + x.player.internalMmr, 0) / 5);
  const redAvg = Math.round(redSlots.reduce((s, x) => s + x.player.internalMmr, 0) / 5);

  return {
    blueTeam: blueSlots,
    redTeam: redSlots,
    blueAvgMmr: blueAvg,
    redAvgMmr: redAvg,
    mmrDiff: Math.abs(blueAvg - redAvg),
    autofilledPlayers: autofilledIds,
  };
}
