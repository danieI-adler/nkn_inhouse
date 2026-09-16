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
import { GameMode, Lane } from '@nkn/shared';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

// Mapeamento de partida para o canal de texto do Discord
const matchTextChannels = new Map<string, string>();

// Filas ativas em memória
const queueState = {
  RANKED_AUTO: new Set<string>(),
  RANKED_CAPTAIN: new Set<string>(),
  CASUAL_ARAM_ZOACAO: new Set<string>(),
};

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

  if (commandName === 'painel-fila') {
    const embed = new EmbedBuilder()
      .setTitle('🥷 NUKENIN INHOUSE QUEUE - LEAGUE OF LEGENDS')
      .setDescription(
        'Entre na fila para disputar partidas inhouse competitivas ou casuais no servidor Nukenin!\n\n' +
        '**Modos Disponíveis:**\n' +
        '⚔️ **Ranqueado (Auto Lane)**: Balanceamento automático por MMR e preferências de rota.\n' +
        '👑 **Ranqueado (Capitães)**: Os 2 maiores MMRs escolhem os times via draft alternado.\n' +
        '🎲 **Zoação (All-Random)**: Draft de capitães com campeões 100% aleatórios e sem alterar MMR.'
      )
      .setColor('#7c3aed')
      .setFooter({ text: 'Sistema Oficial Nukenin Inhouse • Requer conta Riot vinculada' });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('queue_ranked_auto').setLabel('Fila Ranqueada (Auto)').setStyle(ButtonStyle.Primary).setEmoji('⚔️'),
      new ButtonBuilder().setCustomId('queue_ranked_captain').setLabel('Fila Capitães').setStyle(ButtonStyle.Secondary).setEmoji('👑'),
      new ButtonBuilder().setCustomId('queue_zoacao').setLabel('Modo Zoação').setStyle(ButtonStyle.Success).setEmoji('🎲'),
      new ButtonBuilder().setCustomId('queue_leave').setLabel('Sair da Fila').setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
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
      await cleanupMatchChannelsAndReturnPlayers(interaction.guild!, matchId);
    } catch (err: any) {
      await interaction.editReply(`❌ Falha: ${err.message}`);
    }
  }
});

async function handleButtonQueue(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const customId = interaction.customId;

  if (customId === 'queue_leave') {
    queueState.RANKED_AUTO.delete(userId);
    queueState.RANKED_CAPTAIN.delete(userId);
    queueState.CASUAL_ARAM_ZOACAO.delete(userId);
    await interaction.reply({ content: '🚪 Você saiu de todas as filas.', ephemeral: true });
    return;
  }

  let mode: GameMode = 'RANKED_AUTO';
  if (customId === 'queue_ranked_captain') mode = 'RANKED_CAPTAIN';
  if (customId === 'queue_zoacao') mode = 'CASUAL_ARAM_ZOACAO';

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

    const queue = queueState[mode];
    if (queue.has(userId)) {
      await interaction.reply({ content: '⚠️ Você já está nessa fila!', ephemeral: true });
      return;
    }

    queue.add(userId);
    await interaction.reply({
      content: `🎯 Você entrou na fila **${mode}**! (${queue.size}/10 jogadores)`,
      ephemeral: true,
    });

    if (queue.size >= 10) {
      const playerIds: string[] = Array.from(queue).slice(0, 10);
      playerIds.forEach((id) => queue.delete(id));
      await createMatchRoom(interaction.guild!, playerIds, mode);
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

if (process.env.DISCORD_BOT_TOKEN) {
  client.login(process.env.DISCORD_BOT_TOKEN);
} else {
  console.log('⚠️ DISCORD_BOT_TOKEN não informado no .env. Configure para conectar ao Discord.');
}
