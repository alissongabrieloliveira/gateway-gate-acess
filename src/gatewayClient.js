const WebSocket = require('ws');
const config = require('./config');
const log = require('./log');
const { handleCommand } = require('./commandHandler');
const outputsStore = require('./outputsStore');

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

let backoffMs = MIN_BACKOFF_MS;

/**
 * Conexão de SAÍDA (WSS/WS) com o backend — autenticação via header HTTP no
 * handshake (Authorization: Bearer <deviceToken>), não uma mensagem JSON
 * inicial (ver backend/src/gatewayWs/gatewayWs.js). Reconecta com backoff
 * exponencial; se a conexão cair no meio de um comando, o ack simplesmente
 * nunca chega — o timeout é responsabilidade do backend, não deste processo.
 */
function connect() {
  const ws = new WebSocket(config.backendWsUrl, {
    headers: { Authorization: `Bearer ${config.deviceToken}` },
  });

  ws.on('open', () => {
    log.info('Conectado ao backend');
    backoffMs = MIN_BACKOFF_MS;
  });

  ws.on('message', (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      log.warn('Mensagem não-JSON recebida do backend, ignorada');
      return;
    }

    if (payload?.type === 'config') {
      try {
        outputsStore.setOutputs(payload.outputs);
      } catch (err) {
        log.error(`Config recebida do backend é inválida: ${err.message}`);
      }
      return;
    }

    if (payload?.type !== 'command') {
      log.warn('Mensagem do backend não reconhecida, ignorada:', payload);
      return;
    }

    handleCommand(payload, ws);
  });

  ws.on('error', (err) => {
    log.error(`Erro na conexão com o backend: ${err.message}`);
  });

  ws.on('close', (code) => {
    log.warn(`Desconectado do backend (code=${code}), reconectando em ${backoffMs}ms`);
    setTimeout(connect, backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  });
}

module.exports = { connect };
