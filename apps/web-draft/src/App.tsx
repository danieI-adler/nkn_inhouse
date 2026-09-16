import { useState, useEffect, useMemo } from 'react';
import {
  Search,
  ShieldAlert,
  Swords,
  Plus,
  RotateCcw,
  Trophy,
  Check,
  ArrowRightLeft,
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
  const [timer, setTimer] = useState(30);
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
    'NKN Ghost',
    'NKN Blaze',
    'NKN Frost',
  ]);

  // Troca de Rotas (Swap Lanes) no final
  const [swapSourceIndex, setSwapSourceIndex] = useState<{ team: TeamSide; index: number } | null>(null);

  // Prorrogação
  const [blueHasExtra, setBlueHasExtra] = useState(true);
  const [redHasExtra, setRedHasExtra] = useState(true);

  // Modo de controle: 'SOLO_SIMULATOR', 'BLUE_ONLY', 'RED_ONLY'
  const [controlMode, setControlMode] = useState<'SOLO_SIMULATOR' | 'BLUE_ONLY' | 'RED_ONLY'>('SOLO_SIMULATOR');

  const isCompleted = stepIndex >= DRAFT_SEQUENCE.length;
  const currentStep = isCompleted ? null : DRAFT_SEQUENCE[stepIndex];

  // Sincronização via Socket.io com o Backend da Inhouse (jogadores reais do Discord)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const pathParts = window.location.pathname.split('/');
    const matchId = pathParts[2] || urlParams.get('matchId') || '';
    const token = urlParams.get('token') || '';

    if (!matchId) return;

    const apiUrl =
      import.meta.env.VITE_API_URL ||
      (window.location.hostname.includes('github.io')
        ? 'https://nkn-inhouse-service.onrender.com'
        : 'http://localhost:3001');

    import('socket.io-client').then(({ io }) => {
      const socket = io(apiUrl);
      socket.emit('join_draft', { matchId, token });

      socket.on('draft_init', (data: any) => {
        if (data.state?.blueSlots && data.state.blueSlots.length === 5) {
          setBluePlayers(data.state.blueSlots.map((s: any) => s.discordTag || s.riotId));
        }
        if (data.state?.redSlots && data.state.redSlots.length === 5) {
          setRedPlayers(data.state.redSlots.map((s: any) => s.discordTag || s.riotId));
        }
      });
    });
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

  // 2. Timer decrescente de 30s
  useEffect(() => {
    if (isCompleted || isPaused) return;

    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          handleAutoSelect();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [stepIndex, isCompleted, isPaused, champions]);

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

  // Executa Ban ou Pick
  const executeAction = (champ: ChampionData) => {
    if (!currentStep || isCompleted) return;

    if (currentStep.type === 'BAN') {
      if (currentStep.team === 'BLUE') setBlueBans((prev) => [...prev, champ]);
      else setRedBans((prev) => [...prev, champ]);
    } else {
      if (currentStep.team === 'BLUE') setBluePicks((prev) => [...prev, champ]);
      else setRedPicks((prev) => [...prev, champ]);
    }

    setSelectedChampion(null);
    setTimer(30);
    setStepIndex((prev) => prev + 1);
  };

  const handleConfirm = () => {
    if (!selectedChampion || !currentStep) return;
    executeAction(selectedChampion);
  };

  const handleExtraTime = () => {
    if (!currentStep) return;
    if (currentStep.team === 'BLUE' && blueHasExtra) {
      setBlueHasExtra(false);
      setTimer((t) => t + 15);
    } else if (currentStep.team === 'RED' && redHasExtra) {
      setRedHasExtra(false);
      setTimer((t) => t + 15);
    }
  };

  const handleResetDraft = () => {
    setStepIndex(0);
    setTimer(30);
    setSelectedChampion(null);
    setBlueBans([]);
    setRedBans([]);
    setBluePicks([]);
    setRedPicks([]);
    setBlueHasExtra(true);
    setRedHasExtra(true);
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
    if (isCompleted || !currentStep) return false;
    if (controlMode === 'SOLO_SIMULATOR') return true;
    if (controlMode === 'BLUE_ONLY' && currentStep.team === 'BLUE') return true;
    if (controlMode === 'RED_ONLY' && currentStep.team === 'RED') return true;
    return false;
  }, [controlMode, currentStep, isCompleted]);

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

        {/* Controles de Simulação */}
        <div className="flex items-center gap-3">
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
        </div>
      </header>

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
                  isCompleted
                    ? 'text-emerald-400'
                    : timer <= 10
                    ? 'text-red-500 animate-bounce'
                    : currentStep?.team === 'BLUE'
                    ? 'text-sky-400'
                    : 'text-rose-400'
                }`}
              >
                {isCompleted ? '✓' : `${timer}s`}
              </div>

              {!isCompleted && (
                <button
                  onClick={handleExtraTime}
                  disabled={
                    (currentStep?.team === 'BLUE' && !blueHasExtra) ||
                    (currentStep?.team === 'RED' && !redHasExtra)
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/30 border border-purple-500/40 hover:bg-purple-600/50 disabled:opacity-30 disabled:cursor-not-allowed text-purple-200 text-xs font-semibold transition"
                >
                  <Plus className="w-3.5 h-3.5" /> +15s Extra
                </button>
              )}
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
