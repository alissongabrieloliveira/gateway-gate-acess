const outputsStore = require('./outputsStore');
const { getControllerConnection } = require('./controllerConnection');
const log = require('./log');

// As placas das cancelas são de impulso: cada pulso alterna abre/fecha.
// Por isso 'open' e 'close' mandam o MESMO pulso — quem garante que o
// pulso vai no sentido certo é o backend (só manda se o estado presumido
// for o oposto do pedido). 5s = mesmo tempo do app antigo, testado em campo.
const PULSE_SECONDS = 5;

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
    await connection.pulseOutputs(outputNumbers, PULSE_SECONDS, ns);
    log.info(`outputIds=[${outputIds.join(',')}] (saídas ${outputNumbers.join('+')}) ação=${action} -> pulso de ${PULSE_SECONDS}s enviado`);
    ws.send(JSON.stringify({ type: 'ack', requestId, ok: true }));
  } catch (err) {
    log.error(`outputIds=[${outputIds.join(',')}] ação=${action} falhou: ${err.message}`);
    ws.send(JSON.stringify({ type: 'ack', requestId, ok: false, error: err.message }));
  }
}

const TEST_MODES = ['pulse', 'on', 'off'];

/**
 * Teste de UMA saída avulsa (tela de diagnóstico, só admin): pulso com
 * tempo escolhido, ou liga/desliga sustentado. Serve pra acionar cada braço
 * da Entrada separadamente em campo — não mexe no fluxo normal das cancelas.
 */
async function handleOutputTest({ requestId, outputId, mode, seconds }, ws) {
  const reply = (payload) => ws.send(JSON.stringify({ type: 'ack', requestId, ...payload }));

  const output = outputsStore.getOutput(outputId);
  if (!output) {
    log.warn(`Teste referenciando outputId não configurado neste gateway: ${outputId}`);
    reply({ ok: false, error: 'output not configured on this gateway' });
    return;
  }
  if (!TEST_MODES.includes(mode)) {
    reply({ ok: false, error: `invalid test mode: ${mode}` });
    return;
  }

  const { host, port, ns, outputNumber } = output;
  try {
    const connection = getControllerConnection(host, port, ns);
    if (mode === 'pulse') {
      await connection.pulseOutputs([outputNumber], seconds, ns);
    } else {
      await connection.setOutputs([outputNumber], mode === 'on', ns);
    }
    log.info(`[teste] saída ${outputNumber} (outputId=${outputId}) modo=${mode}${mode === 'pulse' ? ` ${seconds}s` : ''} enviado`);
    reply({ ok: true });
  } catch (err) {
    log.error(`[teste] saída ${outputNumber} (outputId=${outputId}) modo=${mode} falhou: ${err.message}`);
    reply({ ok: false, error: err.message });
  }
}

module.exports = { handleCommand, handleOutputTest };
