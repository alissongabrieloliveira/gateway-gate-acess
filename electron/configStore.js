const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

/**
 * Config do app (URL do backend + token do gateway) em
 * %APPDATA%/<app>/config.json. O token fica cifrado com o safeStorage do
 * Electron (no Windows, DPAPI: só o mesmo usuário do Windows nesta máquina
 * consegue decifrar) — nunca em texto puro como no .env do modo terminal.
 */
const DEFAULT_BACKEND_WS_URL = 'wss://gate-acess-api-production.up.railway.app/ws/gateway';

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

/** { backendWsUrl, deviceToken } ou null se ainda não configurado. */
function load() {
  const raw = readRaw();
  if (!raw.backendWsUrl || !raw.deviceTokenEncrypted) return null;
  try {
    const deviceToken = safeStorage.decryptString(Buffer.from(raw.deviceTokenEncrypted, 'base64'));
    return { backendWsUrl: raw.backendWsUrl, deviceToken };
  } catch {
    // Config copiada de outra máquina/usuário: não decifra — pede de novo.
    return null;
  }
}

function backendWsUrlOrDefault() {
  return readRaw().backendWsUrl || DEFAULT_BACKEND_WS_URL;
}

/**
 * Valida e grava. `deviceToken` vazio mantém o token atual (troca só a URL).
 * Devolve a config completa para iniciar o gateway.
 */
function save({ backendWsUrl, deviceToken }) {
  const url = String(backendWsUrl || '').trim();
  if (!/^wss?:\/\/\S+$/.test(url)) {
    throw new Error('Endereço do sistema inválido — deve começar com wss:// (ou ws:// em testes).');
  }

  let token = String(deviceToken || '').trim();
  if (!token) {
    const current = load();
    if (!current) throw new Error('Informe o token do gateway.');
    token = current.deviceToken;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('O Windows não liberou a proteção de dados para guardar o token.');
  }

  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(
    configPath(),
    JSON.stringify(
      { backendWsUrl: url, deviceTokenEncrypted: safeStorage.encryptString(token).toString('base64') },
      null,
      2
    )
  );
  return { backendWsUrl: url, deviceToken: token };
}

module.exports = { load, save, backendWsUrlOrDefault };
