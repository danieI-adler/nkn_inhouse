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

  /**
   * Obtém os top 3 campeões mais jogados (Champion Mastery v4)
   */
  async getTopChampionMasteries(puuid: string): Promise<{ id: string; name: string; level: number; points: number }[]> {
    if (!this.apiKey || puuid.startsWith('mock-puuid')) {
      return [
        { id: 'Yasuo', name: 'Yasuo', level: 7, points: 250000 },
        { id: 'Yone', name: 'Yone', level: 7, points: 180000 },
        { id: 'Zed', name: 'Zed', level: 6, points: 95000 },
      ];
    }

    try {
      const url = `https://${this.platformRoute}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=3`;
      const res = await fetch(url, {
        headers: { 'X-Riot-Token': this.apiKey },
      });

      if (!res.ok) {
        console.warn(`[RiotService] Erro ao buscar maestrias (${res.status})`);
        return [];
      }

      const masteries: any[] = await res.json();
      
      // Carrega mapeamento id <-> nome do Data Dragon
      let champMap: Record<string, { id: string; name: string }> = {};
      try {
        const ddRes = await fetch('https://ddragon.leagueoflegends.com/cdn/14.10.1/data/en_US/champion.json');
        if (ddRes.ok) {
          const ddData: any = await ddRes.json();
          Object.values(ddData.data).forEach((c: any) => {
            champMap[c.key] = { id: c.id, name: c.name };
          });
        }
      } catch (ddErr) {
        console.warn('[RiotService] Erro ao carregar Data Dragon para maestrias:', ddErr);
      }

      return masteries.map((m) => {
        const key = String(m.championId);
        const mapped = champMap[key];
        return {
          id: mapped ? mapped.id : key,
          name: mapped ? mapped.name : `Campeão ${key}`,
          level: m.championLevel,
          points: m.championPoints,
        };
      });
    } catch (err: any) {
      console.warn('[RiotService] Falha ao carregar maestrias:', err.message);
      return [];
    }
  }
}

