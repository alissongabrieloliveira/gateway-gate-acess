const { EventEmitter } = require('events');

/**
 * Log do gateway: escreve no console (modo terminal, `npm start`) e emite
 * cada linha como evento `entry` — o app Electron (electron/main.js) escuta
 * para mostrar na tela e gravar em arquivo.
 */
const emitter = new EventEmitter();

function timestamp() {
  return new Date().toISOString();
}

function format(args) {
  return args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
}

function write(level, consoleFn, args) {
  const time = timestamp();
  consoleFn(`[${time}]`, ...args);
  emitter.emit('entry', { time, level, message: format(args) });
}

module.exports = {
  info: (...args) => write('info', console.log, args),
  warn: (...args) => write('warn', console.warn, args),
  error: (...args) => write('error', console.error, args),
  onEntry: (listener) => emitter.on('entry', listener),
};
