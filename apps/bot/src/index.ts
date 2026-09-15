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
import * as dotenv from 'dotenv';
import path from 'path';
import { GameMode, Lane } from '@nkn/shared';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

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
});

// Comandos e Interações de Fila
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    handleButtonQueue(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

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
        `⏳ Esta sala e os canais de voz serão removidos em 10 minutos.`
      );
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

if (process.env.DISCORD_BOT_TOKEN) {
  client.login(process.env.DISCORD_BOT_TOKEN);
} else {
  console.log('⚠️ DISCORD_BOT_TOKEN não informado no .env. Configure para conectar ao Discord.');
}
