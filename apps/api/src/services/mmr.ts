// Seed Elo Riot Games Solo/Duo
// Ferro IV a I: 800 a 950 (incremento de 50 por divisão)
// Bronze IV a I: 1000 a 1150 (incremento de 50 por divisão)
// Prata IV a I: 1200 a 1350 (incremento de 50 por divisão)
// Ouro IV a I: 1400 a 1550 (incremento de 50 por divisão)
// Platina IV a I: 1600 a 1750 (incremento de 50 por divisão)
// Esmeralda IV a I: 1800 a 1950 (incremento de 50 por divisão)
// Diamante IV a I: 2000 a 2225 (incremento de 75 por divisão)
// Mestre: 2400 + LP
// Grão-Mestre: 2700 + LP
// Desafiante: 3000 + LP
// Sem rank (Unranked): 1200 (equivalente a Prata IV).

export function calculateSeedMmr(tier?: string, division?: string, lp: number = 0): number {
  if (!tier || tier === 'UNRANKED') {
    return 1200;
  }

  const cleanTier = tier.toUpperCase();
  const cleanDiv = division?.toUpperCase() || 'IV';

  const divisionIndexMap: Record<string, number> = {
    IV: 0,
    III: 1,
    II: 2,
    I: 3,
  };

  const divIdx = divisionIndexMap[cleanDiv] ?? 0;

  switch (cleanTier) {
    case 'IRON':
      return 800 + divIdx * 50;
    case 'BRONZE':
      return 1000 + divIdx * 50;
    case 'SILVER':
      return 1200 + divIdx * 50;
    case 'GOLD':
      return 1400 + divIdx * 50;
    case 'PLATINUM':
      return 1600 + divIdx * 50;
    case 'EMERALD':
      return 1800 + divIdx * 50;
    case 'DIAMOND':
      return 2000 + divIdx * 75;
    case 'MASTER':
      return 2400 + Math.max(0, lp);
    case 'GRANDMASTER':
      return 2700 + Math.max(0, lp);
    case 'CHALLENGER':
      return 3000 + Math.max(0, lp);
    default:
      return 1200;
  }
}

/**
 * Cálculo do Elo Dinâmico
 * R_novo = R_atual + K * (Resultado_Real - Probabilidade_Esperada)
 * K = 40 nas 10 primeiras partidas; K = 20 nas seguintes
 */
export function calculateNewMmr(
  currentMmr: number,
  matchesPlayed: number,
  isWinner: boolean,
  teamAvgMmr: number,
  opponentAvgMmr: number
): { newMmr: number; delta: number } {
  const K = matchesPlayed < 10 ? 40 : 20;
  const expectedProbability = 1 / (1 + Math.pow(10, (opponentAvgMmr - teamAvgMmr) / 400));
  const actualOutcome = isWinner ? 1 : 0;
  
  const rawDelta = Math.round(K * (actualOutcome - expectedProbability));
  // Garante ao menos +1 ou -1 se não houver empate numérico
  const delta = isWinner ? Math.max(1, rawDelta) : Math.min(-1, rawDelta);
  const newMmr = Math.max(100, currentMmr + delta);

  return { newMmr, delta };
}
