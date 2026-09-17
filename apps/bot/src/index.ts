import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChatInputCommandInteraction,
  ButtonInteraction,
  Guild,
  AttachmentBuilder,
} from 'discord.js';
import { io as createSocketClient } from 'socket.io-client';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { GameMode, Lane } from '@nkn/shared';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

// Mapeamento de partida para o canal de texto do Discord
const matchTextChannels = new Map<string, string>();

// Estrutura de Fila Geral (Auto MMR e Rotas via /rotas)
export interface QueuedPlayer {
  userId: string;
  tag: string;
  displayName?: string;
  riotName?: string;
  riotTag?: string;
  lanes: string[];
}

const generalQueue: QueuedPlayer[] = [];
let currentQueueMode: GameMode = 'RANKED_AUTO';

let permanentQueueChannelId: string | null = null;
let permanentQueueMessageId: string | null = null;
let cachedBannerAttachmentUrl: string | null = null;
let activeMatchesCount = 0;

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once('ready', () => {
  console.log(`🥷 Nukenin Inhouse Bot online como ${client.user?.tag}`);

  // Recupera configurações de fila permanente e modo salvas
  (async () => {
    try {
      const sRes = await fetch(`${API_BASE_URL}/api/settings`);
      const sData = await sRes.json();
      if (sData.settings) {
        if (sData.settings.queueChannelId) {
          permanentQueueChannelId = sData.settings.queueChannelId;
          permanentQueueMessageId = sData.settings.queueMessageId || null;
          console.log(`📌 Canal de fila permanente carregado: ${permanentQueueChannelId}, Msg: ${permanentQueueMessageId}`);
        }
        if (sData.settings.queueMode) {
          currentQueueMode = sData.settings.queueMode;
          console.log(`🎮 Modo de fila carregado: ${currentQueueMode}`);
        }
      }

      // Hardcode / Auto-preenchimento temporário para testes:
      // Coloca automaticamente todos os jogadores vinculados na fila
      const lRes = await fetch(`${API_BASE_URL}/api/leaderboard`);
      const lData = await lRes.json();
      if (lData.leaderboard && Array.isArray(lData.leaderboard)) {
        for (const p of lData.leaderboard) {
          if (!generalQueue.some((q) => q.userId === p.discordId)) {
            generalQueue.push({
              userId: p.discordId,
              tag: p.discordTag || p.riotGameName || 'Player',
              riotName: p.riotGameName,
              riotTag: p.riotTagLine,
              lanes: p.registeredLanes && p.registeredLanes.length > 0 ? p.registeredLanes : ['FILL'],
            });
          }
        }
        console.log(`🎯 [Auto-Fila Teste] ${generalQueue.length} jogadores vinculados inseridos na fila.`);
      }

      // Atualiza o painel permanente no Discord com a lista populada
      if (process.env.GUILD_ID) {
        const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
        if (guild) {
          await updatePermanentQueueMessage(guild);
        }
      }
    } catch (e) {
      console.warn('Não foi possível carregar configurações de fila permanente na inicialização:', e);
    }
  })();

  // Conecta ao Socket.io da API para escutar término do draft
  try {
    const socket = createSocketClient(API_BASE_URL);
    socket.on('connect', () => {
      console.log('📡 Bot conectado ao WebSocket da API Nukenin!');
    });

    socket.on('draft_completed_broadcast', async ({ matchId }: { matchId: string }) => {
      console.log(`📸 Draft finalizado para a partida #${matchId}! Gerando e enviando print do draft...`);
      const channelId = matchTextChannels.get(matchId);
      if (!channelId) return;

      try {
        const channel = await client.channels.fetch(channelId);
        if (channel && channel.isTextBased() && 'send' in channel) {
          // Aguarda 1 segundo para garantir que o estado final do draft foi consolidado
          setTimeout(async () => {
            try {
              const cardRes = await fetch(`${API_BASE_URL}/api/matches/${matchId}/card`);
              if (cardRes.ok) {
                const arrayBuf = await cardRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuf);
                const attachment = new AttachmentBuilder(buffer, { name: `draft-final-${matchId}.png` });

                const embed = new EmbedBuilder()
                  .setTitle(`✅ DRAFT FINALIZADO - #${matchId.toUpperCase()}`)
                  .setDescription(
                    `O draft da partida terminou! As escolhas e bans foram definidos.\n` +
                    `🎮 Entrem na sala personalizada do LoL e iniciem a partida!`
                  )
                  .setColor('#10b981')
                  .setImage(`attachment://draft-final-${matchId}.png`)
                  .setFooter({ text: 'Inhouse Nukenin • Use /resultado ao finalizar o jogo' });

                await (channel as any).send({ embeds: [embed], files: [attachment] });
              }
            } catch (cardErr) {
              console.error('Erro ao enviar card final do draft:', cardErr);
            }
          }, 1200);
        }
      } catch (err) {
        console.error('Erro ao processar envio do print do draft:', err);
      }
    });
  } catch (socketErr) {
    console.error('Erro ao inicializar conexão socket do bot:', socketErr);
  }
});

