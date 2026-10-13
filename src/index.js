const gatewayClient = require('./gatewayClient');
const { loadFromEnv } = require('./config');
const log = require('./log');

// Modo terminal (`npm start`), com a config do .env. O app Electron
// (electron/main.js) usa o mesmo núcleo com a config da tela.
log.info('Iniciando gateway — aguardando conexão com o backend e config de saídas...');

// As conexões com os controladores físicos não são abertas aqui: elas são
// criadas sob demanda assim que a config chega pelo WebSocket (ver
// outputsStore.js), já que o mapeamento de saídas vem do backend, não de um
// arquivo local.
gatewayClient.start(loadFromEnv());

async function shutdown(signal) {
  log.info(`Recebido ${signal}, encerrando...`);
  await gatewayClient.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
