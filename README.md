# 🥷 NKN Inhouse Queue - League of Legends

> Ecossistema completo e automatizado de **Inhouse Queue (Partidas Customizadas)** da comunidade **Nukenin** no Discord para League of Legends.

![Nukenin Draft Banner](https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Akali_0.jpg)

---

## 🌟 Funcionalidades do Sistema

1. **Bot do Discord (`apps/bot`)**:
   - `/vincular`: Vincula a conta Riot (`Nome#Tag`), consulta a API oficial da Riot Games (PUUID e rank Solo/Duo) e calibra o MMR inicial.
   - `/rotas`: Registra preferências de rota (`TOP`, `JUNGLE`, `MID`, `ADC`, `SUPPORT`, `FILL`) e sincroniza cargos no servidor.
   - `/painel-fila`: Painel interativo com botões de matchmaking para as filas:
     - ⚔️ **Ranqueada (Auto Lane)**: Balanceamento automático com minimização de delta MMR e autofill inteligente.
     - 👑 **Ranqueada (Capitães)**: Os 2 maiores MMRs escolhem os times via draft alternado.
     - 🎲 **Zoação**: Capitães escolhendo com campeões 100% aleatórios (sem alterar MMR).
   - Criação automática de categoria, canal `#〔💬〕lobby-[id]` e 2 canais de voz temporários (`Time Azul` e `Time Vermelho`) com permissões estritas.
   - Envio de links do **OP.GG Multi-Search** formatados para ambos os times.
   - `/resultado`: Confirmação do vencedor pelos capitães com recálculo de Elo ($K=40$ nas primeiras 10 partidas de calibração, $K=20$ nas seguintes) e descarte automático de salas em 10 minutos.

2. **Web App de Draft em Tempo Real (`apps/web-draft`)**:
   - Interface inspirada em transmissões competitivas e **LDDA Draft / draftlol**.
   - Integração com **Riot Games Data Dragon** em tempo real (incluindo Aurora, Ambessa, Mel, Yunara, Zaahen e Locke).
   - Máquina de estados oficial de torneio com **10 bans e 10 picks** divididos em fases.
   - Cronômetro de 30 segundos com botão de **Prorrogação (+15s Extra)**.
   - Exibição do nome de cada jogador do Discord na respectiva lane.
   - **Fase de Troca de Rotas (Swap Lanes)** interativa ao término das escolhas.

3. **Backend API & WebSockets (`apps/api`)**:
   - Servidor Fastify de altíssima performance.
   - Sincronização em tempo real via **Socket.io** entre Capitão Azul, Capitão Vermelho e Espectadores.
   - Geração nativa de card de partida em imagem PNG com `@napi-rs/canvas`.

---

## 📁 Estrutura do Monorepo

```
nkn_inhouse/
├── packages/
│   └── shared/               # Tipos TypeScript, Enums e Sequência de Torneio (@nkn/shared)
├── apps/
│   ├── api/                  # Backend Fastify, WebSockets, Matchmaker, MMR e Canvas
│   ├── bot/                  # Bot Discord.js v14, Slash Commands e Canais Dinâmicos
│   └── web-draft/            # Frontend React + Tailwind CSS (Interface de Picks/Bans)
├── render.yaml               # Blueprint de deploy automático no Render.com
├── package.json              # NPM Workspaces raiz
└── README.md
```

---

## 🚀 Como Rodar Localmente

### 1. Instalação
```bash
npm install
```

### 2. Configurar Variáveis de Ambiente
Copie o arquivo `.env.example` para `.env`:
```bash
cp .env.example .env
```
Preencha as variáveis com suas credenciais do Discord e Riot Games.

### 3. Iniciar os Serviços
- **Backend API**:
  ```bash
  npm run dev:api
  ```
- **Web Draft**:
  ```bash
  npm run dev:web
  ```
- **Bot do Discord**:
  ```bash
  npm run dev:bot
  ```

---

## ☁️ Deploy em Produção

- **Frontend (Web Draft)**: Hospedado gratuitamente no **GitHub Pages**.
- **Backend (API) & Bot do Discord**: Hospedado no **Render.com** utilizando o arquivo `render.yaml` incluso no repositório.