// Comandos e Interações de Fila
client.on('interactionCreate', async (interaction) => {
  console.log(`[Discord Bot] Interação recebida: tipo=${interaction.type}, usuario=${interaction.user.tag}`);
  if (interaction.isButton()) {
    console.log(`[Discord Bot] Botão clicado: ${interaction.customId}`);
    handleButtonQueue(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  console.log(`[Discord Bot] Comando de barra executado: /${commandName}`);

  if (commandName === 'vincular') {
    const riotId = interaction.options.getString('riot_id', true);
    const [gameName, tagLine] = riotId.split('#');

    if (!gameName || !tagLine) {
      await interaction.reply({
        content: '❌ Formato inválido! Envie no formato `Nome#Tag` (Ex: `Faker#BR1`).',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const res = await fetch(`${API_BASE_URL}/api/players/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discordId: interaction.user.id,
          discordTag: interaction.user.tag,
          gameName,
          tagLine,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        await interaction.editReply(`❌ Erro ao vincular: ${data.message || 'Conta não encontrada.'}`);
        return;
      }

      await interaction.editReply(
        `✅ Conta **${data.profile.riotGameName}#${data.profile.riotTagLine}** vinculada com sucesso!\n` +
        `🏆 Elo SoloQ: **${data.profile.riotRankTier} ${data.profile.riotRankDivision}** (${data.profile.riotLp} LP)\n` +
        `⚡ MMR Inicial: **${data.profile.internalMmr}**`
      );
    } catch (err: any) {
      await interaction.editReply(`❌ Falha de comunicação com o backend: ${err.message}`);
    }
  }

  if (commandName === 'rotas') {
    const rawLanes = interaction.options.getString('rotas', true).toUpperCase();
    const lanes = rawLanes.split(',').map((l) => l.trim()) as Lane[];

    if (lanes.includes('FILL') && lanes.length > 1) {
      await interaction.reply({ content: '⚠️ Ao selecionar "FILL", selecione apenas ele.', ephemeral: true });
      return;
    }

    if (!lanes.includes('FILL') && (lanes.length < 2 || lanes.length > 4)) {
      await interaction.reply({
        content: '⚠️ Você deve escolher entre 2 e 4 rotas (ex: `TOP, MID`) ou apenas `FILL`.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const res = await fetch(`${API_BASE_URL}/api/players/lanes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId: interaction.user.id, lanes }),
      });

      const data = await res.json();
      if (!res.ok) {
        await interaction.editReply(`❌ Erro ao salvar rotas: ${data.message}`);
        return;
      }

      // Atualiza cargos no servidor
      await syncLaneRoles(interaction.guild!, interaction.user.id, lanes);

      await interaction.editReply(`✅ Rotas atualizadas com sucesso: **${lanes.join(', ')}**`);
    } catch (err: any) {
      await interaction.editReply(`❌ Falha ao salvar rotas: ${err.message}`);
    }
  }

  if (commandName === 'setup-fila') {
    await interaction.deferReply({ ephemeral: true });

    const targetChannel = (interaction.options.getChannel('canal') as any) || interaction.channel;
    if (!targetChannel || !targetChannel.isTextBased() || !('send' in targetChannel)) {
      await interaction.editReply('⚠️ Canal inválido para postar a fila.');
      return;
    }

    const selectedModo = interaction.options.getString('modo') as GameMode | null;
    if (selectedModo) {
      currentQueueMode = selectedModo;
      await fetch(`${API_BASE_URL}/api/settings/queue-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: selectedModo }),
      }).catch((e) => console.warn('Falha ao sincronizar queue-mode:', e));
    }

    try {
      const payload = await buildQueueEmbedAndButtons();
      const message = await targetChannel.send(payload);
      permanentQueueChannelId = targetChannel.id;
      permanentQueueMessageId = message.id;

      if (message.attachments.size > 0) {
        cachedBannerAttachmentUrl = message.attachments.first()?.url || null;
      }

      // Salva no banco de dados Supabase para persistência contínua
      await fetch(`${API_BASE_URL}/api/settings/queue-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: targetChannel.id, messageId: message.id }),
      });

      await interaction.editReply(`✅ Painel oficial permanente da Fila NKN fixado com sucesso em <#${targetChannel.id}>! Modo: **${currentQueueMode}**`);
    } catch (e: any) {
      await interaction.editReply(`❌ Erro ao configurar painel de fila: ${e.message}`);
    }
  }

  if (commandName === 'set-modo') {
    await interaction.deferReply({ ephemeral: true });
    const selectedModo = interaction.options.getString('modo', true) as GameMode;
    currentQueueMode = selectedModo;

    try {
      await fetch(`${API_BASE_URL}/api/settings/queue-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: selectedModo }),
      });

      if (interaction.guild) {
        await updatePermanentQueueMessage(interaction.guild);
      }

      const modeLabels: Record<GameMode, string> = {
        RANKED_AUTO: 'Ranked Competitiva (Auto MMR)',
        RANKED_CAPTAIN: 'Capitães (Draft com Capitães)',
        CASUAL_ARAM_ZOACAO: 'ARAM / Zoação (Casual)',
      };

      await interaction.editReply(`🎮 Modo da fila alterado para: **${modeLabels[selectedModo] || selectedModo}**! O painel permanente foi atualizado.`);
    } catch (e: any) {
      await interaction.editReply(`❌ Erro ao alterar modo da fila: ${e.message}`);
    }
  }

  if (commandName === 'painel-fila') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const payload = await buildQueueEmbedAndButtons();
      const message = await (interaction.channel as any).send(payload);
      permanentQueueChannelId = interaction.channelId;
      permanentQueueMessageId = message.id;

      if (message.attachments.size > 0) {
        cachedBannerAttachmentUrl = message.attachments.first()?.url || null;
      }

      await fetch(`${API_BASE_URL}/api/settings/queue-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: interaction.channelId, messageId: message.id }),
      });

      await interaction.editReply('✅ Painel oficial da fila enviado e configurado!');
    } catch (e: any) {
      await interaction.editReply(`❌ Erro: ${e.message}`);
    }
  }

  if (commandName === 'set-waiting-room') {
    const channel = interaction.options.getChannel('canal_voz', true);
    if (channel.type !== ChannelType.GuildVoice) {
      await interaction.reply({ content: '⚠️ Por favor, selecione um canal de voz válido.', ephemeral: true });
      return;
    }

    try {
      await fetch(`${API_BASE_URL}/api/settings/waiting-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waitingRoomVoiceId: channel.id }),
      });

      await interaction.reply({ content: `✅ Sala de espera definida para: **${channel.name}**!`, ephemeral: true });
    } catch (e: any) {
      await interaction.reply({ content: `❌ Erro ao salvar: ${e.message}`, ephemeral: true });
    }
  }

  if (commandName === 'ranking') {
    await interaction.deferReply();

    try {
      const res = await fetch(`${API_BASE_URL}/api/leaderboard`);
      const data = await res.json();

      if (!res.ok || !data.leaderboard || data.leaderboard.length === 0) {
        await interaction.editReply('📊 Nenhum jogador registrado no ranking até o momento.');
        return;
      }

      const medals = ['🥇', '🥈', '🥉'];
      const rows = data.leaderboard.map((p: any, idx: number) => {
        const medal = idx < 3 ? medals[idx] : `\`#${idx + 1}\``;
        const totalGames = p.matchesPlayed || 0;
        const winrate = totalGames > 0 ? Math.round((p.wins / totalGames) * 100) : 0;
        return `${medal} **${p.riotGameName}#${p.riotTagLine}** (<@${p.discordId}>)\n` +
               `⚡ MMR: **${p.internalMmr}** | V: **${p.wins}** D: **${p.losses}** (${winrate}% WR) | Rotas: \`${p.registeredLanes.join(', ')}\``;
      });

      const embed = new EmbedBuilder()
        .setTitle('🏆 LEADERBOARD - COMUNIDADE NUKENIN')
        .setDescription(rows.join('\n\n'))
        .setColor('#eab308')
        .setFooter({ text: 'Ranking oficial baseado em MMR interno Nukenin' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply(`❌ Erro ao consultar ranking: ${err.message}`);
    }
  }

  if (commandName === 'perfil') {
    const targetUser = interaction.options.getUser('usuario') || interaction.user;
    await interaction.deferReply();

    try {
      const res = await fetch(`${API_BASE_URL}/api/players/${targetUser.id}`);
      const data = await res.json();

      if (!res.ok || !data.success || !data.profile) {
        await interaction.editReply(`❌ O usuário <@${targetUser.id}> ainda não vinculou sua conta Riot (use \`/vincular\`).`);
        return;
      }

      const p = data.profile;
      const totalGames = p.matchesPlayed || 0;
      const winrate = totalGames > 0 ? Math.round((p.wins / totalGames) * 100) : 0;
      const opggUrl = `https://www.op.gg/summoners/br/${encodeURIComponent(p.riotGameName)}-${encodeURIComponent(p.riotTagLine)}`;

      let champsText = 'Sem dados de maestria disponíveis.';
      if (p.topChampions && p.topChampions.length > 0) {
        champsText = p.topChampions
          .map(
            (c: any, i: number) =>
              `${i + 1}. **${c.name}** • Maestria Lv ${c.level} • \`${c.points.toLocaleString('pt-BR')} pts\``
          )
          .join('\n');
      }

      const embed = new EmbedBuilder()
        .setTitle(`🥷 Perfil Inhouse • ${p.riotGameName}#${p.riotTagLine}`)
        .setDescription(`Informações de invocador e desempenho competitivo de <@${targetUser.id}>`)
        .setThumbnail(targetUser.displayAvatarURL())
        .setColor('#7c3aed')
        .addFields(
          {
            name: '🏆 Elo SoloQ (LoL)',
            value: `**${p.riotRankTier} ${p.riotRankDivision}** (${p.riotLp} LP)`,
            inline: true,
          },
          {
            name: '⚡ MMR Inhouse',
            value: `**${p.internalMmr}**`,
            inline: true,
          },
          {
            name: '🎯 Rotas Principais',
            value: `\`${p.registeredLanes?.join(', ') || 'FILL'}\``,
            inline: true,
          },
          {
            name: '📊 Estatísticas Inhouse',
            value: `**${totalGames}** jogos • **${p.wins}**V / **${p.losses}**D (${winrate}% WR)`,
            inline: true,
          },
          {
            name: '🔗 Links Externos',
            value: `[Ver Perfil no OP.GG](${opggUrl})`,
            inline: true,
          },
          {
            name: '⭐ Campeões Mais Jogados (Maestria)',
            value: champsText,
            inline: false,
          }
        )
        .setFooter({ text: 'Nukenin League • Dados integrados via Riot Games API' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply(`❌ Falha ao buscar perfil: ${err.message}`);
    }
  }

  if (commandName === 'resultado') {
    const matchId = interaction.options.getString('partida_id', true);
    const winner = interaction.options.getString('vencedor', true).toUpperCase() as 'BLUE' | 'RED';

    await interaction.deferReply();

    try {
      const res = await fetch(`${API_BASE_URL}/api/matches/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, winner }),
      });

      const data = await res.json();
      if (!res.ok) {
        await interaction.editReply(`❌ Erro ao registrar resultado: ${data.message}`);
        return;
      }

      await interaction.editReply(
        `🏆 **Partida #${matchId} Concluída!**\nVencedor: **Time ${winner === 'BLUE' ? 'Azul' : 'Vermelho'}**.\n` +
        `O MMR dos participantes foi recalculado no banco de dados.\n` +
        `🔄 Movendo jogadores de volta para a sala de espera e agendando limpeza dos canais...`
      );

      // Auto-move dos jogadores de volta para a waiting room e limpeza de canais
      if (activeMatchesCount > 0) activeMatchesCount--;
      await updatePermanentQueueMessage(interaction.guild!);
      await cleanupMatchChannelsAndReturnPlayers(interaction.guild!, matchId);
    } catch (err: any) {
      await interaction.editReply(`❌ Falha: ${err.message}`);
    }
  }

  if (commandName === 'cancelar-partida') {
    const matchId = interaction.options.getString('partida_id', true);
    await interaction.deferReply({ ephemeral: true });

    try {
      if (activeMatchesCount > 0) activeMatchesCount--;
      if (interaction.guild) {
        await updatePermanentQueueMessage(interaction.guild);
        await cleanupMatchChannelsAndReturnPlayers(interaction.guild, matchId, true);
      }
      await interaction.editReply(`🛑 Partida **#${matchId.toUpperCase()}** cancelada com sucesso! As salas foram excluídas imediatamente.`);
    } catch (err: any) {
      await interaction.editReply(`❌ Erro ao cancelar partida: ${err.message}`);
    }
  }

  if (commandName === 'test-partida') {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Busca os jogadores vinculados do banco para simular a partida
      const lRes = await fetch(`${API_BASE_URL}/api/leaderboard`);
      const lData = await lRes.json();
      const players = lData.leaderboard || [];

      if (players.length < 1) {
        await interaction.editReply('❌ Nenhum jogador vinculado encontrado no banco para teste.');
        return;
      }

      // Preenche os 10 slots com os jogadores disponíveis (garantindo que o chamador faça parte)
      const callerId = interaction.user.id;
      const testPlayerIds: string[] = [callerId];

      for (const p of players) {
        if (testPlayerIds.length >= 10) break;
        if (!testPlayerIds.includes(p.discordId)) {
          testPlayerIds.push(p.discordId);
        }
      }

      // Se ainda faltar jogadores para 10, preenche com duplicatas controladas para a API aceitar
      let mockIdx = 1;
      while (testPlayerIds.length < 10) {
        const fallbackId = players[mockIdx % players.length]?.discordId || callerId;
        testPlayerIds.push(fallbackId);
        mockIdx++;
      }

      if (interaction.guild) {
        await createMatchRoom(interaction.guild, testPlayerIds, currentQueueMode);
        await interaction.editReply(`🎮 **Partida de Teste Criada!** Confira a nova categoria e canais criados no servidor.`);
      }
    } catch (err: any) {
      await interaction.editReply(`❌ Erro ao disparar partida de teste: ${err.message}`);
    }
  }
});

