import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { PlayerProfile, MatchData } from '@nkn/shared';

const DATA_DIR = path.resolve(__dirname, '../../../data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export interface ServerSettings {
  waitingRoomVoiceId?: string;
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
    this.initPostgres();
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
          `INSERT INTO players (id, discord_id, data, updated_at) 
           VALUES ($1, $2, $3, NOW()) 
           ON CONFLICT (discord_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [p.discordId, p.discordId, JSON.stringify(p)]
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

  setPlayer(discordId: string, profile: PlayerProfile) {
    this.players.set(discordId, profile);
    this.saveLocalPlayers();

    if (this.pool && this.isSupabaseConnected) {
      this.pool.query(
        `INSERT INTO players (id, discord_id, data, updated_at) 
         VALUES ($1, $2, $3, NOW()) 
         ON CONFLICT (discord_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [discordId, discordId, JSON.stringify(profile)]
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
        `INSERT INTO matches (id, status, data, updated_at) 
         VALUES ($1, $2, $3, NOW()) 
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, updated_at = NOW()`,
        [matchId, match.status, JSON.stringify(match)]
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
}

export const db = new DatabaseService();

