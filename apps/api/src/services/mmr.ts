// Parâmetros OpenSkill / TrueSkill (Weng-Lin)
// Escala IHQ: Display MMR = round(mu * 33.333) (ou seja, mu = 25 -> MMR 833.33)
// Fator de escala: MULTIPLIER = 1000 / 30 = 33.333333333333336
export const MMR_SCALE = 1000 / 30; // 33.333...
export const DEFAULT_SIGMA = 25 / 3; // 8.333... (incerteza inicial padrão do TrueSkill)
export const BETA = DEFAULT_SIGMA / 2; // 4.166... (dispersão do desempenho)
export const EPSILON = 0.0001;

/**
 * Converte elo da Riot para mu inicial.
 * No IHQ puro, todo mundo começa em mu=25 (MMR 833).
 * Com seed da Riot:
 * - Prata / Unranked: mu = 25 (MMR ~833)
 * - Ferro: mu = 18 (MMR ~600)
 * - Bronze: mu = 21 (MMR ~700)
 * - Ouro: mu = 28 (MMR ~933)
 * - Platina: mu = 32 (MMR ~1066)
 * - Esmeralda: mu = 36 (MMR ~1200)
 * - Diamante: mu = 42 (MMR ~1400)
 * - Mestre: mu = 48 (MMR ~1600)
 * - Grão-Mestre: mu = 54 (MMR ~1800)
 * - Desafiante: mu = 60 (MMR ~2000)
 */
export function calculateSeedMuAndMmr(tier?: string, division?: string, lp: number = 0): { mu: number; sigma: number; displayMmr: number } {
  if (!tier || tier === 'UNRANKED') {
    const mu = 25.0;
    const sigma = DEFAULT_SIGMA;
    return { mu, sigma, displayMmr: Math.round(mu * MMR_SCALE) };
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
  let baseMu = 25.0;

  switch (cleanTier) {
    case 'IRON':
      baseMu = 16.0 + divIdx * 1.25; // 16 a 19.75
      break;
    case 'BRONZE':
      baseMu = 20.0 + divIdx * 1.25; // 20 a 23.75
      break;
    case 'SILVER':
      baseMu = 24.0 + divIdx * 1.0; // 24 a 27
      break;
    case 'GOLD':
      baseMu = 28.0 + divIdx * 1.25; // 28 a 31.75
      break;
    case 'PLATINUM':
      baseMu = 32.0 + divIdx * 1.25; // 32 a 35.75
      break;
    case 'EMERALD':
      baseMu = 36.0 + divIdx * 1.5; // 36 a 40.5
      break;
    case 'DIAMOND':
      baseMu = 42.0 + divIdx * 1.75; // 42 a 47.25
      break;
    case 'MASTER':
      baseMu = 50.0 + Math.min(500, Math.max(0, lp)) * 0.015;
      break;
    case 'GRANDMASTER':
      baseMu = 58.0 + Math.min(1000, Math.max(0, lp)) * 0.015;
      break;
    case 'CHALLENGER':
      baseMu = 68.0 + Math.min(2000, Math.max(0, lp)) * 0.015;
      break;
    default:
      baseMu = 25.0;
  }

  const sigma = DEFAULT_SIGMA;
  const displayMmr = Math.round(baseMu * MMR_SCALE);
  return { mu: Number(baseMu.toFixed(3)), sigma: Number(sigma.toFixed(3)), displayMmr };
}

export function calculateSeedMmr(tier?: string, division?: string, lp: number = 0): number {
  return calculateSeedMuAndMmr(tier, division, lp).displayMmr;
}

// Funções matemáticas normais padrão para Weng-Lin / TrueSkill
function pdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function cdf(x: number): number {
  // Aproximação numérica de alta precisão de Abramowitz e Stegun
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-absX * absX);

  return 0.5 * (1.0 + sign * y);
}

function vNonDraw(diff: number, c: number): number {
  const val = diff / c;
  const d = cdf(val);
  if (d < 1e-9) return -val;
  return pdf(val) / d;
}

