const outputsStore = require('./outputsStore');
const { getControllerConnection } = require('./controllerConnection');
const log = require('./log');

// As placas das cancelas são de impulso: cada pulso alterna abre/fecha.
// Por isso 'open' e 'close' mandam o MESMO pulso — quem garante que o
// pulso vai no sentido certo é o backend (só manda se o estado presumido
// for o oposto do pedido).
//
// Cancela dupla (ex.: Entrada = saídas 1 e 3): cada braço é pulsado
// SEPARADO, um depois do outro. Pulsar os dois no mesmo frame deixava um
// braço descendo enquanto o outro subia (teste em campo 2026-09-25); pulso
// de 1s por saída com ~2s de intervalo funcionou (teste em campo
// 2026-09-26, pela tela de teste por saída; Abrir/Fechar Entrada
// confirmado em 2026-09-28). Intervalo reduzido pra 1s a pedido do
// usuário — o braço da direita demorava a subir.
const PULSE_SECONDS = 1;
const INTERVAL_BETWEEN_OUTPUTS_MS = 1000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function handleCommand({ requestId, outputIds, action }, ws) {
  const outputs = outputIds.map((id) => outputsStore.getOutput(id));
  const missing = outputIds.filter((id, i) => !outputs[i]);
  if (missing.length > 0) {
    log.warn(`Comando referenciando outputId(s) não configurados neste gateway: ${missing.join(', ')}`);
    ws.send(JSON.stringify({ type: 'ack', requestId, ok: false, error: 'output not configured on this gateway' }));
    return;
  }

  // Ordem estável (saída 1 antes da 3), independente da ordem do backend.
  const ordered = outputs
    .map((output, i) => ({ output, outputId: outputIds[i] }))
    .sort((a, b) => a.output.outputNumber - b.output.outputNumber);

  const done = [];
  try {
    for (const [index, { output, outputId }] of ordered.entries()) {
      if (index > 0) await wait(INTERVAL_BETWEEN_OUTPUTS_MS);
      const { host, port, ns, outputNumber } = output;
      const connection = getControllerConnection(host, port, ns);
      await connection.pulseOutputs([outputNumber], PULSE_SECONDS, ns);
      log.info(`outputId=${outputId} (saída ${outputNumber}) ação=${action} -> pulso de ${PULSE_SECONDS}s enviado`);
      done.push(outputNumber);
    }
    ws.send(JSON.stringify({ type: 'ack', requestId, ok: true }));
  } catch (err) {
    // Falha no meio da sequência deixa a cancela dupla dessincronizada
    // (um braço já mudou) — o erro diz quais saídas já foram pulsadas, pra
    // corrigir pelo teste por saída.
    const partial = done.length > 0 ? ` (saída(s) ${done.join('+')} já pulsada(s))` : '';
    log.error(`outputIds=[${outputIds.join(',')}] ação=${action} falhou${partial}: ${err.message}`);
    ws.send(JSON.stringify({ type: 'ack', requestId, ok: false, error: `${err.message}${partial}` }));
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
