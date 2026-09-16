import fs from 'fs';
import path from 'path';
import { PlayerProfile, MatchData } from '@nkn/shared';

const DATA_DIR = path.resolve(__dirname, '../../../data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export interface ServerSettings {
  waitingRoomVoiceId?: string;
}

export class JsonDb {
  private players: Map<string, PlayerProfile> = new Map();
  private matches: Map<string, MatchData> = new Map();
  private settings: ServerSettings = {};

  constructor() {
    this.ensureDirectoryExists();
    this.load();
  }

  private ensureDirectoryExists() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private load() {
    try {
      if (fs.existsSync(PLAYERS_FILE)) {
        const raw = fs.readFileSync(PLAYERS_FILE, 'utf-8');
        const list: PlayerProfile[] = JSON.parse(raw);
        list.forEach((p) => this.players.set(p.discordId, p));
      }
    } catch (e) {
      console.error('Erro ao ler players.json:', e);
    }

    try {
      if (fs.existsSync(MATCHES_FILE)) {
        const raw = fs.readFileSync(MATCHES_FILE, 'utf-8');
        const list: MatchData[] = JSON.parse(raw);
        list.forEach((m) => this.matches.set(m.id, m));
      }
    } catch (e) {
      console.error('Erro ao ler matches.json:', e);
    }

    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        this.settings = JSON.parse(raw);
      }
    } catch (e) {
      console.error('Erro ao ler settings.json:', e);
    }
  }

  savePlayers() {
    try {
      this.ensureDirectoryExists();
      const list = Array.from(this.players.values());
      fs.writeFileSync(PLAYERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.error('Erro ao salvar players.json:', e);
    }
  }

  saveMatches() {
    try {
      this.ensureDirectoryExists();
      const list = Array.from(this.matches.values());
      fs.writeFileSync(MATCHES_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.error('Erro ao salvar matches.json:', e);
    }
  }

  saveSettings() {
    try {
      this.ensureDirectoryExists();
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (e) {
      console.error('Erro ao salvar settings.json:', e);
    }
  }

  // Métodos de Jogador
  getPlayer(discordId: string): PlayerProfile | undefined {
    return this.players.get(discordId);
  }

  setPlayer(discordId: string, profile: PlayerProfile) {
    this.players.set(discordId, profile);
    this.savePlayers();
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
    this.saveMatches();
  }

  // Configurações do Servidor
  getSettings(): ServerSettings {
    return this.settings;
  }

  setWaitingRoom(voiceChannelId: string) {
    this.settings.waitingRoomVoiceId = voiceChannelId;
    this.saveSettings();
  }
}

export const db = new JsonDb();