async function handleButtonQueue(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const customId = interaction.customId;

  // 1. Botão Sair da Fila
  if (customId === 'queue_leave') {
    await interaction.deferReply({ ephemeral: true });
    const idx = generalQueue.findIndex((p) => p.userId === userId);
    if (idx !== -1) {
      generalQueue.splice(idx, 1);
      await interaction.editReply({ content: '🚪 Você saiu da fila.' });
      await updatePermanentQueueMessage(interaction.guild!);
    } else {
      await interaction.editReply({ content: '⚠️ Você não está na fila.' });
    }
    return;
  }

  // 2. Botão Lista de Jogadores na Fila
  if (customId === 'queue_players') {
    await interaction.deferReply({ ephemeral: true });
    if (generalQueue.length === 0) {
      await interaction.editReply({ content: '📊 A fila está vazia no momento.' });
      return;
    }

    const lines = generalQueue.map(
      (p, i) => `${i + 1}. <@${p.userId}> (**${p.displayName || p.riotName || p.tag}**) • \`${p.riotName ? `${p.riotName}#${p.riotTag}` : p.tag}\` • Rotas: \`${p.lanes.join(', ')}\``
    );

    await interaction.editReply({
      content: `👥 **Jogadores na Fila (${generalQueue.length}/10):**\n${lines.join('\n')}`,
    });
    return;
  }

  // 3. Botão Entrar na Fila
  if (customId === 'queue_enter') {
    await interaction.deferReply({ ephemeral: true });
    try {
      // Verifica se o jogador tem conta vinculada
      const profileRes = await fetch(`${API_BASE_URL}/api/players/${userId}`);
      if (!profileRes.ok) {
        await interaction.editReply({
          content: '❌ Você precisa vincular seu Riot ID antes de entrar na fila! Use `/vincular`.',
        });
        return;
      }

      const profileData = await profileRes.json();
      const profile = profileData.profile;

      // Verifica se tem rotas definidas
      const registeredLanes: string[] = profile?.registeredLanes || [];
      if (registeredLanes.length === 0) {
        await interaction.editReply({
          content: '⚠️ Você precisa definir suas preferências de rotas antes de entrar na fila! Use `/rotas` (Ex: `/rotas rotas:TOP, MID`).',
        });
        return;
      }

      // Verifica se já está na fila
      if (generalQueue.some((p) => p.userId === userId)) {
        await interaction.editReply({
          content: '⚠️ Você já está na fila! Aguarde os outros jogadores entrarem.',
        });
        return;
      }

      // Obtém o apelido (displayName) no servidor
      const guildMember = interaction.guild ? await interaction.guild.members.fetch(userId).catch(() => null) : null;
      const displayName = guildMember?.displayName || profile?.riotGameName || interaction.user.displayName || interaction.user.tag;

      // Adiciona na fila geral
      generalQueue.push({
        userId,
        tag: interaction.user.tag,
        displayName,
        riotName: profile?.riotGameName,
        riotTag: profile?.riotTagLine,
        lanes: registeredLanes,
      });

      await interaction.editReply({
        content: `🎯 Você entrou na fila! Rotas configuradas: **${registeredLanes.join(', ')}** (${generalQueue.length}/10)`,
      });

      // Atualiza o painel da fila em tempo real
      await updatePermanentQueueMessage(interaction.guild!);

      // Se atingiu 10 jogadores, fecha a fila e inicia a partida com balanceamento MMR e atribuição de rotas
      if (generalQueue.length >= 10) {
        const matchPlayers: string[] = [];
        for (let i = 0; i < 10; i++) {
          const p = generalQueue.shift();
          if (p) matchPlayers.push(p.userId);
        }

        await updatePermanentQueueMessage(interaction.guild!);
        await createMatchRoom(interaction.guild!, matchPlayers, currentQueueMode);
      }
    } catch (err: any) {
      await interaction.editReply({ content: `❌ Erro ao entrar na fila: ${err.message}` });
    }
  }
}

