import { useState, useEffect, useMemo, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Search,
  ShieldAlert,
  Swords,
  RotateCcw,
  Trophy,
  Check,
  ArrowRightLeft,
  Users,
  Radio,
  Flame,
  Clock,
} from 'lucide-react';

const DEFAULT_DDRAGON_VER = '16.18.1';

export type TeamSide = 'BLUE' | 'RED';
export type Lane = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT';

export interface ChampionData {
  id: string;
  name: string;
  title?: string;
  roles: Lane[];
  customAvatar?: string;
  customSplash?: string;
}

// Campeões recentes e futuros mapeados com assets oficiais Riot Games API
const SPECIAL_CHAMPIONS: ChampionData[] = [
  {
    id: 'Aurora',
    name: 'Aurora',
    title: 'A Bruxa Entre Mundos',
    roles: ['MID'],
    customAvatar: 'https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/Aurora.png',
    customSplash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Aurora_0.jpg',
  },
  {
    id: 'Ambessa',
    name: 'Ambessa',
    title: 'A Matriarca da Guerra',
    roles: ['TOP', 'JUNGLE'],
    customAvatar: 'https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/Ambessa.png',
    customSplash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Ambessa_0.jpg',
  },
  {
    id: 'Mel',
    name: 'Mel',
    title: 'O Reflexo da Alma',
    roles: ['MID', 'SUPPORT'],
    customAvatar: 'https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/Mel.png',
    customSplash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Mel_0.jpg',
  },
  {
    id: 'Yunara',
    name: 'Yunara',
    title: 'A Fé Inabalável',
    roles: ['ADC'],
    customAvatar: 'https://images.contentstack.io/v3/assets/blt731acb42bb3d1659/blt6d5d5402a5cf38b1/660c1d68a25c6020c647ceb5/lol-champion-icon-placeholder.jpg',
    customSplash: 'https://images.contentstack.io/v3/assets/blt731acb42bb3d1659/blt56e1da3e2d6bce18/668461fc1da09b1836f3387a/aurora-avatar.jpg',
  },
  {
    id: 'Zaahen',
    name: 'Zaahen',
    title: 'O Indiviso',
    roles: ['TOP'],
    customAvatar: 'https://images.contentstack.io/v3/assets/blt731acb42bb3d1659/blt545e8f495b452e8c/672a265691079d39b893a70b/ambessa-avatar.jpg',
    customSplash: 'https://images.contentstack.io/v3/assets/blt731acb42bb3d1659/blta82136e07e866e4e/672a2657e2c9183ec9e4ba6f/ambessa-splash.jpg',
  },
  {
    id: 'Locke',
    name: 'Locke',
    title: 'O Exorcista Cinzento',
    roles: ['MID'],
    customAvatar: 'https://images.contentstack.io/v3/assets/blt731acb42bb3d1659/blt3f0a9a1d13f9c3f4/677f276c1dc11054a85ba46b/mel-avatar.jpg',
    customSplash: 'https://images.contentstack.io/v3/assets/blt731acb42bb3d1659/bltd1dcae3a3f5a285b/677f276cd86ef259b1fa9f12/mel-splash.jpg',
  },
];

export const DRAFT_SEQUENCE: { type: 'BAN' | 'PICK'; team: TeamSide; stepName: string }[] = [
  // Ban Phase 1 (6 bans alternados)
  { type: 'BAN', team: 'BLUE', stepName: 'Ban Azul 1' },
  { type: 'BAN', team: 'RED', stepName: 'Ban Vermelho 1' },
  { type: 'BAN', team: 'BLUE', stepName: 'Ban Azul 2' },
  { type: 'BAN', team: 'RED', stepName: 'Ban Vermelho 2' },
  { type: 'BAN', team: 'BLUE', stepName: 'Ban Azul 3' },
  { type: 'BAN', team: 'RED', stepName: 'Ban Vermelho 3' },
  // Pick Phase 1 (B1 - R1, R2 - B2, B3 - R3)
  { type: 'PICK', team: 'BLUE', stepName: 'Pick Azul 1 (B1)' },
  { type: 'PICK', team: 'RED', stepName: 'Pick Vermelho 1 (R1)' },
  { type: 'PICK', team: 'RED', stepName: 'Pick Vermelho 2 (R2)' },
  { type: 'PICK', team: 'BLUE', stepName: 'Pick Azul 2 (B2)' },
  { type: 'PICK', team: 'BLUE', stepName: 'Pick Azul 3 (B3)' },
  { type: 'PICK', team: 'RED', stepName: 'Pick Vermelho 3 (R3)' },
  // Ban Phase 2 (R4, B4, R5, B5)
  { type: 'BAN', team: 'RED', stepName: 'Ban Vermelho 4' },
  { type: 'BAN', team: 'BLUE', stepName: 'Ban Azul 4' },
  { type: 'BAN', team: 'RED', stepName: 'Ban Vermelho 5' },
  { type: 'BAN', team: 'BLUE', stepName: 'Ban Azul 5' },
  // Pick Phase 2 (R4, B4, B5, R5)
  { type: 'PICK', team: 'RED', stepName: 'Pick Vermelho 4 (R4)' },
  { type: 'PICK', team: 'BLUE', stepName: 'Pick Azul 4 (B4)' },
  { type: 'PICK', team: 'BLUE', stepName: 'Pick Azul 5 (B5)' },
  { type: 'PICK', team: 'RED', stepName: 'Pick Vermelho 5 (R5)' },
];

