const net = require('net');
const { buildPulseCommand, buildKeepAliveFrame, parseResponseFrame, FrameExtractor } = require('./mtcpProtocol');
const log = require('./log');

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
// Achado em produção (2026-09-14): o módulo derruba a conexão TCP ociosa
// depois de ~13,3s sem receber nada. 5s dá margem confortável.
const KEEPALIVE_INTERVAL_MS = 5000;

/**
 * Conexão TCP persistente com um controlador NSE MTCP-4E4S (1 instância por
 * host:porta único, deduplicado da config — ver getControllerConnection).
 * Os comandos são pulsos (ver buildPulseCommand): o módulo desliga o relé
 * sozinho, então não é preciso guardar o bitmask atual das saídas.
 */
class ControllerConnection {
  constructor(host, port, ns) {
    this.host = host;
    this.port = port;
    this.ns = ns;
    this.socket = null;
    this.frameExtractor = new FrameExtractor();
    this.backoffMs = MIN_BACKOFF_MS;
    this.pendingCommand = null; // { resolve, reject, timer }
    this.commandQueue = Promise.resolve(); // serializa comandos: só 1 em voo por conexão
    this.keepAliveTimer = null;
    this._connect();
  }

  _connect() {
    const socket = net.connect(this.port, this.host);
    this.socket = socket;

    socket.on('connect', () => {
      log.info(`[controlador ${this.host}:${this.port}] conectado`);
      this.backoffMs = MIN_BACKOFF_MS;
      this.keepAliveTimer = setInterval(() => {
        if (this.socket && !this.socket.destroyed) {
          this.socket.write(buildKeepAliveFrame(this.ns), 'ascii');
        }
      }, KEEPALIVE_INTERVAL_MS);
    });

    socket.on('data', (chunk) => {
      const frames = this.frameExtractor.push(chunk);
      for (const frame of frames) {
        const parsed = parseResponseFrame(frame);
        if (!parsed) continue;
        if (this.pendingCommand) {
          const { resolve, timer } = this.pendingCommand;
          clearTimeout(timer);
          this.pendingCommand = null;
          resolve(parsed);
        }
      }
    });

    socket.on('error', (err) => {
      log.error(`[controlador ${this.host}:${this.port}] erro: ${err.message}`);
    });

    socket.on('close', () => {
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
      if (this.pendingCommand) {
        const { reject, timer } = this.pendingCommand;
        clearTimeout(timer);
        this.pendingCommand = null;
        reject(new Error('Conexão com o controlador caiu'));
      }
      log.warn(`[controlador ${this.host}:${this.port}] desconectado, reconectando em ${this.backoffMs}ms`);
      setTimeout(() => this._connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    });
  }

  async _doPulseOutputs(outputNumbers, seconds, ns, timeoutMs) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Sem conexão com o controlador');
    }

    const frame = buildPulseCommand(outputNumbers, seconds, ns);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommand = null;
        reject(new Error('Timeout aguardando resposta do controlador'));
      }, timeoutMs);
      this.pendingCommand = { resolve, reject, timer };
      this.socket.write(frame, 'ascii');
    });

    return { ok: true };
  }

  /**
   * Pulsa 1 ou mais saídas NO MESMO frame (acionamento simultâneo de
   * verdade — os 2 braços da Entrada recebem o mesmo pulso). Só 1 comando
   * em voo por conexão, já que o protocolo não tem id de correlação próprio.
   * Timeout folgado: não foi confirmado se o módulo responde no início ou só
   * no fim do pulso.
   */
  pulseOutputs(outputNumbers, seconds, ns, timeoutMs = seconds * 1000 + 2000) {
    const run = () => this._doPulseOutputs(outputNumbers, seconds, ns, timeoutMs);
    const resultPromise = this.commandQueue.then(run, run);
    this.commandQueue = resultPromise.catch(() => {});
    return resultPromise;
  }
}

const connections = new Map();

function getControllerConnection(host, port, ns) {
  const key = `${host}:${port}`;
  if (!connections.has(key)) {
    connections.set(key, new ControllerConnection(host, port, ns));
  }
  return connections.get(key);
}

module.exports = { getControllerConnection };