async function createMatchRoom(guild: Guild, playerIds: string[], mode: GameMode) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerIds, mode }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Erro ao criar partida:', data);
      return;
    }

    activeMatchesCount++;
    await updatePermanentQueueMessage(guild);

    const match = data.match;
    const matchId = match.id;

    // Cria canais de texto e voz dinâmicos
    const everyoneRole = guild.roles.everyone;
    const category = await guild.channels.create({
      name: `🎮 INHOUSE #${matchId.toUpperCase()}`,
      type: ChannelType.GuildCategory,
    });

    const uniquePlayerIds = Array.from(new Set(playerIds));
    const permissionOverwrites: any[] = [
      { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
    ];

    for (const pid of uniquePlayerIds) {
      permissionOverwrites.push({
        id: pid,
        type: 1, // 1 = Member (OverwriteType.Member)
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      });
    }

    const textChannel = await guild.channels.create({
      name: `〔💬〕lobby-${matchId}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites,
    });

    matchTextChannels.set(matchId, textChannel.id);

    const blueVoice = await guild.channels.create({
      name: `🔊 Time Azul - #${matchId}`,
      type: ChannelType.GuildVoice,
      parent: category.id,
    });

    const redVoice = await guild.channels.create({
      name: `🔊 Time Vermelho - #${matchId}`,
      type: ChannelType.GuildVoice,
      parent: category.id,
    });

    // Busca os apelidos (display names) do servidor para os jogadores da partida
    const blueTeamWithNicknames = await Promise.all(
      match.blueTeam.map(async (s: any) => {
        const member = await guild.members.fetch(s.player.discordId).catch(() => null);
        const displayName = member?.displayName || s.player.riotGameName || s.player.discordTag;
        return { ...s, displayName };
      })
    );

    const redTeamWithNicknames = await Promise.all(
      match.redTeam.map(async (s: any) => {
        const member = await guild.members.fetch(s.player.discordId).catch(() => null);
        const displayName = member?.displayName || s.player.riotGameName || s.player.discordTag;
        return { ...s, displayName };
      })
    );

    // Gera link OP.GG Multi-search formatado corretamente sem quebras em espaços
    const blueSummoners = match.blueTeam
      .map((s: any) => encodeURIComponent(`${s.player.riotGameName}#${s.player.riotTagLine}`))
      .join(',');
    const redSummoners = match.redTeam
      .map((s: any) => encodeURIComponent(`${s.player.riotGameName}#${s.player.riotTagLine}`))
      .join(',');
    const blueOpgg = `https://www.op.gg/multisearch/br?summoners=${blueSummoners}`;
    const redOpgg = `https://www.op.gg/multisearch/br?summoners=${redSummoners}`;

    const draftBase = (process.env.WEB_DRAFT_URL || 'http://localhost:5173').replace(/\/+$/, '');
    const blueCaptainLink = `${draftBase}/#/draft/${matchId}?token=${match.blueCaptainToken}`;
    const redCaptainLink = `${draftBase}/#/draft/${matchId}?token=${match.redCaptainToken}`;
    const spectatorLink = `${draftBase}/#/draft/${matchId}?token=${match.spectatorToken}`;

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ Partida Formada - #${matchId.toUpperCase()}`)
      .setDescription(
        `**Sala no LoL**: \`${match.roomName}\` | **Senha**: \`${match.roomPassword}\`\n\n` +
        `**🔵 Time Azul:**\n` +
        blueTeamWithNicknames
          .map((s: any) => `<@${s.player.discordId}> (**${s.displayName}**) • \`${s.assignedLane}\` • ${s.player.riotGameName}#${s.player.riotTagLine}`)
          .join('\n') +
        `\n📊 [OP.GG Time Azul](${blueOpgg})\n\n` +
        `**🔴 Time Vermelho:**\n` +
        redTeamWithNicknames
          .map((s: any) => `<@${s.player.discordId}> (**${s.displayName}**) • \`${s.assignedLane}\` • ${s.player.riotGameName}#${s.player.riotTagLine}`)
          .join('\n') +
        `\n📊 [OP.GG Time Vermelho](${redOpgg})\n\n` +
        `**Links do Draft:**\n` +
        `🔵 [Entrar como Capitão Azul](${blueCaptainLink})\n` +
        `🔴 [Entrar como Capitão Vermelho](${redCaptainLink})\n` +
        `👁️ [Assistir como Espectador](${spectatorLink})`
      )
      .setColor('#38bdf8');

    await textChannel.send({ embeds: [embed] });

    // Move os jogadores para os respectivos canais de voz
    for (const slot of match.blueTeam) {
      try {
        const member = await guild.members.fetch(slot.player.discordId);
        if (member.voice.channel) {
          await member.voice.setChannel(blueVoice);
        }
      } catch (err) {
        // Ignora se não estiver em canal de voz
      }
    }

    for (const slot of match.redTeam) {
      try {
        const member = await guild.members.fetch(slot.player.discordId);
        if (member.voice.channel) {
          await member.voice.setChannel(redVoice);
        }
      } catch (err) {
        // Ignora se não estiver em canal de voz
      }
    }
  } catch (err) {
    console.error('Erro ao instanciar sala da partida:', err);
  }
}

