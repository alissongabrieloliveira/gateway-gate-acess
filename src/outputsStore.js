const { getControllerConnection } = require('./controllerConnection');
const log = require('./log');

let outputsById = new Map();

function validateOutput(output, index) {
  const prefix = `config recebida do backend, item ${index}`;
  if (!Number.isInteger(output.outputId) || output.outputId <= 0) {
    throw new Error(`${prefix}: "outputId" precisa ser um inteiro positivo`);
  }
  if (typeof output.host !== 'string' || output.host.trim().length === 0) {
    throw new Error(`${prefix}: "host" precisa ser uma string não vazia`);
  }
  if (!Number.isInteger(output.port) || output.port < 1 || output.port > 65535) {
    throw new Error(`${prefix}: "port" precisa ser um inteiro entre 1 e 65535`);
  }
  if (!Number.isInteger(output.outputNumber) || output.outputNumber < 1 || output.outputNumber > 4) {
    throw new Error(`${prefix}: "outputNumber" precisa ser um inteiro entre 1 e 4`);
  }
  if (typeof output.ns !== 'string' || output.ns.length !== 5) {
    throw new Error(`${prefix}: "ns" precisa ser uma string com exatamente 5 caracteres`);
  }
}

/**
 * Chamado quando a mensagem `{type:'config', outputs}` chega pelo
 * WebSocket (ver gatewayClient.js) — substitui a config em memória e
 * garante 1 controllerConnection por controlador físico único
 * (host:porta), criando-as sob demanda em vez de num boot estático.
 */
function setOutputs(outputs) {
  outputs.forEach(validateOutput);
  outputsById = new Map(outputs.map((o) => [o.outputId, o]));

  const seen = new Set();
  for (const output of outputs) {
    const key = `${output.host}:${output.port}`;
    if (!seen.has(key)) {
      seen.add(key);
      getControllerConnection(output.host, output.port, output.ns);
    }
  }

  log.info(`Config recebida do backend: ${outputs.length} saída(s), ${seen.size} controlador(es) único(s)`);
}

function getOutput(outputId) {
  return outputsById.get(outputId);
}

module.exports = { setOutputs, getOutput };
