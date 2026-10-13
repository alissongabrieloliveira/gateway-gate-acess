/**
 * Só o bootstrap pra falar com o backend. O mapeamento físico (IP/porta/
 * número da saída/serial do controlador) NÃO vive aqui — o backend manda
 * isso pelo próprio WebSocket assim que autentica (ver outputsStore.js e
 * gatewayClient.js), pra não depender de editar nada na máquina do cliente
 * toda vez que precisar reconfigurar.
 *
 * Modo terminal (`npm start`): lê do .env. No app Electron a config vem da
 * tela de configuração (electron/configStore.js), não daqui.
 */
function loadFromEnv() {
  require('dotenv').config();

  function required(name) {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Variável de ambiente obrigatória ausente: ${name} (ver .env.example)`);
    }
    return value;
  }

  return {
    backendWsUrl: required('BACKEND_WS_URL'),
    deviceToken: required('DEVICE_TOKEN'),
  };
}

module.exports = { loadFromEnv };
