import { calculateSeedMmr } from './mmr';

export interface RiotAccountDto {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface RiotLeagueEntryDto {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

export class RiotService {
  private apiKey: string;
  private regionRoute: string; // Ex: americas
  private platformRoute: string; // Ex: br1

  constructor(apiKey: string = process.env.RIOT_API_KEY || '', platformRoute: string = 'br1', regionRoute: string = 'americas') {
    this.apiKey = apiKey;
    this.platformRoute = platformRoute.toLowerCase();
    this.regionRoute = regionRoute.toLowerCase();
  }

  /**
   * Obtém PUUID e Riot ID oficial via Account-v1
   */
  async getAccountByRiotId(gameName: string, tagLine: string): Promise<RiotAccountDto> {
    if (!this.apiKey) {
      // Fallback para ambiente de desenvolvimento/testes locais sem chave de API
      return {
        puuid: `mock-puuid-${gameName}-${tagLine}`.toLowerCase(),
        gameName,
        tagLine,
      };
    }

    const url = `https://${this.regionRoute}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
      gameName
    )}/${encodeURIComponent(tagLine)}`;

    const res = await fetch(url, {
      headers: {
        'X-Riot-Token': this.apiKey,
      },
    });

    if (!res.ok) {
      throw new Error(`Erro ao buscar conta Riot (${res.status}): ${await res.text()}`);
    }

    return (await res.json()) as RiotAccountDto;
  }

  /**
   * Obtém dados ranqueados de Solo/Duo pelo PUUID via League-v4
   */
  async getSoloQRankByPuuid(puuid: string): Promise<{
    tier: string;
    division: string;
    lp: number;
    seedMmr: number;
  }> {
    if (!this.apiKey || puuid.startsWith('mock-puuid')) {
      // Fallback para Unranked (1200 MMR)
      return {
        tier: 'UNRANKED',
        division: 'IV',
        lp: 0,
        seedMmr: calculateSeedMmr('UNRANKED'),
      };
    }

    // league-v4 /entries/by-puuid/{puuid}
    const url = `https://${this.platformRoute}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`;

    const res = await fetch(url, {
      headers: {
        'X-Riot-Token': this.apiKey,
      },
    });

    if (!res.ok) {
      throw new Error(`Erro ao buscar elo Riot (${res.status}): ${await res.text()}`);
    }

    const entries = (await res.json()) as RiotLeagueEntryDto[];
    const soloQ = entries.find((e) => e.queueType === 'RANKED_SOLO_5x5');

    if (!soloQ) {
      return {
        tier: 'UNRANKED',
        division: 'IV',
        lp: 0,
        seedMmr: calculateSeedMmr('UNRANKED'),
      };
    }

    const seedMmr = calculateSeedMmr(soloQ.tier, soloQ.rank, soloQ.leaguePoints);
    return {
      tier: soloQ.tier,
      division: soloQ.rank,
      lp: soloQ.leaguePoints,
      seedMmr,
    };
  }
}
