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

// Estrutura de Fila por Rotas (Estilo LDDA / KaBuM High)
export interface QueuedPlayer {
  userId: string;
  tag: string;
  riotName?: string;
  riotTag?: string;
}

const laneQueue: Record<'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT', QueuedPlayer[]> = {
  TOP: [],
  JUNGLE: [],
  MID: [],
  ADC: [],
  SUPPORT: [],
};

// Mapeamento de duos: userId -> partnerId
const duoPairs = new Map<string, string>();
let permanentQueueChannelId: string | null = null;
let permanentQueueMessageId: string | null = null;
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

  // Recupera configurações de fila permanente salvas
  (async () => {
    try {
      const sRes = await fetch(`${API_BASE_URL}/api/settings`);
      const sData = await sRes.json();
      if (sData.settings?.queueChannelId) {
        permanentQueueChannelId = sData.settings.queueChannelId;
        permanentQueueMessageId = sData.settings.queueMessageId || null;
        console.log(`📌 Canal de fila permanente carregado: ${permanentQueueChannelId}, Msg: ${permanentQueueMessageId}`);
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

    try {
      const payload = await buildQueueEmbedAndButtons();
      const message = await targetChannel.send(payload);
      permanentQueueChannelId = targetChannel.id;
      permanentQueueMessageId = message.id;

      // Salva no banco de dados Supabase para persistência contínua
      await fetch(`${API_BASE_URL}/api/settings/queue-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: targetChannel.id, messageId: message.id }),
      });

      await interaction.editReply(`✅ Painel oficial permanente da Fila NKN fixado com sucesso em <#${targetChannel.id}>!`);
    } catch (e: any) {
      await interaction.editReply(`❌ Erro ao configurar painel de fila: ${e.message}`);
    }
  }

  if (commandName === 'painel-fila') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const payload = await buildQueueEmbedAndButtons();
      const message = await (interaction.channel as any).send(payload);
      permanentQueueChannelId = interaction.channelId;
      permanentQueueMessageId = message.id;

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
});

async function handleButtonQueue(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const customId = interaction.customId;

  // 1. Botão Sair da Fila
  if (customId === 'queue_lane_leave') {
    let removed = false;
    (['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const).forEach((l) => {
      const idx = laneQueue[l].findIndex((p) => p.userId === userId);
      if (idx !== -1) {
        laneQueue[l].splice(idx, 1);
        removed = true;
      }
    });

    // Se estava em duo, desfaz o duo
    const partnerId = duoPairs.get(userId);
    if (partnerId) {
      duoPairs.delete(userId);
      duoPairs.delete(partnerId);
    }

    await interaction.reply({
      content: removed ? '🚪 Você saiu da fila.' : '⚠️ Você não está na fila.',
      ephemeral: true,
    });
    await updatePermanentQueueMessage(interaction.guild!);
    return;
  }

  // 2. Botão Lista de Jogadores na Fila
  if (customId === 'queue_lane_players') {
    const total = (['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const).reduce(
      (acc, l) => acc + laneQueue[l].length,
      0
    );

    if (total === 0) {
      await interaction.reply({ content: '📊 A fila está vazia no momento.', ephemeral: true });
      return;
    }

    const lines: string[] = [];
    (['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const).forEach((l) => {
      if (laneQueue[l].length > 0) {
        lines.push(`**${l}**: ${laneQueue[l].map((p) => `<@${p.userId}> (${p.riotName ? `${p.riotName}#${p.riotTag}` : p.tag})`).join(', ')}`);
      }
    });

    await interaction.reply({
      content: `👥 **Jogadores na Fila (${total}):**\n${lines.join('\n')}`,
      ephemeral: true,
    });
    return;
  }

  // 3. Botão Duo (Informativo / Em desenvolvimento amigável)
  if (customId === 'queue_lane_duo') {
    await interaction.reply({
      content: '🤝 **Sistema de Duo**: Em breve! Para jogar juntos agora, entrem nas rotas desejadas no painel da fila.',
      ephemeral: true,
    });
    return;
  }

  // 4. Seleção de Rotas (Top, Jungle, Mid, Adc, Sup)
  const laneMap: Record<string, 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT'> = {
    queue_lane_top: 'TOP',
    queue_lane_jungle: 'JUNGLE',
    queue_lane_mid: 'MID',
    queue_lane_adc: 'ADC',
    queue_lane_sup: 'SUPPORT',
  };

  const selectedLane = laneMap[customId];
  if (!selectedLane) return;

  // Verifica se o jogador tem conta vinculada
  try {
    const profileRes = await fetch(`${API_BASE_URL}/api/players/${userId}`);
    if (!profileRes.ok) {
      await interaction.reply({
        content: '❌ Você precisa vincular seu Riot ID antes de entrar na fila! Use `/vincular`.',
        ephemeral: true,
      });
      return;
    }

    const profileData = await profileRes.json();
    const profile = profileData.profile;

    // Remove o jogador de qualquer rota que ele já estivesse
    (['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const).forEach((l) => {
      const idx = laneQueue[l].findIndex((p) => p.userId === userId);
      if (idx !== -1) laneQueue[l].splice(idx, 1);
    });

    // Adiciona na rota selecionada
    laneQueue[selectedLane].push({
      userId,
      tag: interaction.user.tag,
      riotName: profile?.riotGameName,
      riotTag: profile?.riotTagLine,
    });

    await interaction.reply({
      content: `🎯 Você entrou na fila de **${selectedLane}**!`,
      ephemeral: true,
    });

    // Atualiza a mensagem permanente
    await updatePermanentQueueMessage(interaction.guild!);

    // Checa se atingiu 10 jogadores (2 de cada rota) para formar a partida
    const isReady = (['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const).every(
      (l) => laneQueue[l].length >= 2
    );

    if (isReady) {
      const matchPlayers: string[] = [];
      (['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const).forEach((l) => {
        const p1 = laneQueue[l].shift();
        const p2 = laneQueue[l].shift();
        if (p1) matchPlayers.push(p1.userId);
        if (p2) matchPlayers.push(p2.userId);
      });

      // Atualiza a mensagem permanente pós-pop
      await updatePermanentQueueMessage(interaction.guild!);

      // Dispara a criação da sala
      await createMatchRoom(interaction.guild!, matchPlayers, 'RANKED_AUTO');
    }
  } catch (err: any) {
    await interaction.reply({ content: `❌ Erro: ${err.message}`, ephemeral: true });
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

    const textChannel = await guild.channels.create({
      name: `〔💬〕lobby-${matchId}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
        ...playerIds.map((id) => ({
          id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        })),
      ],
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

    // Gera link OP.GG Multi-search
    const blueSummoners = match.blueTeam.map((s: any) => `${s.player.riotGameName}%23${s.player.riotTagLine}`).join(',');
    const redSummoners = match.redTeam.map((s: any) => `${s.player.riotGameName}%23${s.player.riotTagLine}`).join(',');
    const blueOpgg = `https://www.op.gg/multisearch/br?summoners=${blueSummoners}`;
    const redOpgg = `https://www.op.gg/multisearch/br?summoners=${redSummoners}`;

    const draftBase = process.env.WEB_DRAFT_URL || 'http://localhost:5173';
    const blueCaptainLink = `${draftBase}/draft/${matchId}?token=${match.blueCaptainToken}`;
    const redCaptainLink = `${draftBase}/draft/${matchId}?token=${match.redCaptainToken}`;
    const spectatorLink = `${draftBase}/draft/${matchId}?token=${match.spectatorToken}`;

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ Partida Formada - #${matchId.toUpperCase()}`)
      .setDescription(
        `**Sala no LoL**: \`${match.roomName}\` | **Senha**: \`${match.roomPassword}\`\n\n` +
        `**🔵 Time Azul:**\n` +
        match.blueTeam.map((s: any) => `<@${s.player.discordId}> • \`${s.assignedLane}\` • ${s.player.riotGameName}#${s.player.riotTagLine}`).join('\n') +
        `\n📊 [OP.GG Time Azul](${blueOpgg})\n\n` +
        `**🔴 Time Vermelho:**\n` +
        match.redTeam.map((s: any) => `<@${s.player.discordId}> • \`${s.assignedLane}\` • ${s.player.riotGameName}#${s.player.riotTagLine}`).join('\n') +
        `\n📊 [OP.GG Time Vermelho](${redOpgg})\n\n` +
        `**Links do Draft:**\n` +
        `🔵 [Entrar como Capitão Azul](${blueCaptainLink})\n` +
        `🔴 [Entrar como Capitão Vermelho](${redCaptainLink})\n` +
        `👁️ [Assistir como Espectador](${spectatorLink})`
      )
      .setColor('#38bdf8');

    await textChannel.send({ embeds: [embed] });

    // Baixa o Card gerado pelo canvas nativo e anexa
    try {
      const cardRes = await fetch(`${API_BASE_URL}/api/matches/${matchId}/card`);
      if (cardRes.ok) {
        const arrayBuf = await cardRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const attachment = new AttachmentBuilder(buffer, { name: `card-${matchId}.png` });
        await textChannel.send({ files: [attachment] });
      }
    } catch (e) {
      console.error('Erro ao renderizar imagem do card:', e);
    }
  } catch (err) {
    console.error('Erro no createMatchRoom:', err);
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

async function cleanupMatchChannelsAndReturnPlayers(guild: Guild, matchId: string) {
  try {
    // 1. Obtém a waiting room configurada
    let waitingRoomId: string | undefined;
    try {
      const settingsRes = await fetch(`${API_BASE_URL}/api/settings`);
      const settingsData = await settingsRes.json();
      waitingRoomId = settingsData.settings?.waitingRoomVoiceId;
    } catch (e) {
      console.error('Erro ao consultar settings da waiting room:', e);
    }

    const cleanMatchId = matchId.toLowerCase();

    // 2. Encontra os canais de voz temporários da partida
    const matchVoiceChannels = guild.channels.cache.filter(
      (c) =>
        c.type === ChannelType.GuildVoice &&
        (c.name.toLowerCase().includes(cleanMatchId) || c.name.toLowerCase().includes(matchId.toLowerCase()))
    );

    // 3. Move os membros de volta para a waiting room se configurada
    if (waitingRoomId) {
      const waitingRoom = guild.channels.cache.get(waitingRoomId);
      if (waitingRoom && waitingRoom.type === ChannelType.GuildVoice) {
        for (const [_, voiceChan] of matchVoiceChannels) {
          if (voiceChan.isVoiceBased()) {
            for (const [_, member] of voiceChan.members) {
              await member.voice.setChannel(waitingRoomId).catch(() => null);
            }
          }
        }
      }
    }

    // 4. Agenda a exclusão das salas temporárias (texto, voz e categoria) em 2 minutos para dar tempo de ver o placar
    setTimeout(async () => {
      try {
        const channelsToDelete = guild.channels.cache.filter(
          (c) =>
            c.name.toLowerCase().includes(cleanMatchId) ||
            c.name.toLowerCase().includes(matchId.toLowerCase())
        );

        for (const [_, channel] of channelsToDelete) {
          await channel.delete().catch(() => null);
        }
      } catch (err) {
        console.error('Erro ao deletar canais da partida:', err);
      }
    }, 120000); // 2 minutos
  } catch (err) {
    console.error('Erro no cleanupMatchChannelsAndReturnPlayers:', err);
  }
}

// Função para construir o Embed e os Botões estilo LDDA / KaBuM High com o Banner NKN
async function buildQueueEmbedAndButtons() {
  const topCount = laneQueue.TOP.length;
  const jgCount = laneQueue.JUNGLE.length;
  const midCount = laneQueue.MID.length;
  const adcCount = laneQueue.ADC.length;
  const supCount = laneQueue.SUPPORT.length;
  const totalInQueue = topCount + jgCount + midCount + adcCount + supCount;

  const topList = topCount > 0 ? laneQueue.TOP.map((p) => `<@${p.userId}>`).join(', ') : '*(vazio)*';
  const jgList = jgCount > 0 ? laneQueue.JUNGLE.map((p) => `<@${p.userId}>`).join(', ') : '*(vazio)*';
  const midList = midCount > 0 ? laneQueue.MID.map((p) => `<@${p.userId}>`).join(', ') : '*(vazio)*';
  const adcList = adcCount > 0 ? laneQueue.ADC.map((p) => `<@${p.userId}>`).join(', ') : '*(vazio)*';
  const supList = supCount > 0 ? laneQueue.SUPPORT.map((p) => `<@${p.userId}>`).join(', ') : '*(vazio)*';

  const embed = new EmbedBuilder()
    .setTitle(`🥷 Fila NKN Inhouse (${totalInQueue}/10 Jogadores)`)
    .setDescription(
      `🛡️ **(${topCount}/2)** Top: ${topList}\n` +
      `🌲 **(${jgCount}/2)** Jungle: ${jgList}\n` +
      `⚔️ **(${midCount}/2)** Mid: ${midList}\n` +
      `🏹 **(${adcCount}/2)** Adc: ${adcList}\n` +
      `💖 **(${supCount}/2)** Sup: ${supList}\n\n` +
      `• 🕹️ \`${activeMatchesCount * 10} jogadores\` em partida no momento\n\n` +
      `🏹 **Duos (0)**\nNenhum duo`
    )
    .setColor('#7c3aed')
    .setImage('attachment://queue_banner.png')
    .setFooter({ text: 'Fila Competitiva NKN • Requer conta Riot vinculada (/vincular)' });

  // Linha 1: Rotas Principais
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('queue_lane_top').setLabel(`Top (${topCount}/2)`).setStyle(ButtonStyle.Success).setEmoji('🛡️'),
    new ButtonBuilder().setCustomId('queue_lane_jungle').setLabel(`Jungle (${jgCount}/2)`).setStyle(ButtonStyle.Success).setEmoji('🌲'),
    new ButtonBuilder().setCustomId('queue_lane_mid').setLabel(`Mid (${midCount}/2)`).setStyle(ButtonStyle.Primary).setEmoji('⚔️'),
    new ButtonBuilder().setCustomId('queue_lane_adc').setLabel(`Adc (${adcCount}/2)`).setStyle(ButtonStyle.Primary).setEmoji('🏹'),
    new ButtonBuilder().setCustomId('queue_lane_sup').setLabel(`Sup (${supCount}/2)`).setStyle(ButtonStyle.Primary).setEmoji('💖')
  );

  // Linha 2: Ações (Sair, Duo, Jogadores)
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('queue_lane_leave').setLabel('Sair').setStyle(ButtonStyle.Danger).setEmoji('🚪'),
    new ButtonBuilder().setCustomId('queue_lane_duo').setLabel('Duo').setStyle(ButtonStyle.Primary).setEmoji('🤝'),
    new ButtonBuilder().setCustomId('queue_lane_players').setLabel('Jogadores').setStyle(ButtonStyle.Secondary).setEmoji('🔎')
  );

  const bannerPath = path.resolve(__dirname, '../assets/queue_banner.png');
  const files: AttachmentBuilder[] = [];
  if (fs.existsSync(bannerPath)) {
    files.push(new AttachmentBuilder(bannerPath, { name: 'queue_banner.png' }));
  }

  return { embeds: [embed], components: [row1, row2], files };
}

// Atualiza a mensagem permanente existente ou recupera ela
async function updatePermanentQueueMessage(guild: Guild) {
  if (!permanentQueueChannelId || !permanentQueueMessageId) return;

  try {
    const channel = await guild.channels.fetch(permanentQueueChannelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) return;

    const message = await (channel as any).messages.fetch(permanentQueueMessageId).catch(() => null);
    if (!message) return;

    const payload = await buildQueueEmbedAndButtons();
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
