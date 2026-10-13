const WebSocket = require('ws');
const log = require('./log');
const status = require('./status');
const { handleCommand, handleOutputTest } = require('./commandHandler');
const outputsStore = require('./outputsStore');
const { closeAllControllerConnections } = require('./controllerConnection');

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
// Tempo máximo esperando o backend receber o aviso de encerramento antes de
// fechar mesmo assim (sem internet, o app não pode ficar travado ao fechar).
const SHUTDOWN_TIMEOUT_MS = 3000;

let config = null;
let ws = null;
let reconnectTimer = null;
let stopping = false;
let backoffMs = MIN_BACKOFF_MS;

/**
 * Conexão de SAÍDA (WSS/WS) com o backend — autenticação via header HTTP no
 * handshake (Authorization: Bearer <deviceToken>), não uma mensagem JSON
 * inicial (ver backend/src/gatewayWs/gatewayWs.js). Reconecta com backoff
 * exponencial; se a conexão cair no meio de um comando, o ack simplesmente
 * nunca chega — o timeout é responsabilidade do backend, não deste processo.
 */
function connect() {
  reconnectTimer = null;
  status.setBackend('connecting');
  const socket = new WebSocket(config.backendWsUrl, {
    headers: { Authorization: `Bearer ${config.deviceToken}` },
  });
  ws = socket;

  socket.on('open', () => {
    log.info('Conectado ao backend');
    status.setBackend('connected');
    backoffMs = MIN_BACKOFF_MS;
  });

  socket.on('message', (raw) => {
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

    if (payload?.type === 'outputTest') {
      handleOutputTest(payload, socket);
      return;
    }

    if (payload?.type !== 'command') {
      log.warn('Mensagem do backend não reconhecida, ignorada:', payload);
      return;
    }

    handleCommand(payload, socket);
  });

  socket.on('error', (err) => {
    // 401 no handshake = token errado ou gateway revogado no /gate-control.
    if (/\b401\b/.test(err.message)) {
      log.error('Backend recusou o token do gateway (token inválido ou revogado) — confira a configuração');
      status.setBackend('unauthorized', 'Token inválido ou revogado');
      return;
    }
    log.error(`Erro na conexão com o backend: ${err.message}`);
    status.setBackend('disconnected', err.message);
  });

  socket.on('close', (code) => {
    if (ws === socket) ws = null;
    if (stopping) return;
    if (status.snapshot().backend.state !== 'unauthorized') status.setBackend('disconnected');
    log.warn(`Desconectado do backend (code=${code}), reconectando em ${backoffMs}ms`);
    reconnectTimer = setTimeout(connect, backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  });
}

/** Começa a conectar ao backend com { backendWsUrl, deviceToken }. */
function start(newConfig) {
  if (config) throw new Error('Gateway já iniciado');
  config = newConfig;
  stopping = false;
  backoffMs = MIN_BACKOFF_MS;
  connect();
}

/**
 * Encerramento normal (porteiro fechou o app / Ctrl+C no terminal): avisa o
 * backend (`shutdown` — o sininho mostra "encerrado pelo operador" em vez do
 * alarme de offline), fecha a conexão sem reconectar e solta as controladoras.
 * Sem conexão com o backend, só encerra.
 */
async function stop() {
  if (!config) return;
  stopping = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;

  const socket = ws;
  if (socket && socket.readyState === WebSocket.OPEN) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        socket.terminate();
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);
      socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.send(JSON.stringify({ type: 'shutdown' }), () => socket.close(1000, 'shutdown'));
    });
    log.info('Encerrado — backend avisado');
  } else if (socket) {
    socket.terminate();
  }

  ws = null;
  config = null;
  closeAllControllerConnections();
  status.setBackend('stopped');
}

module.exports = { start, stop };
