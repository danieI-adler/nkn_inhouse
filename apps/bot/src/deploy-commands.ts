import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error('❌ DISCORD_BOT_TOKEN, CLIENT_ID ou GUILD_ID não definidos no .env!');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('vincular')
    .setDescription('Vincula sua conta da Riot Games (Riot ID) ao sistema Inhouse')
    .addStringOption((option) =>
      option
        .setName('riot_id')
        .setDescription('Seu Riot ID no formato Nome#Tag (Ex: Faker#BR1)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('rotas')
    .setDescription('Configura suas preferências de rota (escolha entre 2 e 4 rotas ou apenas FILL)')
    .addStringOption((option) =>
      option
        .setName('rotas')
        .setDescription('Exemplo: TOP, MID ou FILL (opções: TOP, JUNGLE, MID, ADC, SUPPORT, FILL)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('painel-fila')
    .setDescription('Envia o painel interativo de matchmaking da Inhouse no canal'),

  new SlashCommandBuilder()
    .setName('resultado')
    .setDescription('Registra o vencedor de uma partida e atualiza o MMR de todos os participantes')
    .addStringOption((option) =>
      option
        .setName('partida_id')
        .setDescription('ID da partida (ex: nkn-1234)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('vencedor')
        .setDescription('Time que venceu a partida')
        .setRequired(true)
        .addChoices(
          { name: 'Time Azul', value: 'BLUE' },
          { name: 'Time Vermelho', value: 'RED' }
        )
    ),
  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Exibe a Leaderboard com o Top jogadores e MMR da comunidade Nukenin'),

  new SlashCommandBuilder()
    .setName('setup-ranking')
    .setDescription('Cria o painel permanente do Ranking que se autoatualiza com botão de atualizar e pós-partida')
    .addChannelOption((option) =>
      option
        .setName('canal')
        .setDescription('Canal onde o painel permanente do ranking será fixado')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('set-waiting-room')
    .setDescription('Define o canal de voz geral para onde os jogadores voltam após o término da partida')
    .addChannelOption((option) =>
      option
        .setName('canal_voz')
        .setDescription('Canal de voz geral / sala de espera')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Exibe o perfil inhouse e de League of Legends de um jogador (Elo, MMR, Campeões mais jogados)')
    .addUserOption((option) =>
      option
        .setName('usuario')
        .setDescription('Membro do Discord cujo perfil deseja visualizar (deixe vazio para ver o seu)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('setup-fila')
    .setDescription('Cria e fixa a mensagem permanente da Fila NKN Inhouse com atualização em tempo real')
    .addChannelOption((option) =>
      option
        .setName('canal')
        .setDescription('Canal de texto onde a mensagem permanente será fixada')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('modo')
        .setDescription('Tipo/Modo de jogo da fila permanente')
        .setRequired(false)
        .addChoices(
          { name: 'Ranked Competitiva (Auto MMR)', value: 'RANKED_AUTO' },
          { name: 'Capitães (Draft com Capitães)', value: 'RANKED_CAPTAIN' },
          { name: 'ARAM / Zoação (Casual)', value: 'CASUAL_ARAM_ZOACAO' }
        )
    ),

  new SlashCommandBuilder()
    .setName('set-modo')
    .setDescription('Altera o modo de jogo da fila ativa no painel permanente')
    .addStringOption((option) =>
      option
        .setName('modo')
        .setDescription('Tipo/Modo de jogo desejado para a fila')
        .setRequired(true)
        .addChoices(
          { name: 'Ranked Competitiva (Auto MMR)', value: 'RANKED_AUTO' },
          { name: 'Capitães (Draft com Capitães)', value: 'RANKED_CAPTAIN' },
          { name: 'ARAM / Zoação (Casual)', value: 'CASUAL_ARAM_ZOACAO' }
        )
    ),

  new SlashCommandBuilder()
    .setName('cancelar-partida')
    .setDescription('Cancela e exclui uma partida em andamento sem alterar MMR')
    .addStringOption((option) =>
      option
        .setName('partida_id')
        .setDescription('ID da partida (ex: nkn-5501)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('test-partida')
    .setDescription('Cria uma partida de teste imediatamente usando jogadores vinculados no banco de dados'),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

async function deploy() {
  try {
    console.log('🔄 Registrando Slash Commands no Discord...');
    await rest.put(Routes.applicationGuildCommands(clientId!, guildId!), { body: commands });
    console.log('✅ Slash Commands registrados com sucesso no servidor!');
  } catch (error) {
    console.error('❌ Erro ao registrar comandos:', error);
  }
}

deploy();
