const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Log em arquivo, um por dia: %APPDATA%/<app>/logs/gateway-AAAA-MM-DD.log.
 * Guarda 30 dias — serve para investigar depois um problema relatado pela
 * portaria ("a cancela não abriu ontem às 15h").
 */
const KEEP_DAYS = 30;

function logsDir() {
  return path.join(app.getPath('userData'), 'logs');
}

function fileFor(date) {
  return path.join(logsDir(), `gateway-${date.toISOString().slice(0, 10)}.log`);
}

function append({ time, level, message }) {
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    fs.appendFileSync(fileFor(new Date(time)), `${time} [${level.toUpperCase()}] ${message}\n`);
  } catch {
    // Disco cheio/sem permissão não pode derrubar o gateway.
  }
}

function removeOld() {
  try {
    const limit = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(logsDir())) {
      const match = /^gateway-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
      if (match && new Date(match[1]).getTime() < limit) fs.unlinkSync(path.join(logsDir(), name));
    }
  } catch {
    // Pasta ainda não existe.
  }
}

module.exports = { append, removeOld, logsDir };
