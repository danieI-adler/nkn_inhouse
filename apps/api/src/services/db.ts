import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { PlayerProfile, MatchData, GameMode } from '@nkn/shared';

const DATA_DIR = path.resolve(__dirname, '../../../data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export interface ServerSettings {
  waitingRoomVoiceId?: string;
  queueChannelId?: string;
  queueMessageId?: string;
  queueMode?: GameMode;
  rankingChannelId?: string;
  rankingMessageId?: string;
}

export class DatabaseService {
  private players: Map<string, PlayerProfile> = new Map();
  private matches: Map<string, MatchData> = new Map();
  private settings: ServerSettings = {};
  private pool: Pool | null = null;
  private isSupabaseConnected = false;

  constructor() {
    this.ensureDirectoryExists();
    this.loadLocal();
  }

  public async init(): Promise<void> {
    await this.initPostgres();
  }

  private ensureDirectoryExists() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadLocal() {
    try {
      if (fs.existsSync(PLAYERS_FILE)) {
        const raw = fs.readFileSync(PLAYERS_FILE, 'utf-8');
        const list: PlayerProfile[] = JSON.parse(raw);
        list.forEach((p) => this.players.set(p.discordId, p));
      }
    } catch (e) {
      console.error('[DB Local] Erro ao ler players.json:', e);
    }

    try {
      if (fs.existsSync(MATCHES_FILE)) {
        const raw = fs.readFileSync(MATCHES_FILE, 'utf-8');
        const list: MatchData[] = JSON.parse(raw);
        list.forEach((m) => this.matches.set(m.id, m));
      }
    } catch (e) {
      console.error('[DB Local] Erro ao ler matches.json:', e);
    }

    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        this.settings = JSON.parse(raw);
      }
    } catch (e) {
      console.error('[DB Local] Erro ao ler settings.json:', e);
    }
  }

  private async initPostgres() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.log('ℹ️ DATABASE_URL não definida. Operando em modo armazenamento local.');
      return;
    }

    try {
      this.pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }, // Necessário para Supabase Transaction Pooler
        max: 10,
      });

      // Testar conexão
      const res = await this.pool.query('SELECT NOW()');
      console.log('⚡ Conexão com Supabase PostgreSQL estabelecida com sucesso:', res.rows[0].now);
      this.isSupabaseConnected = true;

      // Carregar dados existentes do Supabase para a memória
      await this.syncFromPostgres();
    } catch (err: any) {
      console.error('⚠️ Falha ao conectar ao Supabase PostgreSQL. Mantendo armazenamento local:', err.message);
    }
  }

  private async syncFromPostgres() {
    if (!this.pool) return;

    try {
      // 1. Carregar Jogadores
      const pRes = await this.pool.query('SELECT data FROM players');
      for (const row of pRes.rows) {
        const p = row.data as PlayerProfile;
        if (p && p.discordId) {
          this.players.set(p.discordId, p);
        }
      }

      // Se temos jogadores locais que ainda não estão no Postgres, subir
      for (const p of this.players.values()) {
        await this.pool.query(
          `INSERT INTO players (id, discord_id, discord_tag, riot_game_name, riot_tag_line, puuid, riot_rank_tier, riot_rank_division, riot_lp, internal_mmr, matches_played, wins, losses, registered_lanes, data, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()) 
           ON CONFLICT (discord_id) DO UPDATE SET 
             discord_tag = EXCLUDED.discord_tag, riot_game_name = EXCLUDED.riot_game_name, riot_tag_line = EXCLUDED.riot_tag_line, 
             puuid = EXCLUDED.puuid, riot_rank_tier = EXCLUDED.riot_rank_tier, riot_rank_division = EXCLUDED.riot_rank_division, 
             riot_lp = EXCLUDED.riot_lp, internal_mmr = EXCLUDED.internal_mmr, matches_played = EXCLUDED.matches_played, 
             wins = EXCLUDED.wins, losses = EXCLUDED.losses, registered_lanes = EXCLUDED.registered_lanes, 
             data = EXCLUDED.data, updated_at = NOW()`,
          [
            p.discordId, p.discordId, p.discordTag || null, p.riotGameName || null, p.riotTagLine || null,
            p.puuid || null, p.riotRankTier || null, p.riotRankDivision || null, p.riotLp || 0,
            p.internalMmr || 1200, p.matchesPlayed || 0, p.wins || 0, p.losses || 0,
            p.registeredLanes || ['FILL'], JSON.stringify(p),
          ]
        );
      }

      // 2. Carregar Partidas
      const mRes = await this.pool.query('SELECT data FROM matches');
      for (const row of mRes.rows) {
        const m = row.data as MatchData;
        if (m && m.id) {
          this.matches.set(m.id, m);
        }
      }

      // 3. Carregar Configurações
      const sRes = await this.pool.query("SELECT value FROM server_settings WHERE key = 'settings'");
      if (sRes.rows.length > 0) {
        this.settings = sRes.rows[0].value;
      } else if (this.settings.waitingRoomVoiceId) {
        await this.pool.query(
          "INSERT INTO server_settings (key, value) VALUES ('settings', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
          [JSON.stringify(this.settings)]
        );
      }

      console.log(`✅ Supabase sincronizado: ${this.players.size} jogadores, ${this.matches.size} partidas carregadas.`);
    } catch (err: any) {
      console.error('⚠️ Erro ao sincronizar dados com Supabase:', err.message);
    }
  }

  private saveLocalPlayers() {
    try {
      this.ensureDirectoryExists();
      const list = Array.from(this.players.values());
      fs.writeFileSync(PLAYERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.error('Erro ao salvar players.json local:', e);
    }
  }

  private saveLocalMatches() {
    try {
      this.ensureDirectoryExists();
      const list = Array.from(this.matches.values());
      fs.writeFileSync(MATCHES_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.error('Erro ao salvar matches.json local:', e);
    }
  }

  private saveLocalSettings() {
    try {
      this.ensureDirectoryExists();
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (e) {
      console.error('Erro ao salvar settings.json local:', e);
    }
  }

  // Métodos de Jogador
  getPlayer(discordId: string): PlayerProfile | undefined {
    return this.players.get(discordId);
  }

  async getPlayerAsync(discordId: string): Promise<PlayerProfile | undefined> {
    const cached = this.players.get(discordId);
    if (cached) return cached;

    if (this.pool && this.isSupabaseConnected) {
      try {
        const res = await this.pool.query('SELECT data FROM players WHERE discord_id = $1', [discordId]);
        if (res.rows.length > 0) {
          const p = res.rows[0].data as PlayerProfile;
          if (p) {
            this.players.set(discordId, p);
            return p;
          }
        }
      } catch (err: any) {
        console.error('[Supabase] Erro no getPlayerAsync:', err.message);
      }
    }

    return undefined;
  }

  setPlayer(discordId: string, profile: PlayerProfile) {
    this.players.set(discordId, profile);
    this.saveLocalPlayers();

    if (this.pool && this.isSupabaseConnected) {
      this.pool.query(
        `INSERT INTO players (id, discord_id, discord_tag, riot_game_name, riot_tag_line, puuid, riot_rank_tier, riot_rank_division, riot_lp, internal_mmr, matches_played, wins, losses, registered_lanes, data, updated_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()) 
         ON CONFLICT (discord_id) DO UPDATE SET 
           discord_tag = EXCLUDED.discord_tag, riot_game_name = EXCLUDED.riot_game_name, riot_tag_line = EXCLUDED.riot_tag_line, 
           puuid = EXCLUDED.puuid, riot_rank_tier = EXCLUDED.riot_rank_tier, riot_rank_division = EXCLUDED.riot_rank_division, 
           riot_lp = EXCLUDED.riot_lp, internal_mmr = EXCLUDED.internal_mmr, matches_played = EXCLUDED.matches_played, 
           wins = EXCLUDED.wins, losses = EXCLUDED.losses, registered_lanes = EXCLUDED.registered_lanes, 
           data = EXCLUDED.data, updated_at = NOW()`,
        [
          discordId,
          discordId,
          profile.discordTag || null,
          profile.riotGameName || null,
          profile.riotTagLine || null,
          profile.puuid || null,
          profile.riotRankTier || null,
          profile.riotRankDivision || null,
          profile.riotLp || 0,
          profile.internalMmr || 1200,
          profile.matchesPlayed || 0,
          profile.wins || 0,
          profile.losses || 0,
          profile.registeredLanes || ['FILL'],
          JSON.stringify(profile),
        ]
      )
      .then(() => console.log(`[Supabase] Jogador ${profile.riotGameName || discordId} salvo com sucesso na nuvem!`))
      .catch((err) => console.error('[Supabase] Erro ao salvar jogador:', err.message));
    }
  }

  getAllPlayers(): PlayerProfile[] {
    return Array.from(this.players.values());
  }

  // Métodos de Partida
  getMatch(matchId: string): MatchData | undefined {
    return this.matches.get(matchId);
  }

  setMatch(matchId: string, match: MatchData) {
    this.matches.set(matchId, match);
    this.saveLocalMatches();

    if (this.pool && this.isSupabaseConnected) {
      this.pool.query(
        `INSERT INTO matches (id, mode, status, room_name, room_password, blue_team, red_team, winner, data, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) 
         ON CONFLICT (id) DO UPDATE SET mode = EXCLUDED.mode, status = EXCLUDED.status, room_name = EXCLUDED.room_name, room_password = EXCLUDED.room_password, blue_team = EXCLUDED.blue_team, red_team = EXCLUDED.red_team, winner = EXCLUDED.winner, data = EXCLUDED.data`,
        [
          matchId,
          match.mode || 'RANKED_AUTO',
          match.status,
          match.roomName || `NUKENIN-${matchId.toUpperCase()}`,
          match.roomPassword || 'NKN',
          JSON.stringify(match.blueTeam || []),
          JSON.stringify(match.redTeam || []),
          match.winner || null,
          JSON.stringify(match),
        ]
      ).catch((err) => console.error('[Supabase] Erro ao salvar partida:', err.message));
    }
  }

  // Configurações do Servidor
  getSettings(): ServerSettings {
    return this.settings;
  }

  setWaitingRoom(voiceChannelId: string) {
    this.settings.waitingRoomVoiceId = voiceChannelId;
    this.saveLocalSettings();

    if (this.pool && this.isSupabaseConnected) {
      this.pool.query(
        `INSERT INTO server_settings (key, value, updated_at) 
         VALUES ('settings', $1, NOW()) 
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(this.settings)]
      ).catch((err) => console.error('[Supabase] Erro ao salvar settings:', err.message));
    }
  }

  setQueueMessage(channelId: string, messageId: string) {
    this.settings.queueChannelId = channelId;
    this.settings.queueMessageId = messageId;
    this.saveLocalSettings();

    if (this.pool && this.isSupabaseConnected) {
      this.pool.query(
        `INSERT INTO server_settings (key, value, updated_at) 
         VALUES ('settings', $1, NOW()) 
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(this.settings)]
      ).catch((err) => console.error('[Supabase] Erro ao salvar settings da fila:', err.message));
    }
  }

  setRankingMessage(channelId: string, messageId: string) {
    this.settings.rankingChannelId = channelId;
    this.settings.rankingMessageId = messageId;
    this.saveLocalSettings();

    if (this.pool && this.isSupabaseConnected) {
      this.pool.query(
        `INSERT INTO server_settings (key, value, updated_at) 
         VALUES ('settings', $1, NOW()) 
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(this.settings)]
      ).catch((err) => console.error('[Supabase] Erro ao salvar settings do ranking:', err.message));
    }
  }

  setQueueMode(mode: GameMode) {
    this.settings.queueMode = mode;
    this.saveLocalSettings();

    if (this.pool && this.isSupabaseConnected) {
      this.pool.query(
        `INSERT INTO server_settings (key, value, updated_at) 
         VALUES ('settings', $1, NOW()) 
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(this.settings)]
      ).catch((err) => console.error('[Supabase] Erro ao salvar queueMode:', err.message));
    }
  }
}

export const db = new DatabaseService();

