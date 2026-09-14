const gatewayClient = require('./gatewayClient');
const log = require('./log');

log.info('Iniciando gateway — aguardando conexão com o backend e config de saídas...');

// As conexões com os controladores físicos não são mais abertas aqui: elas
// são criadas sob demanda assim que a config chega pelo WebSocket (ver
// outputsStore.js), já que o mapeamento de saídas agora vem do backend,
// não de um arquivo local.
gatewayClient.connect();

function shutdown(signal) {
  log.info(`Recebido ${signal}, encerrando...`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
