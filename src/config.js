require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name} (ver .env.example)`);
  }
  return value;
}

// Só o bootstrap pra falar com o backend. O mapeamento físico (IP/porta/
// número da saída/serial do controlador) NÃO vive mais aqui — o backend
// manda isso pelo próprio WebSocket assim que autentica (ver
// outputsStore.js e gatewayClient.js), pra não depender de editar um
// arquivo local na máquina do cliente toda vez que precisar reconfigurar.
module.exports = {
  backendWsUrl: required('BACKEND_WS_URL'),
  deviceToken: required('DEVICE_TOKEN'),
};
