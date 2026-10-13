const { EventEmitter } = require('events');

/**
 * Estado atual do gateway, para a tela do app Electron: conexão com o
 * backend, controladoras e quantas saídas vieram na config. Cada mudança
 * emite `change` com uma cópia do estado.
 *
 * backend.state: 'stopped' | 'connecting' | 'connected' | 'disconnected' | 'unauthorized'
 */
const emitter = new EventEmitter();

const state = {
  backend: { state: 'stopped', since: null, error: null },
  outputsCount: null,
  controllers: {}, // "host:porta" -> { connected, since }
};

function snapshot() {
  return JSON.parse(JSON.stringify(state));
}

function changed() {
  emitter.emit('change', snapshot());
}

function setBackend(backendState, error = null) {
  if (state.backend.state === backendState && state.backend.error === error) return;
  state.backend = { state: backendState, since: new Date().toISOString(), error };
  changed();
}

function setOutputsCount(count) {
  state.outputsCount = count;
  changed();
}

function setController(key, connected) {
  if (state.controllers[key]?.connected === connected) return;
  state.controllers[key] = { connected, since: new Date().toISOString() };
  changed();
}

function removeController(key) {
  delete state.controllers[key];
  changed();
}

module.exports = {
  snapshot,
  setBackend,
  setOutputsCount,
  setController,
  removeController,
  onChange: (listener) => emitter.on('change', listener),
};
