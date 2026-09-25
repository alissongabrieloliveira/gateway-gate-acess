const net = require('net');
const { buildPulseCommand, buildOutputsCommand, buildKeepAliveFrame, parseResponseFrame, FrameExtractor } = require('./mtcpProtocol');
const log = require('./log');

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
// Achado em produção (2026-09-14): o módulo derruba a conexão TCP ociosa
// depois de ~13,3s sem receber nada. 5s dá margem confortável.
const KEEPALIVE_INTERVAL_MS = 5000;

/**
 * Conexão TCP persistente com um controlador NSE MTCP-4E4S (1 instância por
 * host:porta único, deduplicado da config — ver getControllerConnection).
 * O fluxo normal só manda pulsos (ver buildPulseCommand): o módulo desliga o
 * relé sozinho. O liga/desliga de uma saída avulsa (teste por saída, tela de
 * diagnóstico) precisa do bitmask atual das saídas — guardado de cada frame
 * que o módulo manda (espontâneo a cada ~2s ou resposta de comando).
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
    this.lastOutputsBitmask = null; // null = ainda sem nenhum frame de status
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
        this.lastOutputsBitmask = parsed.outputsBitmask;
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
      this.lastOutputsBitmask = null;
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

  async _doSendFrame(buildFrame, timeoutMs) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Sem conexão com o controlador');
    }

    const frame = buildFrame();

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

  // Só 1 comando em voo por conexão, já que o protocolo não tem id de
  // correlação próprio. O frame é montado na hora de enviar (não na fila),
  // pra usar o bitmask mais recente no liga/desliga.
  _enqueue(buildFrame, timeoutMs) {
    const run = () => this._doSendFrame(buildFrame, timeoutMs);
    const resultPromise = this.commandQueue.then(run, run);
    this.commandQueue = resultPromise.catch(() => {});
    return resultPromise;
  }

  /**
   * Pulsa 1 ou mais saídas NO MESMO frame (acionamento simultâneo de
   * verdade — os 2 braços da Entrada recebem o mesmo pulso). Timeout
   * folgado: não foi confirmado se o módulo responde no início ou só no fim
   * do pulso.
   */
  pulseOutputs(outputNumbers, seconds, ns, timeoutMs = seconds * 1000 + 2000) {
    return this._enqueue(() => buildPulseCommand(outputNumbers, seconds, ns), timeoutMs);
  }

  /**
   * Liga/desliga (nível sustentado) as saídas pedidas, preservando as
   * demais a partir do último bitmask reportado pelo módulo. Sem nenhum
   * status recebido ainda, recusa — mandar com bitmask chutado poderia
   * desligar o relé de outra cancela.
   */
  setOutputs(outputNumbers, turnOn, ns, timeoutMs = 3000) {
    return this._enqueue(() => {
      if (this.lastOutputsBitmask === null) {
        throw new Error('Status atual das saídas ainda desconhecido — aguarde alguns segundos e tente de novo');
      }
      return buildOutputsCommand(this.lastOutputsBitmask, outputNumbers, turnOn, ns);
    }, timeoutMs);
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