export const LANES_ORDER: Lane[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

export default function App() {
  const [champions, setChampions] = useState<ChampionData[]>([]);
  const [loadingChamps, setLoadingChamps] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeLaneFilter, setActiveLaneFilter] = useState<'ALL' | Lane>('ALL');

  // Estado do Draft
  const [stepIndex, setStepIndex] = useState(0);
  const [timer, setTimer] = useState(45);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedChampion, setSelectedChampion] = useState<ChampionData | null>(null);

  // Bans e Picks
  const [blueBans, setBlueBans] = useState<ChampionData[]>([]);
  const [redBans, setRedBans] = useState<ChampionData[]>([]);
  const [bluePicks, setBluePicks] = useState<ChampionData[]>([]);
  const [redPicks, setRedPicks] = useState<ChampionData[]>([]);

  // Nomes dos 10 Jogadores (Estilo Competitivo Oficial / Inhouse)
  const [bluePlayers, setBluePlayers] = useState<string[]>([
    'NKN DanCrox',
    'NKN Fogo',
    'NKN Shiro',
    'NKN Raven',
    'NKN Kael',
  ]);

  const [redPlayers, setRedPlayers] = useState<string[]>([
    'NKN Zephyr',
    'NKN Shadow',
    'NKN Blaze',
    'NKN Ghost',
    'NKN Frost',
  ]);

  // Troca de Rotas (Swap Lanes) no final (30 segundos)
  const [swapSourceIndex, setSwapSourceIndex] = useState<{ team: TeamSide; index: number } | null>(null);
  const [swapTimer, setSwapTimer] = useState(30);
  const [isFullyFinalized, setIsFullyFinalized] = useState(false);

  // Modo de controle: 'SOLO_SIMULATOR', 'BLUE_ONLY', 'RED_ONLY'
  const [controlMode, setControlMode] = useState<'SOLO_SIMULATOR' | 'BLUE_ONLY' | 'RED_ONLY'>('SOLO_SIMULATOR');

  const isCompleted = stepIndex >= DRAFT_SEQUENCE.length;
  const currentStep = isCompleted ? null : DRAFT_SEQUENCE[stepIndex];

  // Conexão e sincronização via Socket.io
  const socketRef = useRef<Socket | null>(null);
  const [matchId, setMatchId] = useState<string>('');
  const [captainToken, setCaptainToken] = useState<string>('');
  const [userRole, setUserRole] = useState<'BLUE_CAPTAIN' | 'RED_CAPTAIN' | 'SPECTATOR'>('SPECTATOR');
  const [draftPhase, setDraftPhase] = useState<string>('READY_CHECK');
  const [blueReady, setBlueReady] = useState(false);
  const [redReady, setRedReady] = useState(false);
  const [blueConnected, setBlueConnected] = useState(false);
  const [redConnected, setRedConnected] = useState(false);
  const [isSocketMode, setIsSocketMode] = useState(false);

  // Sincronização via Socket.io com o Backend da Inhouse (jogadores reais do Discord)
  useEffect(() => {
    const hash = window.location.hash || '';
    const hashSearch = hash.includes('?') ? hash.substring(hash.indexOf('?')) : '';
    const urlParams = new URLSearchParams(window.location.search || hashSearch);

    let mId = urlParams.get('matchId') || '';
    const tok = urlParams.get('token') || '';

    if (!mId) {
      const hashMatch = hash.match(/\/draft\/([^/?#]+)/);
      if (hashMatch) {
        mId = hashMatch[1];
      } else {
        const pathParts = window.location.pathname.split('/');
        const draftIdx = pathParts.indexOf('draft');
        if (draftIdx !== -1 && pathParts[draftIdx + 1]) {
          mId = pathParts[draftIdx + 1];
        }
      }
    }

    if (!mId) return;

    setMatchId(mId);
    setCaptainToken(tok);
    setIsSocketMode(true);

    const apiUrl =
      import.meta.env.VITE_API_URL ||
      (window.location.hostname.includes('github.io')
        ? 'https://nkn-inhouse-service.onrender.com'
        : 'http://localhost:3001');

    const socket = io(apiUrl);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('📡 Conectado ao servidor de draft da Nukenin!');
      socket.emit('join_draft', { matchId: mId, token: tok });
    });

    const syncState = (state: any, role?: string) => {
      if (!state) return;
      if (role) {
        setUserRole(role as any);
        if (role === 'BLUE_CAPTAIN') setControlMode('BLUE_ONLY');
        else if (role === 'RED_CAPTAIN') setControlMode('RED_ONLY');
        else setControlMode('SPECTATOR' as any);
      }

      setDraftPhase(state.phase || 'READY_CHECK');
      setBlueReady(Boolean(state.blueReady));
      setRedReady(Boolean(state.redReady));
      setBlueConnected(Boolean(state.blueConnected));
      setRedConnected(Boolean(state.redConnected));

      if (state.timerSecondsRemaining !== undefined) {
        setTimer(state.timerSecondsRemaining);
      }

      if (state.stepIndex !== undefined) {
        setStepIndex(state.stepIndex);
      }

      if (state.blueSlots && state.blueSlots.length === 5) {
        setBluePlayers(state.blueSlots.map((s: any) => s.riotGameName || (s.riotId ? s.riotId.split('#')[0] : '') || s.discordTag || 'Jogador'));
      }
      if (state.redSlots && state.redSlots.length === 5) {
        setRedPlayers(state.redSlots.map((s: any) => s.riotGameName || (s.riotId ? s.riotId.split('#')[0] : '') || s.discordTag || 'Jogador'));
      }

      if (Array.isArray(state.blueBans)) {
        setBlueBans(state.blueBans.map((b: string) => ({ id: b, name: b, roles: [] })));
      }
      if (Array.isArray(state.redBans)) {
        setRedBans(state.redBans.map((b: string) => ({ id: b, name: b, roles: [] })));
      }
      if (Array.isArray(state.bluePicks)) {
        setBluePicks(state.bluePicks.map((p: any) => ({ id: p.championId, name: p.championName, roles: [] })));
      }
      if (Array.isArray(state.redPicks)) {
        setRedPicks(state.redPicks.map((p: any) => ({ id: p.championId, name: p.championName, roles: [] })));
      }
    };

    socket.on('draft_init', (data: any) => {
      syncState(data.state, data.userRole);
    });

    socket.on('user_joined', (data: any) => {
      if (data.state) syncState(data.state);
    });

    socket.on('ready_status_update', (data: any) => {
      syncState(data.state);
    });

    socket.on('draft_started', (data: any) => {
      syncState(data.state);
    });

    socket.on('draft_update', (data: any) => {
      syncState(data.state);
      setSelectedChampion(null);
    });

    socket.on('timer_tick', (data: { secondsRemaining: number }) => {
      setTimer(data.secondsRemaining);
      if (data.secondsRemaining <= 30 && draftPhase === 'SWAP_ROLES') {
        setSwapTimer(data.secondsRemaining);
      }
    });

    socket.on('draft_completed', (data: any) => {
      syncState(data.state);
      setIsFullyFinalized(true);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // 1. Carrega dinamicamente a versão mais recente e todos os campeões oficiais via Data Dragon
  useEffect(() => {
    async function loadDataDragon() {
      try {
        let activeVersion = DEFAULT_DDRAGON_VER;
        try {
          const versionsRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
          const versions = await versionsRes.json();
          if (versions && versions.length > 0) {
            activeVersion = versions[0];
          }
        } catch {
          activeVersion = DEFAULT_DDRAGON_VER;
        }

        const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${activeVersion}/data/pt_BR/champion.json`);
        const json = await res.json();
        const champsList: ChampionData[] = Object.values(json.data).map((c: any) => ({
          id: c.id,
          name: c.name,
          title: c.title,
          roles: c.tags.includes('Marksman')
            ? ['ADC']
            : c.tags.includes('Support')
            ? ['SUPPORT']
            : c.tags.includes('Tank')
            ? ['TOP', 'SUPPORT']
            : c.tags.includes('Mage')
            ? ['MID']
            : c.tags.includes('Assassin')
            ? ['MID', 'JUNGLE']
            : ['TOP'],
        }));

        // Adiciona os campeões especiais que não estão no DDragon 14.10.1
        const existingIds = new Set(champsList.map((c) => c.id.toLowerCase()));
        for (const special of SPECIAL_CHAMPIONS) {
          if (!existingIds.has(special.id.toLowerCase())) {
            champsList.push(special);
          }
        }

        champsList.sort((a, b) => a.name.localeCompare(b.name));
        setChampions(champsList);
      } catch (err) {
        console.error('Erro ao carregar Data Dragon:', err);
        setChampions(SPECIAL_CHAMPIONS);
      } finally {
        setLoadingChamps(false);
      }
    }
    loadDataDragon();
  }, []);

  // 2. Timer decrescente de 45s para picks e bans
  useEffect(() => {
    if (isCompleted || isPaused) return;

    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          handleAutoSelect();
          return 45;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [stepIndex, isCompleted, isPaused, champions]);

  // 3. Timer decrescente de 30s para a fase de troca de campeões (Swap Phase)
  useEffect(() => {
    if (!isCompleted || isFullyFinalized || isPaused) return;

    const interval = setInterval(() => {
      setSwapTimer((prev) => {
        if (prev <= 1) {
          setIsFullyFinalized(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isCompleted, isFullyFinalized, isPaused]);

  // Lista de IDs já selecionados ou banidos
  const unavailableIds = useMemo(() => {
    const ids = new Set<string>();
    blueBans.forEach((c) => ids.add(c.id));
    redBans.forEach((c) => ids.add(c.id));
    bluePicks.forEach((c) => ids.add(c.id));
    redPicks.forEach((c) => ids.add(c.id));
    return ids;
  }, [blueBans, redBans, bluePicks, redPicks]);

  // Filtro de busca e rota
  const filteredChampions = useMemo(() => {
    return champions.filter((c) => {
      const matchSearch =
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.title && c.title.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchLane = activeLaneFilter === 'ALL' || c.roles.includes(activeLaneFilter);
      return matchSearch && matchLane;
    });
  }, [champions, searchQuery, activeLaneFilter]);

  // Auto-seleção em caso de tempo esgotado
  const handleAutoSelect = () => {
    const available = champions.filter((c) => !unavailableIds.has(c.id));
    if (available.length === 0) return;
    const randomChamp = available[Math.floor(Math.random() * available.length)];
    executeAction(randomChamp);
  };

  // Envia confirmação de "Pronto" ao backend
  const handleCaptainReady = () => {
    if (socketRef.current && matchId && captainToken) {
      socketRef.current.emit('captain_ready', { matchId, token: captainToken });
    }
  };

  // Executa Ban ou Pick
  const executeAction = (champ: ChampionData) => {
    if (!currentStep || isCompleted) return;

    // Se estiver conectado via socket, envia para a API sincronizar ambas as telas!
    if (isSocketMode && socketRef.current && matchId && captainToken) {
      socketRef.current.emit('submit_action', {
        matchId,
        token: captainToken,
        championId: champ.id,
        championName: champ.name,
      });
      setSelectedChampion(null);
      return;
    }

    // Modo simulador local offline
    if (currentStep.type === 'BAN') {
      if (currentStep.team === 'BLUE') setBlueBans((prev) => [...prev, champ]);
      else setRedBans((prev) => [...prev, champ]);
    } else {
      if (currentStep.team === 'BLUE') setBluePicks((prev) => [...prev, champ]);
      else setRedPicks((prev) => [...prev, champ]);
    }

    setSelectedChampion(null);
    setTimer(45);
    setStepIndex((prev) => prev + 1);
  };

  const handleConfirm = () => {
    if (!selectedChampion || !currentStep) return;
    executeAction(selectedChampion);
  };

  const handleResetDraft = () => {
    setStepIndex(0);
    setTimer(45);
    setSwapTimer(30);
    setIsFullyFinalized(false);
    setSelectedChampion(null);
    setBlueBans([]);
    setRedBans([]);
    setBluePicks([]);
    setRedPicks([]);
    setIsPaused(false);
    setSwapSourceIndex(null);
  };

  // Função para Troca de Lanes (Swap de Campeões no time ao final)
  const handleSlotClickForSwap = (team: TeamSide, clickedIndex: number) => {
    if (!isCompleted) return;

    if (!swapSourceIndex) {
      // Primeiro clique: seleciona origem
      setSwapSourceIndex({ team, index: clickedIndex });
      return;
    }

    // Se clicar no mesmo slot, desmarca
    if (swapSourceIndex.team === team && swapSourceIndex.index === clickedIndex) {
      setSwapSourceIndex(null);
      return;
    }

    // Só pode trocar entre membros do MESMO time
    if (swapSourceIndex.team !== team) {
      setSwapSourceIndex({ team, index: clickedIndex });
      return;
    }

    // Realiza a troca dos campeões entre os dois slots
    if (team === 'BLUE') {
      setBluePicks((prev) => {
        const next = [...prev];
        const temp = next[swapSourceIndex.index];
        next[swapSourceIndex.index] = next[clickedIndex];
        next[clickedIndex] = temp;
        return next;
      });
    } else {
      setRedPicks((prev) => {
        const next = [...prev];
        const temp = next[swapSourceIndex.index];
        next[swapSourceIndex.index] = next[clickedIndex];
        next[clickedIndex] = temp;
        return next;
      });
    }

    setSwapSourceIndex(null);
  };

  const canUserAct = useMemo(() => {
    if (draftPhase === 'READY_CHECK') return false;
    if (isCompleted || !currentStep) return false;
    if (isSocketMode) {
      if (userRole === 'BLUE_CAPTAIN' && currentStep.team === 'BLUE') return true;
      if (userRole === 'RED_CAPTAIN' && currentStep.team === 'RED') return true;
      return false;
    }
    if (controlMode === 'SOLO_SIMULATOR') return true;
    if (controlMode === 'BLUE_ONLY' && currentStep.team === 'BLUE') return true;
    if (controlMode === 'RED_ONLY' && currentStep.team === 'RED') return true;
    return false;
  }, [controlMode, currentStep, isCompleted, draftPhase, isSocketMode, userRole]);

  // Helper para URL de Imagem (Data Dragon vs Campeões Customizados)
  const getAvatarUrl = (c: ChampionData) => {
    if (c.customAvatar) return c.customAvatar;
    return `https://ddragon.leagueoflegends.com/cdn/${DEFAULT_DDRAGON_VER}/img/champion/${c.id}.png`;
  };

  const getSplashUrl = (c: ChampionData) => {
    if (c.customSplash) return c.customSplash;
    return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${c.id}_0.jpg`;
  };

  return (
    <div className="min-h-screen bg-[#07050f] text-white flex flex-col font-sans select-none overflow-x-hidden">
      {/* Top Header Bar */}
      <header className="h-16 border-b border-purple-900/40 bg-[#0c081a]/95 backdrop-blur px-6 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center font-bold text-xl tracking-wider shadow-lg shadow-purple-600/40 border border-purple-400/30">
            🥷
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-wider leading-none text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-indigo-200 to-purple-400 font-mono">
              NUKENIN DRAFT
            </h1>
            <span className="text-[11px] text-purple-400/80 uppercase tracking-widest font-mono">
              Simulador Interativo • Torneio Oficial
            </span>
          </div>
        </div>

        {/* Controles de Simulação & Status da Conexão */}
        <div className="flex items-center gap-3">
          {isSocketMode ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-950/60 border border-purple-800/50">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-xs font-mono font-bold text-purple-200">
                {userRole === 'BLUE_CAPTAIN'
                  ? '🔵 VOCÊ É O CAPITÃO AZUL'
                  : userRole === 'RED_CAPTAIN'
                  ? '🔴 VOCÊ É O CAPITÃO VERMELHO'
                  : '👁️ MODO ESPECTADOR'}
              </span>
            </div>
          ) : (
            <div className="bg-[#140c2b] border border-purple-900/60 rounded-lg p-1 flex items-center text-xs">
              <button
                onClick={() => setControlMode('SOLO_SIMULATOR')}
                className={`px-3 py-1 rounded transition font-medium ${
                  controlMode === 'SOLO_SIMULATOR'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                🎮 Ambos os Lados
              </button>
              <button
                onClick={() => setControlMode('BLUE_ONLY')}
                className={`px-3 py-1 rounded transition font-medium ${
                  controlMode === 'BLUE_ONLY'
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                🔵 Apenas Azul
              </button>
              <button
                onClick={() => setControlMode('RED_ONLY')}
                className={`px-3 py-1 rounded transition font-medium ${
                  controlMode === 'RED_ONLY'
                    ? 'bg-rose-600 text-white shadow'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                🔴 Apenas Vermelho
              </button>
            </div>
          )}

          {!isSocketMode && (
            <>
              <button
                onClick={() => setIsPaused(!isPaused)}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-semibold transition"
              >
                {isPaused ? '▶️ Despausar' : '⏸️ Pausar'}
              </button>

              <button
                onClick={handleResetDraft}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/50 hover:bg-red-900/60 border border-red-800/40 text-red-200 text-xs font-semibold transition"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reiniciar
              </button>
            </>
          )}
        </div>
      </header>

      {/* ===================== TELA DE READY CHECK (ESTILO DRAFTER.LOL) ===================== */}
      {isSocketMode && draftPhase === 'READY_CHECK' && (
        <div className="fixed inset-0 z-50 bg-[#06040d]/90 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="max-w-2xl w-full bg-[#100b24] border border-purple-500/40 rounded-3xl p-8 shadow-2xl flex flex-col items-center text-center relative overflow-hidden">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center font-bold text-3xl shadow-xl shadow-purple-600/50 mb-4 border border-purple-400/40">
              ⚔️
            </div>

            <h2 className="text-3xl font-extrabold font-mono tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-white to-purple-300">
              SALA DE DRAFT NUKENIN
            </h2>
            <p className="text-gray-400 text-sm mt-1 mb-8 max-w-md">
              Ambos os capitães precisam confirmar que estão prontos para iniciar o cronômetro oficial de picks e bans.
            </p>

            <div className="grid grid-cols-2 gap-6 w-full mb-8">
              {/* Card Capitão Azul */}
              <div
                className={`p-5 rounded-2xl border transition-all flex flex-col items-center gap-3 ${
                  blueReady
                    ? 'border-emerald-500/80 bg-emerald-950/20 shadow-lg shadow-emerald-500/20'
                    : blueConnected
                    ? 'border-sky-500/50 bg-sky-950/20 shadow-lg shadow-sky-500/10'
                    : 'border-white/10 bg-black/40'
                }`}
              >
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-sky-950 border border-sky-500/40 text-sky-300 font-bold text-lg">
                  🔵
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-base text-sky-300 font-mono">TIME AZUL</span>
                  <span className="text-xs text-gray-400">{bluePlayers[0] || 'Capitão Azul'}</span>
                </div>
                <div className="mt-1">
                  {blueReady ? (
                    <span className="px-3 py-1 bg-emerald-500/20 border border-emerald-400/60 rounded-full text-emerald-300 font-mono text-xs font-bold flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> PRONTO
                    </span>
                  ) : blueConnected ? (
                    <span className="px-3 py-1 bg-sky-500/10 border border-sky-400/40 rounded-full text-sky-300 font-mono text-xs flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 animate-pulse" /> CONECTADO
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-gray-800/40 border border-gray-700 rounded-full text-gray-500 font-mono text-xs">
                      AGUARDANDO CONEXÃO
                    </span>
                  )}
                </div>
              </div>

              {/* Card Capitão Vermelho */}
              <div
                className={`p-5 rounded-2xl border transition-all flex flex-col items-center gap-3 ${
                  redReady
                    ? 'border-emerald-500/80 bg-emerald-950/20 shadow-lg shadow-emerald-500/20'
                    : redConnected
                    ? 'border-rose-500/50 bg-rose-950/20 shadow-lg shadow-rose-500/10'
                    : 'border-white/10 bg-black/40'
                }`}
              >
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-rose-950 border border-rose-500/40 text-rose-300 font-bold text-lg">
                  🔴
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-base text-rose-300 font-mono">TIME VERMELHO</span>
                  <span className="text-xs text-gray-400">{redPlayers[0] || 'Capitão Vermelho'}</span>
                </div>
                <div className="mt-1">
                  {redReady ? (
                    <span className="px-3 py-1 bg-emerald-500/20 border border-emerald-400/60 rounded-full text-emerald-300 font-mono text-xs font-bold flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> PRONTO
                    </span>
                  ) : redConnected ? (
                    <span className="px-3 py-1 bg-rose-500/10 border border-rose-400/40 rounded-full text-rose-300 font-mono text-xs flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 animate-pulse" /> CONECTADO
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-gray-800/40 border border-gray-700 rounded-full text-gray-500 font-mono text-xs">
                      AGUARDANDO CONEXÃO
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Botão de Confirmação do Usuário Atual */}
            {userRole === 'BLUE_CAPTAIN' && (
              <button
                onClick={handleCaptainReady}
                disabled={blueReady}
                className={`w-full py-4 rounded-2xl font-bold text-lg font-mono tracking-wider transition shadow-2xl flex items-center justify-center gap-2 ${
                  blueReady
                    ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-sky-500/40 cursor-pointer animate-pulse'
                }`}
              >
                {blueReady ? (
                  <>
                    <Check className="w-6 h-6" /> VOCÊ ESTÁ PRONTO! AGUARDANDO ADVERSÁRIO...
                  </>
                ) : (
                  <>
                    <Flame className="w-6 h-6" /> ESTOU PRONTO (ESTILO DRAFTER.LOL)
                  </>
                )}
              </button>
            )}

            {userRole === 'RED_CAPTAIN' && (
              <button
                onClick={handleCaptainReady}
                disabled={redReady}
                className={`w-full py-4 rounded-2xl font-bold text-lg font-mono tracking-wider transition shadow-2xl flex items-center justify-center gap-2 ${
                  redReady
                    ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-rose-600 to-purple-600 hover:from-rose-500 hover:to-purple-500 text-white shadow-rose-500/40 cursor-pointer animate-pulse'
                }`}
              >
                {redReady ? (
                  <>
                    <Check className="w-6 h-6" /> VOCÊ ESTÁ PRONTO! AGUARDANDO ADVERSÁRIO...
                  </>
                ) : (
                  <>
                    <Flame className="w-6 h-6" /> ESTOU PRONTO (ESTILO DRAFTER.LOL)
                  </>
                )}
              </button>
            )}

            {userRole === 'SPECTATOR' && (
              <div className="text-gray-400 font-mono text-sm py-2">
                👁️ Você está assistindo como espectador. O draft começará assim que ambos os capitães estiverem prontos.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Draft Screen Grid */}
      <div className="flex-1 grid grid-cols-12 gap-4 p-4 max-w-[1920px] mx-auto w-full">
        {/* ===================== TIME AZUL (Lado Esquerdo) ===================== */}
        <div className="col-span-3 flex flex-col gap-3">
          <div className="bg-sky-950/40 border border-sky-500/50 rounded-xl p-3 flex items-center justify-between shadow-lg shadow-sky-950/30">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400 font-mono">1º Escolha</span>
              <h2 className="font-bold text-2xl text-sky-100 tracking-wide font-mono">TIME AZUL</h2>
            </div>
            {currentStep?.team === 'BLUE' && (
              <span className="text-xs px-2.5 py-1 bg-sky-500/20 text-sky-300 border border-sky-400/50 rounded-full font-semibold animate-pulse">
                SUA VEZ
              </span>
            )}
            {isCompleted && (
              <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-300 border border-purple-400/30 rounded font-mono">
                🔄 Clique p/ Trocar
              </span>
            )}
          </div>

          {/* 5 Slots de Pick Azul */}
          <div className="flex flex-col gap-2.5 flex-1 justify-center">
            {LANES_ORDER.map((lane, idx) => {
              const pick = bluePicks[idx];
              const isCurrentActingSlot =
                !isCompleted &&
                currentStep?.team === 'BLUE' &&
                currentStep?.type === 'PICK' &&
                bluePicks.length === idx;

              const isSwapSelected =
                isCompleted &&
                swapSourceIndex?.team === 'BLUE' &&
                swapSourceIndex.index === idx;

              return (
                <div
                  key={idx}
                  onClick={() => handleSlotClickForSwap('BLUE', idx)}
                  className={`h-22 rounded-xl relative overflow-hidden border transition-all duration-300 flex items-center ${
                    isSwapSelected
                      ? 'border-yellow-400 ring-4 ring-yellow-400/60 bg-yellow-950/40 shadow-2xl scale-102 cursor-pointer'
                      : isCompleted && pick
                      ? 'border-sky-700/60 bg-sky-950/30 hover:border-yellow-400/80 cursor-pointer'
                      : isCurrentActingSlot
                      ? 'border-sky-400 ring-2 ring-sky-400/60 bg-sky-950/60 shadow-xl shadow-sky-500/20 animate-pulse'
                      : pick
                      ? 'border-sky-800/60 bg-sky-950/30'
                      : 'border-dashed border-gray-800/80 bg-[#0b0817]/40'
                  }`}
                >
                  {pick ? (
                    <>
                      <img
                        src={getSplashUrl(pick)}
                        alt={pick.name}
                        className="absolute inset-0 w-full h-full object-cover object-top opacity-65 filter contrast-125"
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-[#07050f]/95 via-[#07050f]/60 to-transparent"></div>

                      <div className="relative z-10 px-4 flex items-center justify-between w-full">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-lg border border-sky-400/50 overflow-hidden shadow">
                            <img
                              src={getAvatarUrl(pick)}
                              alt={pick.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="flex flex-col">
                            {/* Nome do Jogador (Estilo Competitivo) */}
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-sky-300 font-mono tracking-wider bg-sky-950/70 px-1.5 py-0.5 rounded border border-sky-500/30">
                                {bluePlayers[idx]}
                              </span>
                              <span className="text-[10px] text-gray-400 font-mono font-bold tracking-widest uppercase">
                                {lane}
                              </span>
                            </div>
                            {/* Nome do Campeão Escolhido */}
                            <span className="font-bold text-lg text-white uppercase tracking-wider font-mono drop-shadow-md">
                              {pick.name}
                            </span>
                          </div>
                        </div>

                        {isCompleted && (
                          <div className="text-gray-400 hover:text-yellow-400 transition p-1">
                            <ArrowRightLeft className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="px-5 text-gray-400 text-sm font-mono flex items-center justify-between w-full">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xs font-bold text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-600/30">
                          {bluePlayers[idx]}
                        </span>
                        <span className="text-xs font-bold text-gray-500">[{lane}]</span>
                        <span className="text-xs text-gray-500">{isCurrentActingSlot ? '⏳ ESCOLHENDO...' : ''}</span>
                      </div>
                      {isCurrentActingSlot && (
                        <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping"></span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 5 Bans Azul */}
          <div className="bg-[#0e0a21]/80 border border-purple-900/40 rounded-xl p-3">
            <span className="text-[11px] font-mono text-gray-400 uppercase tracking-widest block mb-2 font-bold">
              Bans Azul ({blueBans.length}/5)
            </span>
            <div className="flex gap-2.5">
              {[0, 1, 2, 3, 4].map((i) => {
                const ban = blueBans[i];
                const isCurrentBan =
                  !isCompleted &&
                  currentStep?.team === 'BLUE' &&
                  currentStep?.type === 'BAN' &&
                  blueBans.length === i;

                return (
                  <div
                    key={i}
                    className={`w-12 h-12 rounded-lg border transition-all overflow-hidden relative ${
                      isCurrentBan
                        ? 'border-red-500 ring-2 ring-red-500/50 bg-red-950/40 animate-pulse'
                        : ban
                        ? 'border-red-900/60 bg-black/60'
                        : 'border-dashed border-gray-800 bg-black/30'
                    }`}
                  >
                    {ban ? (
                      <>
                        <img
                          src={getAvatarUrl(ban)}
                          alt={ban.name}
                          className="w-full h-full object-cover filter grayscale contrast-150"
                        />
                        <div className="absolute inset-0 bg-red-950/60 flex items-center justify-center">
                          <div className="w-6 h-0.5 bg-red-500 rotate-45"></div>
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ===================== CENTRO: ARENA DE DRAFT ===================== */}
        <div className="col-span-6 flex flex-col gap-3">
          {/* Card Central de Turno e Timer */}
          <div className="bg-[#110c26]/90 border border-purple-800/40 rounded-2xl p-4 flex flex-col items-center justify-center relative overflow-hidden shadow-2xl">
            <div className="text-xs font-mono tracking-widest text-purple-400 uppercase mb-1">
              {isCompleted ? 'DRAFT FINALIZADO • FASE DE TROCA DE ROTAS' : currentStep?.stepName}
            </div>

            <div className="flex items-center gap-6">
              <div
                className={`text-6xl font-extrabold tabular-nums tracking-tighter font-mono ${
                  isFullyFinalized
                    ? 'text-emerald-400'
                    : isCompleted
                    ? 'text-amber-400 animate-pulse'
                    : timer <= 10
                    ? 'text-red-500 animate-bounce'
                    : currentStep?.team === 'BLUE'
                    ? 'text-sky-400'
                    : 'text-rose-400'
                }`}
              >
                {isFullyFinalized ? '✓' : isCompleted ? `${swapTimer}s` : `${timer}s`}
              </div>
            </div>

            <div className="mt-2 text-sm font-semibold flex items-center gap-2">
              {!isCompleted && currentStep ? (
                currentStep.type === 'BAN' ? (
                  <span className="text-red-400 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4" /> Vez do Time {currentStep.team === 'BLUE' ? 'Azul' : 'Vermelho'} BANIR
                  </span>
                ) : (
                  <span className="text-sky-300 flex items-center gap-1.5">
                    <Swords className="w-4 h-4" /> Vez do Time {currentStep.team === 'BLUE' ? 'Azul' : 'Vermelho'} ESCOLHER
                  </span>
                )
              ) : (
                <span className="text-yellow-400 flex items-center gap-1.5 font-mono text-xs">
                  <ArrowRightLeft className="w-4 h-4" /> Clique em dois campeões do mesmo time para trocar suas lanes!
                </span>
              )}
            </div>
          </div>

          {/* Filtros de Rota e Barra de Busca */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-3 w-4 h-4 text-purple-400" />
              <input
                type="text"
                placeholder="Buscar campeão pelo nome ou título (ex: Aurora, Mel, Ambessa)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#130d2a] border border-purple-900/60 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition shadow-inner"
              />
            </div>

            <div className="bg-[#130d2a] border border-purple-900/60 rounded-xl p-1 flex items-center gap-1">
              {(['ALL', 'TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const).map((lane) => (
                <button
                  key={lane}
                  onClick={() => setActiveLaneFilter(lane)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                    activeLaneFilter === lane
                      ? 'bg-purple-600 text-white shadow'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {lane}
                </button>
              ))}
            </div>
          </div>

          {/* Grid de Campeões Interativo */}
          <div className="flex-1 bg-[#0d091e]/80 border border-purple-900/40 rounded-2xl p-3 overflow-y-auto max-h-[440px] grid grid-cols-6 gap-2.5 shadow-inner custom-scrollbar">
            {loadingChamps ? (
              <div className="col-span-6 text-center py-20 text-gray-500 font-mono">
                Carregando campeões oficiais do Data Dragon...
              </div>
            ) : filteredChampions.length === 0 ? (
              <div className="col-span-6 text-center py-20 text-gray-500 font-mono">
                Nenhum campeão encontrado para essa busca.
              </div>
            ) : (
              filteredChampions.map((champ) => {
                const isSelected = selectedChampion?.id === champ.id;
                const isTaken = unavailableIds.has(champ.id);

                return (
                  <button
                    key={champ.id}
                    disabled={isTaken || !canUserAct}
                    onClick={() => setSelectedChampion(champ)}
                    className={`flex flex-col items-center p-1.5 rounded-xl border transition-all duration-150 group relative ${
                      isTaken
                        ? 'opacity-25 grayscale cursor-not-allowed border-transparent'
                        : isSelected
                        ? 'border-purple-400 bg-purple-900/50 ring-2 ring-purple-400 shadow-lg shadow-purple-600/40 scale-105'
                        : 'border-white/5 bg-black/20 hover:border-purple-500/50 hover:bg-purple-950/30 hover:scale-102'
                    }`}
                  >
                    <div className="w-14 h-14 rounded-lg overflow-hidden relative shadow bg-black/40">
                      <img
                        src={getAvatarUrl(champ)}
                        alt={champ.name}
                        className="w-full h-full object-cover group-hover:scale-110 transition duration-200"
                        loading="lazy"
                      />
                    </div>
                    <span className="text-[11px] font-semibold mt-1 truncate max-w-[75px] text-gray-200">
                      {champ.name}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Botão de Confirmação de Ação */}
          {!isCompleted && (
            <button
              onClick={handleConfirm}
              disabled={!selectedChampion || !canUserAct}
              className={`py-3.5 rounded-xl font-bold text-base tracking-wider uppercase transition shadow-xl font-mono flex items-center justify-center gap-2 ${
                selectedChampion && canUserAct
                  ? currentStep?.type === 'BAN'
                    ? 'bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white shadow-red-600/40 cursor-pointer animate-pulse'
                    : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-purple-600/40 cursor-pointer animate-pulse'
                  : 'bg-gray-900 text-gray-600 border border-gray-800 cursor-not-allowed'
              }`}
            >
              {selectedChampion ? (
                <>
                  <Check className="w-5 h-5" />
                  CONFIRMAR {currentStep?.type === 'BAN' ? 'BANIMENTO' : 'ESCOLHA'}: {selectedChampion.name}
                </>
              ) : (
                `SELECIONE UM CAMPEÃO PARA ${currentStep?.type === 'BAN' ? 'BANIR' : 'ESCOLHER'}`
              )}
            </button>
          )}

          {/* Card de Conclusão com Troca de Rotas */}
          {isCompleted && (
            <div className="bg-gradient-to-br from-purple-950/90 via-indigo-950/80 to-purple-950/90 border border-purple-500/50 rounded-2xl p-5 text-center shadow-2xl animate-fade-in">
              <Trophy className="w-8 h-8 text-yellow-400 mx-auto mb-1.5" />
              <h3 className="font-bold text-2xl text-white font-mono tracking-wider">
                DRAFT CONCLUÍDO!
              </h3>
              <p className="text-xs text-purple-200 mt-1 max-w-md mx-auto">
                <span className="text-yellow-400 font-bold">Fase de Troca de Rotas ativa:</span> Clique em qualquer campeão do time e depois no outro para trocar de lane livremente.
              </p>
              <div className="mt-3.5 flex items-center justify-center gap-3">
                <button
                  onClick={handleResetDraft}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl transition shadow-lg shadow-purple-600/40"
                >
                  Novo Draft / Reiniciar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ===================== TIME VERMELHO (Lado Direito) ===================== */}
        <div className="col-span-3 flex flex-col gap-3">
          <div className="bg-rose-950/40 border border-rose-500/50 rounded-xl p-3 flex items-center justify-between shadow-lg shadow-rose-950/30">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400 font-mono">2º Escolha</span>
              <h2 className="font-bold text-2xl text-rose-100 tracking-wide font-mono">TIME VERMELHO</h2>
            </div>
            {currentStep?.team === 'RED' && (
              <span className="text-xs px-2.5 py-1 bg-rose-500/20 text-rose-300 border border-rose-400/50 rounded-full font-semibold animate-pulse">
                SUA VEZ
              </span>
            )}
            {isCompleted && (
              <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-300 border border-purple-400/30 rounded font-mono">
                🔄 Clique p/ Trocar
              </span>
            )}
          </div>

          {/* 5 Slots de Pick Vermelho */}
          <div className="flex flex-col gap-2.5 flex-1 justify-center">
            {LANES_ORDER.map((lane, idx) => {
              const pick = redPicks[idx];
              const isCurrentActingSlot =
                !isCompleted &&
                currentStep?.team === 'RED' &&
                currentStep?.type === 'PICK' &&
                redPicks.length === idx;

              const isSwapSelected =
                isCompleted &&
                swapSourceIndex?.team === 'RED' &&
                swapSourceIndex.index === idx;

              return (
                <div
                  key={idx}
                  onClick={() => handleSlotClickForSwap('RED', idx)}
                  className={`h-22 rounded-xl relative overflow-hidden border transition-all duration-300 flex items-center justify-end ${
                    isSwapSelected
                      ? 'border-yellow-400 ring-4 ring-yellow-400/60 bg-yellow-950/40 shadow-2xl scale-102 cursor-pointer'
                      : isCompleted && pick
                      ? 'border-rose-700/60 bg-rose-950/30 hover:border-yellow-400/80 cursor-pointer'
                      : isCurrentActingSlot
                      ? 'border-rose-400 ring-2 ring-rose-400/60 bg-rose-950/60 shadow-xl shadow-rose-500/20 animate-pulse'
                      : pick
                      ? 'border-rose-800/60 bg-rose-950/30'
                      : 'border-dashed border-gray-800/80 bg-[#0b0817]/40'
                  }`}
                >
                  {pick ? (
                    <>
                      <img
                        src={getSplashUrl(pick)}
                        alt={pick.name}
                        className="absolute inset-0 w-full h-full object-cover object-top opacity-65 filter contrast-125"
                      />
                      <div className="absolute inset-0 bg-gradient-to-l from-[#07050f]/95 via-[#07050f]/60 to-transparent"></div>

                      <div className="relative z-10 px-4 flex items-center justify-between w-full flex-row-reverse text-right">
                        <div className="flex items-center gap-3 flex-row-reverse">
                          <div className="w-12 h-12 rounded-lg border border-rose-400/50 overflow-hidden shadow">
                            <img
                              src={getAvatarUrl(pick)}
                              alt={pick.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="flex flex-col items-end">
                            {/* Nome do Jogador (Estilo Competitivo) */}
                            <div className="flex items-center gap-2 flex-row-reverse">
                              <span className="text-xs font-bold text-rose-300 font-mono tracking-wider bg-rose-950/70 px-1.5 py-0.5 rounded border border-rose-500/30">
                                {redPlayers[idx]}
                              </span>
                              <span className="text-[10px] text-gray-400 font-mono font-bold tracking-widest uppercase">
                                {lane}
                              </span>
                            </div>
                            {/* Nome do Campeão Escolhido */}
                            <span className="font-bold text-lg text-white uppercase tracking-wider font-mono drop-shadow-md">
                              {pick.name}
                            </span>
                          </div>
                        </div>

                        {isCompleted && (
                          <div className="text-gray-400 hover:text-yellow-400 transition p-1">
                            <ArrowRightLeft className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="px-5 text-gray-400 text-sm font-mono flex items-center justify-between w-full flex-row-reverse">
                      <div className="flex items-center gap-2.5 flex-row-reverse">
                        <span className="text-xs font-bold text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-600/30">
                          {redPlayers[idx]}
                        </span>
                        <span className="text-xs font-bold text-gray-500">[{lane}]</span>
                        <span className="text-xs text-gray-500">{isCurrentActingSlot ? '⏳ ESCOLHENDO...' : ''}</span>
                      </div>
                      {isCurrentActingSlot && (
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-ping"></span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 5 Bans Vermelho */}
          <div className="bg-[#0e0a21]/80 border border-purple-900/40 rounded-xl p-3">
            <span className="text-[11px] font-mono text-gray-400 uppercase tracking-widest block mb-2 font-bold text-right">
              Bans Vermelho ({redBans.length}/5)
            </span>
            <div className="flex gap-2.5 justify-end">
              {[0, 1, 2, 3, 4].map((i) => {
                const ban = redBans[i];
                const isCurrentBan =
                  !isCompleted &&
                  currentStep?.team === 'RED' &&
                  currentStep?.type === 'BAN' &&
                  redBans.length === i;

                return (
                  <div
                    key={i}
                    className={`w-12 h-12 rounded-lg border transition-all overflow-hidden relative ${
                      isCurrentBan
                        ? 'border-red-500 ring-2 ring-red-500/50 bg-red-950/40 animate-pulse'
                        : ban
                        ? 'border-red-900/60 bg-black/60'
                        : 'border-dashed border-gray-800 bg-black/30'
                    }`}
                  >
                    {ban ? (
                      <>
                        <img
                          src={getAvatarUrl(ban)}
                          alt={ban.name}
                          className="w-full h-full object-cover filter grayscale contrast-150"
                        />
                        <div className="absolute inset-0 bg-red-950/60 flex items-center justify-center">
                          <div className="w-6 h-0.5 bg-red-500 rotate-45"></div>
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