function wNonDraw(diff: number, c: number): number {
  const val = diff / c;
  const v = vNonDraw(diff, c);
  return v * (v + val);
}

export interface PlayerRatingState {
  mu: number;
  sigma: number;
  internalMmr?: number;
  matchesPlayed?: number;
}

/**
 * Calcula a nova avaliação OpenSkill / Weng-Lin para ambos os times de 5 jogadores.
 * Retorna os novos valores de mu, sigma e display MMR para cada jogador.
 */
export function calculateMatchOpenSkill(
  teamA: PlayerRatingState[],
  teamB: PlayerRatingState[],
  teamAWon: boolean
): {
  teamAUpdates: { newMu: number; newSigma: number; newMmr: number; delta: number }[];
  teamBUpdates: { newMu: number; newSigma: number; newMmr: number; delta: number }[];
} {
  const winner = teamAWon ? teamA : teamB;
  const loser = teamAWon ? teamB : teamA;

  // Soma de mu de cada time
  const muWinner = winner.reduce((acc, p) => acc + (p.mu ?? 25), 0);
  const muLoser = loser.reduce((acc, p) => acc + (p.mu ?? 25), 0);

  // Soma das variâncias sigma^2
  const varWinner = winner.reduce((acc, p) => acc + Math.pow(p.sigma ?? DEFAULT_SIGMA, 2), 0);
  const varLoser = loser.reduce((acc, p) => acc + Math.pow(p.sigma ?? DEFAULT_SIGMA, 2), 0);

  // Total de participantes no confronto (10)
  const totalPlayers = winner.length + loser.length;
  const c = Math.sqrt(varWinner + varLoser + totalPlayers * Math.pow(BETA, 2));

  const diff = muWinner - muLoser;
  const v = vNonDraw(diff, c);
  const w = wNonDraw(diff, c);

  // Atualiza vencedores
  const winnerUpdates = winner.map((p) => {
    const currentMu = p.mu ?? 25;
    const currentSigma = p.sigma ?? DEFAULT_SIGMA;
    const sigmaSq = Math.pow(currentSigma, 2);

    const deltaMu = (sigmaSq / c) * v;
    const newMu = currentMu + deltaMu;

    // Atualiza incerteza (sigma diminui conforme mais jogos são jogados)
    const factor = 1 - (sigmaSq / Math.pow(c, 2)) * w;
    const newSigma = Math.max(1.0, currentSigma * Math.sqrt(Math.max(0.01, factor)));

    const currentMmr = p.internalMmr ?? Math.round(currentMu * MMR_SCALE);
    const newMmr = Math.round(newMu * MMR_SCALE);
    const delta = newMmr - currentMmr;

    return {
      newMu: Number(newMu.toFixed(4)),
      newSigma: Number(newSigma.toFixed(4)),
      newMmr,
      delta,
    };
  });

  // Atualiza perdedores
  const loserUpdates = loser.map((p) => {
    const currentMu = p.mu ?? 25;
    const currentSigma = p.sigma ?? DEFAULT_SIGMA;
    const sigmaSq = Math.pow(currentSigma, 2);

    const deltaMu = -(sigmaSq / c) * v;
    const newMu = Math.max(1.0, currentMu + deltaMu);

    const factor = 1 - (sigmaSq / Math.pow(c, 2)) * w;
    const newSigma = Math.max(1.0, currentSigma * Math.sqrt(Math.max(0.01, factor)));

    const currentMmr = p.internalMmr ?? Math.round(currentMu * MMR_SCALE);
    const newMmr = Math.round(newMu * MMR_SCALE);
    const delta = newMmr - currentMmr;

    return {
      newMu: Number(newMu.toFixed(4)),
      newSigma: Number(newSigma.toFixed(4)),
      newMmr,
      delta,
    };
  });

  return {
    teamAUpdates: teamAWon ? winnerUpdates : loserUpdates,
    teamBUpdates: teamAWon ? loserUpdates : winnerUpdates,
  };
}

