export type Lane = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT' | 'FILL';

export interface PlayerProfile {
  id: string;
  discordId: string;
  discordTag: string;
  riotGameName: string;
  riotTagLine: string;
  puuid: string;
  riotRankTier: string; // IRON, BRONZE, SILVER, GOLD, PLATINUM, EMERALD, DIAMOND, MASTER, GRANDMASTER, CHALLENGER, UNRANKED
  riotRankDivision: string; // I, II, III, IV
  riotLp: number;
  internalMmr: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  registeredLanes: Lane[];
}

export type GameMode = 'RANKED_AUTO' | 'RANKED_CAPTAIN' | 'CASUAL_ARAM_ZOACAO';

export type TeamSide = 'BLUE' | 'RED';

export interface MatchSlot {
  player: PlayerProfile;
  assignedLane: Lane;
  team: TeamSide;
  isCaptain: boolean;
  championId?: string;
  championName?: string;
}

export interface MatchData {
  id: string;
  mode: GameMode;
  roomName: string;
  roomPassword: string;
  blueTeam: MatchSlot[];
  redTeam: MatchSlot[];
  discordChannelId?: string;
  discordBlueVoiceId?: string;
  discordRedVoiceId?: string;
  createdAt: number;
  status: 'FORMING' | 'DRAFTING' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';
  winner?: TeamSide;
  blueCaptainToken: string;
  redCaptainToken: string;
  spectatorToken: string;
}

export type DraftPhase =
  | 'WAITING'
  | 'BAN_1'
  | 'PICK_1'
  | 'BAN_2'
  | 'PICK_2'
  | 'SWAP_ROLES'
  | 'FINISHED';

export interface DraftAction {
  type: 'BAN' | 'PICK';
  team: TeamSide;
  stepIndex: number;
  championId?: string;
  championName?: string;
}

export interface DraftState {
  matchId: string;
  phase: DraftPhase;
  currentTurn: TeamSide;
  currentActionType: 'BAN' | 'PICK';
  stepIndex: number;
  timerSecondsRemaining: number;
  blueHasExtraTime: boolean;
  redHasExtraTime: boolean;
  blueUsedExtraTime: boolean;
  redUsedExtraTime: boolean;
  blueBans: string[];
  redBans: string[];
  blueSlots?: { discordTag: string; riotId: string; lane: Lane }[];
  redSlots?: { discordTag: string; riotId: string; lane: Lane }[];
  bluePicks: { championId: string; championName: string; lane?: Lane; playerPuuid?: string }[];
  redPicks: { championId: string; championName: string; lane?: Lane; playerPuuid?: string }[];
  isCompleted: boolean;
}

export const DRAFT_SEQUENCE: { type: 'BAN' | 'PICK'; team: TeamSide }[] = [
  // Ban Phase 1 (6 bans: B1, R1, B2, R2, B3, R3)
  { type: 'BAN', team: 'BLUE' },
  { type: 'BAN', team: 'RED' },
  { type: 'BAN', team: 'BLUE' },
  { type: 'BAN', team: 'RED' },
  { type: 'BAN', team: 'BLUE' },
  { type: 'BAN', team: 'RED' },
  // Pick Phase 1 (B1 - R1,R2 - B2,B3 - R3)
  { type: 'PICK', team: 'BLUE' },
  { type: 'PICK', team: 'RED' },
  { type: 'PICK', team: 'RED' },
  { type: 'PICK', team: 'BLUE' },
  { type: 'PICK', team: 'BLUE' },
  { type: 'PICK', team: 'RED' },
  // Ban Phase 2 (R4, B4, R5, B5)
  { type: 'BAN', team: 'RED' },
  { type: 'BAN', team: 'BLUE' },
  { type: 'BAN', team: 'RED' },
  { type: 'BAN', team: 'BLUE' },
  // Pick Phase 2 (R4, B4, B5, R5)
  { type: 'PICK', team: 'RED' },
  { type: 'PICK', team: 'BLUE' },
  { type: 'PICK', team: 'BLUE' },
  { type: 'PICK', team: 'RED' },
];