async function syncLaneRoles(guild: Guild, memberId: string, lanes: Lane[]) {
  const member = await guild.members.fetch(memberId).catch(() => null);
  if (!member) return;

  const rolePrefix = 'Rota: ';
  for (const lane of ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as Lane[]) {
    const roleName = `${rolePrefix}${lane}`;
    let role = guild.roles.cache.find((r) => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) {
      role = await guild.roles.create({ name: roleName, color: '#3b82f6', reason: 'Role de Inhouse Lane' });
    }

    if (lanes.includes(lane) || lanes.includes('FILL')) {
      if (!member.roles.cache.has(role.id)) await member.roles.add(role);
    } else {
      if (member.roles.cache.has(role.id)) await member.roles.remove(role);
    }
  }
}

// Limpa canais e retorna jogadores para a sala de espera após o término da partida
async function cleanupMatchChannelsAndReturnPlayers(guild: Guild, matchId: string, immediate = false) {
  try {
    const cleanMatchId = matchId.replace(/^#/, '');

    // 1. Busca a sala de espera configurada
    const res = await fetch(`${API_BASE_URL}/api/settings`);
    const data = await res.json();
    const waitingRoomId = data.settings?.waitingRoomVoiceId;

    // 2. Localiza os canais de voz da partida
    const blueVoice = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildVoice && c.name.toLowerCase().includes(`azul - #${cleanMatchId.toLowerCase()}`)
    );
    const redVoice = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildVoice && c.name.toLowerCase().includes(`vermelho - #${cleanMatchId.toLowerCase()}`)
    );

    // 3. Move jogadores de volta para a waiting room
    if (waitingRoomId) {
      const waitingRoom = await guild.channels.fetch(waitingRoomId).catch(() => null);
      if (waitingRoom && waitingRoom.type === ChannelType.GuildVoice) {
        const voices = [blueVoice, redVoice].filter(Boolean);
        for (const voice of voices) {
          if (voice && voice.isVoiceBased()) {
            for (const [_, member] of voice.members) {
              await member.voice.setChannel(waitingRoom).catch(() => null);
            }
          }
        }
      }
    }

    const deleteChannels = async () => {
      try {
        // Busca os canais direto da API para evitar cache desatualizado
        const channels = await guild.channels.fetch();
        for (const [_, channel] of channels) {
          if (
            channel &&
            (channel.name.toLowerCase().includes(cleanMatchId.toLowerCase()) ||
              channel.name.toLowerCase().includes(matchId.toLowerCase()))
          ) {
            await channel.delete().catch(() => null);
          }
        }
      } catch (err) {
        console.error('Erro ao deletar canais da partida:', err);
      }
    };

    if (immediate) {
      await deleteChannels();
    } else {
      // 4. Agenda a exclusão das salas temporárias em 2 minutos após vitória/derrota para ver o placar
      setTimeout(deleteChannels, 120000);
    }
  } catch (err) {
    console.error('Erro no cleanupMatchChannelsAndReturnPlayers:', err);
  }
}

