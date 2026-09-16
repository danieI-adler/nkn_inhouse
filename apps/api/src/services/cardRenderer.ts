import { createCanvas, loadImage } from '@napi-rs/canvas';
import { MatchData, DraftState, Lane } from '@nkn/shared';

const D_DRAGON_VER = '14.10.1';

export async function generateMatchCard(match: MatchData, draftState: DraftState): Promise<Buffer> {
  const width = 1200;
  const height = 675;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 1. Fundo Gamer Estilo Nukenin (Degradê Nanquim escuro e roxo)
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#0a0914');
  bgGrad.addColorStop(0.5, '#160c28');
  bgGrad.addColorStop(1, '#080511');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Efeito sutil de vinheta e grid
  ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
  for (let x = 0; x < width; x += 30) {
    ctx.fillRect(x, 0, 1, height);
  }
  for (let y = 0; y < height; y += 30) {
    ctx.fillRect(0, y, width, 1);
  }

  // 2. Header
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('NUKENIN INHOUSE LEAGUE', width / 2, 45);

  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#a78bfa';
  ctx.fillText(`PARTIDA #${match.id.toUpperCase()} • MODO: ${match.mode}`, width / 2, 70);

  // 3. Cabeçalhos de Times
  // Time Azul
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('TIME AZUL', 60, 105);

  // Time Vermelho
  ctx.fillStyle = '#f87171';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('TIME VERMELHO', width - 60, 105);

  // 4. Slots dos Campeões (5 para cada lado)
  const slotWidth = 480;
  const slotHeight = 70;
  const startY = 120;
  const gapY = 14;

  const defaultBluePicks = draftState.bluePicks.length === 5 ? draftState.bluePicks : match.blueTeam.map(s => ({
    championId: s.championId || 'Aatrox',
    championName: s.championName || 'Aatrox',
  }));

  const defaultRedPicks = draftState.redPicks.length === 5 ? draftState.redPicks : match.redTeam.map(s => ({
    championId: s.championId || 'Camille',
    championName: s.championName || 'Camille',
  }));

  // Render Time Azul
  for (let i = 0; i < 5; i++) {
    const y = startY + i * (slotHeight + gapY);
    const slot = match.blueTeam[i];
    const pick = defaultBluePicks[i];

    // Fundo do slot azul
    ctx.fillStyle = 'rgba(14, 116, 144, 0.25)';
    ctx.fillRect(60, y, slotWidth, slotHeight);

    // Borda azul neon
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(60, y, slotWidth, slotHeight);

    // Splash Art (Carrega ou fallback)
    try {
      const splashUrl = `https://ddragon.leagueoflegends.com/cdn/${D_DRAGON_VER}/img/champion/${pick.championId}.png`;
      const img = await loadImage(splashUrl);
      ctx.drawImage(img, 65, y + 5, 60, 60);
    } catch {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(65, y + 5, 60, 60);
    }

    // Texto: Campeão, Lane e Nick
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(pick.championName || pick.championId, 140, y + 28);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 12px sans-serif';
    const laneTag = slot?.assignedLane || ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'][i];
    ctx.fillText(`[${laneTag}]`, 140, y + 50);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px sans-serif';
    const playerNick = slot?.player ? `${slot.player.riotGameName}#${slot.player.riotTagLine}` : `Jogador ${i + 1}`;
    ctx.fillText(playerNick, 210, y + 50);
  }

  // Render Time Vermelho
  for (let i = 0; i < 5; i++) {
    const y = startY + i * (slotHeight + gapY);
    const slot = match.redTeam[i];
    const pick = defaultRedPicks[i];
    const x = width - 60 - slotWidth;

    // Fundo do slot vermelho
    ctx.fillStyle = 'rgba(185, 28, 28, 0.25)';
    ctx.fillRect(x, y, slotWidth, slotHeight);

    // Borda vermelha
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, slotWidth, slotHeight);

    // Splash Art
    try {
      const splashUrl = `https://ddragon.leagueoflegends.com/cdn/${D_DRAGON_VER}/img/champion/${pick.championId}.png`;
      const img = await loadImage(splashUrl);
      ctx.drawImage(img, x + slotWidth - 65, y + 5, 60, 60);
    } catch {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x + slotWidth - 65, y + 5, 60, 60);
    }

    // Texto: Campeão, Lane e Nick
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(pick.championName || pick.championId, x + slotWidth - 80, y + 28);

    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 12px sans-serif';
    const laneTag = slot?.assignedLane || ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'][i];
    ctx.fillText(`[${laneTag}]`, x + slotWidth - 80, y + 50);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px sans-serif';
    const playerNick = slot?.player ? `${slot.player.riotGameName}#${slot.player.riotTagLine}` : `Jogador ${i + 1}`;
    ctx.fillText(playerNick, x + slotWidth - 145, y + 50);
  }

  // 5. Rodapé: Informações da Sala e Bans
  const footerY = height - 90;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fillRect(0, footerY, width, 90);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, footerY, width, 90);

  // Bans do Time Azul (à esquerda)
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('BANS AZUL:', 60, footerY + 25);
  for (let b = 0; b < 5; b++) {
    const banId = draftState.blueBans[b];
    const bx = 60 + b * 42;
    const by = footerY + 34;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.fillRect(bx, by, 36, 36);
    ctx.strokeStyle = '#ef4444';
    ctx.strokeRect(bx, by, 36, 36);

    if (banId && banId !== 'None') {
      try {
        const banImg = await loadImage(`https://ddragon.leagueoflegends.com/cdn/${D_DRAGON_VER}/img/champion/${banId}.png`);
        ctx.drawImage(banImg, bx, by, 36, 36);
        // Efeito de risco diagonal de ban
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + 36, by + 36);
        ctx.stroke();
      } catch {}
    }
  }

  // Bans do Time Vermelho (à direita)
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('BANS VERMELHO:', width - 60, footerY + 25);
  for (let b = 0; b < 5; b++) {
    const banId = draftState.redBans[b];
    const bx = width - 60 - (5 - b) * 42;
    const by = footerY + 34;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.fillRect(bx, by, 36, 36);
    ctx.strokeStyle = '#ef4444';
    ctx.strokeRect(bx, by, 36, 36);

    if (banId && banId !== 'None') {
      try {
        const banImg = await loadImage(`https://ddragon.leagueoflegends.com/cdn/${D_DRAGON_VER}/img/champion/${banId}.png`);
        ctx.drawImage(banImg, bx, by, 36, 36);
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + 36, by + 36);
        ctx.stroke();
      } catch {}
    }
  }

  // Sala no LoL no centro
  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    `Sala no LoL: ${match.roomName}   |   Senha: ${match.roomPassword}`,
    width / 2,
    footerY + 40
  );

  ctx.fillStyle = '#a78bfa';
  ctx.font = '12px sans-serif';
  ctx.fillText('Nukenin Community Inhouse • Partida Gerada Automaticamente', width / 2, footerY + 68);

  return canvas.toBuffer('image/png');
}
