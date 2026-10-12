const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Pool } = require('pg');
require('dotenv').config();

async function updateRanking() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query('SELECT * FROM players ORDER BY wins DESC, matches_played DESC, internal_mmr DESC');
  await pool.end();

  let description = 'Nenhum jogador registrado no ranking até o momento.';

  if (rows && rows.length > 0) {
    const list = rows.slice(0, 20);
    const formattedRows = list.map((p, idx) => {
      let badge;
      if (idx === 0) badge = '🥇';
      else if (idx === 1) badge = '🥈';
      else if (idx === 2) badge = '🥉';
      else badge = '`#' + String(idx + 1).padStart(2, '0') + '`';

      const totalGames = p.matches_played || ((p.wins || 0) + (p.losses || 0)) || 0;
      const winrate = totalGames > 0 ? Math.round(((p.wins || 0) / totalGames) * 100) : 0;
      const nameTag = p.riot_game_name
        ? p.riot_game_name + '#' + (p.riot_tag_line || 'BR1')
        : (p.discord_tag || 'Jogador');

      const userMention = p.discord_id ? ' (<@' + p.discord_id + '>)' : '';
      return badge + ' **' + nameTag + '**' + userMention + '\n' +
             '> **' + (p.wins || 0) + 'V** ' + (p.losses || 0) + 'D • `' + winrate + '%` WR • MMR `' + (p.internal_mmr || 1200) + '`';
    });
    description = formattedRows.join('\n\n');
  }

  const embed = new EmbedBuilder()
    .setTitle('🏆 LEADERBOARD - COMUNIDADE NUKENIN')
    .setDescription(
      '*Classificação oficial ordenada pelo número de vitórias.*\n' +
      '*Atualizada automaticamente após cada partida.*\n\n' +
      description
    )
    .setColor('#f59e0b')
    .setFooter({ text: 'Inhouse Nukenin • Atualização em tempo real pós-jogo' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ranking_refresh')
      .setLabel('Atualizar Ranking')
      .setStyle(ButtonStyle.Primary)
  );

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_BOT_TOKEN);

  const channel = await client.channels.fetch('1550142654363205743');
  const message = await channel.messages.fetch('1550895407293272254');
  await message.edit({ embeds: [embed], components: [row] });

  console.log('RANKING_DISCORD_UPDATED_SUCCESS');
  await client.destroy();
}

updateRanking().catch(e => {
  console.error(e);
  process.exit(1);
});