// Função para construir o Embed e os Botões estilo NKN Inhouse com o Banner NKN
async function buildQueueEmbedAndButtons(imageUrl?: string) {
  const totalInQueue = generalQueue.length;

  const modeLabels: Record<GameMode, string> = {
    RANKED_AUTO: 'Ranked Competitiva (Auto MMR)',
    RANKED_CAPTAIN: 'Capitães (Draft com Capitães)',
    CASUAL_ARAM_ZOACAO: 'ARAM / Zoação (Casual)',
  };

  const modeTitle = modeLabels[currentQueueMode] || currentQueueMode;

  const playerList =
    totalInQueue > 0
      ? generalQueue
          .map((p, i) => `\`${i + 1}.\` <@${p.userId}> (${p.riotName ? `${p.riotName}#${p.riotTag}` : p.tag}) • \`${p.lanes.join(', ')}\``)
          .join('\n')
      : '*(Nenhum jogador na fila no momento)*';

  const embed = new EmbedBuilder()
    .setTitle(`🥷 Fila NKN Inhouse — (${totalInQueue}/10 Jogadores)`)
    .setDescription(
      `🏆 **Modo Atual:** \`${modeTitle}\`\n` +
      `📌 *A seleção de rotas e equipes é feita automaticamente via MMR com base no seu \`/rotas\`.*\n\n` +
      `👥 **Jogadores na Fila (${totalInQueue}/10):**\n${playerList}\n\n` +
      `• 🕹️ \`${activeMatchesCount * 10} jogadores\` em partida no momento`
    )
    .setColor('#7c3aed')
    .setFooter({ text: 'Fila NKN Inhouse • Requer Riot ID (/vincular) e rotas salvas (/rotas)' });

  const finalImageUrl = imageUrl || cachedBannerAttachmentUrl;
  const files: AttachmentBuilder[] = [];

  if (finalImageUrl) {
    embed.setImage(finalImageUrl);
  } else {
    const bannerPath = path.resolve(__dirname, '../assets/queue_banner.png');
    if (fs.existsSync(bannerPath)) {
      files.push(new AttachmentBuilder(bannerPath, { name: 'queue_banner.png' }));
      embed.setImage('attachment://queue_banner.png');
    }
  }

  // Controles da Fila: Entrar, Sair, Ver Jogadores
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('queue_enter')
      .setLabel('Entrar na Fila')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🎯'),
    new ButtonBuilder()
      .setCustomId('queue_leave')
      .setLabel('Sair da Fila')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🚪'),
    new ButtonBuilder()
      .setCustomId('queue_players')
      .setLabel('Lista de Jogadores')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('👥')
  );

  return { embeds: [embed], components: [row], files };
}

// Atualiza a mensagem permanente existente ou recupera ela
async function updatePermanentQueueMessage(guild: Guild) {
  if (!permanentQueueChannelId || !permanentQueueMessageId) return;

  try {
    const channel = await guild.channels.fetch(permanentQueueChannelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) return;

    const message = await (channel as any).messages.fetch(permanentQueueMessageId).catch(() => null);
    if (!message) return;

    // Se já tiver attachment na mensagem original, armazena para manter cache
    if (!cachedBannerAttachmentUrl && message.attachments.size > 0) {
      cachedBannerAttachmentUrl = message.attachments.first()?.url || null;
    }

    const payload = await buildQueueEmbedAndButtons(cachedBannerAttachmentUrl || undefined);
    await message.edit({
      embeds: payload.embeds,
      components: payload.components,
    });
  } catch (err) {
    console.error('Erro ao atualizar mensagem permanente da fila:', err);
  }
}

if (process.env.DISCORD_BOT_TOKEN) {
  client.login(process.env.DISCORD_BOT_TOKEN);
} else {
  console.log('⚠️ DISCORD_BOT_TOKEN não informado no .env. Configure para conectar ao Discord.');
}
