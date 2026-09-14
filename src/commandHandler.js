const outputsStore = require('./outputsStore');
const { getControllerConnection } = require('./controllerConnection');
const log = require('./log');

async function handleCommand({ requestId, outputIds, action }, ws) {
  const outputs = outputIds.map((id) => outputsStore.getOutput(id));
  const missing = outputIds.filter((id, i) => !outputs[i]);
  if (missing.length > 0) {
    log.warn(`Comando referenciando outputId(s) não configurados neste gateway: ${missing.join(', ')}`);
    ws.send(JSON.stringify({ type: 'ack', requestId, ok: false, error: 'output not configured on this gateway' }));
    return;
  }

  // Todas as saídas de uma mesma direção devem estar no mesmo controlador
  // físico pra serem acionadas de verdade ao mesmo tempo (1 único frame).
  const targets = new Set(outputs.map((o) => `${o.host}:${o.port}`));
  if (targets.size > 1) {
    log.error(`Comando com saídas em controladores diferentes (${[...targets].join(', ')}) — não é possível sincronizar`);
    ws.send(JSON.stringify({ type: 'ack', requestId, ok: false, error: 'outputs span multiple controllers' }));
    return;
  }

  const { host, port, ns } = outputs[0];
  const outputNumbers = outputs.map((o) => o.outputNumber);

  try {
    const connection = getControllerConnection(host, port, ns);
    const result = await connection.setOutputs(outputNumbers, action === 'open', ns);
    log.info(`outputIds=[${outputIds.join(',')}] (saídas ${outputNumbers.join('+')}) ação=${action} -> ${result.outputState}`);
    ws.send(JSON.stringify({ type: 'ack', requestId, ok: true, outputState: result.outputState }));
  } catch (err) {
    log.error(`outputIds=[${outputIds.join(',')}] ação=${action} falhou: ${err.message}`);
    ws.send(JSON.stringify({ type: 'ack', requestId, ok: false, error: err.message }));
  }
}

module.exports = { handleCommand };
