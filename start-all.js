const { spawn } = require('child_process');

console.log('🚀 Iniciando API Fastify + WebSocket...');
const api = spawn('npm', ['--workspace=apps/api', 'run', 'start'], {
  stdio: 'inherit',
  shell: true,
});

console.log('🤖 Conectando Bot do Discord...');
const bot = spawn('npm', ['--workspace=apps/bot', 'run', 'start'], {
  stdio: 'inherit',
  shell: true,
});

process.on('SIGTERM', () => {
  api.kill('SIGTERM');
  bot.kill('SIGTERM');
  process.exit(0);
});

process.on('SIGINT', () => {
  api.kill('SIGINT');
  bot.kill('SIGINT');
  process.exit(0);
});
