/**
 * Protocolo ASCII proprietário da NSE (módulo MTCP-4E4S), validado contra
 * hardware real em 2026-09-14 (ver memória do projeto "gate-controller-project").
 * NÃO é Modbus. Frames delimitados por '<' e '>', texto puro exceto os 2
 * bytes de status da resposta, que são valores CRUS (0-15), não ASCII.
 */

const MODULE_ID = 'MTCPNSE014';
// Achado em produção (2026-09-14): sem enviar nada, o módulo derruba a
// conexão TCP a cada ~13,3s de ociosidade. O manual documenta este ID
// alternativo especificamente para manter a conexão viva ("não gera
// retorno") — ver buildKeepAliveFrame.
const KEEPALIVE_MODULE_ID = 'MTCPNSE900';
const OPEN_BRACKET = '<'.charCodeAt(0);
const CLOSE_BRACKET = '>'.charCodeAt(0);

/**
 * Monta um comando de 24 bytes. func: 2 chars ("00"=liga/desliga ou lê
 * status, "01"/"02"=pulso). byte13: 1 char (aciona='0', lê status='1', ou
 * tempo de pulso cru para func 01/02 — ver buildPulseCommand). outputs: 4
 * chars, um '0'/'1' por saída (saída 1 a 4). ns: 5 chars, serial do módulo.
 */
function buildCommand(func, byte13, outputs, ns) {
  if (func.length !== 2) throw new Error(`func precisa ter 2 chars: "${func}"`);
  if (byte13.length !== 1) throw new Error(`byte13 precisa ter 1 char: "${byte13}"`);
  if (outputs.length !== 4) throw new Error(`outputs precisa ter 4 chars: "${outputs}"`);
  if (ns.length !== 5) throw new Error(`ns precisa ter 5 chars: "${ns}"`);

  const frame = `<${MODULE_ID}${func}${byte13}${outputs}${ns}>`;
  if (frame.length !== 24) {
    throw new Error(`Frame com tamanho errado (${frame.length}, esperado 24): ${JSON.stringify(frame)}`);
  }
  return frame;
}

/**
 * Frame de keep-alive: mesmo formato de 24 bytes de um comando normal, só
 * trocando o ID do módulo por "MTCPNSE900" — o módulo reconhece esse ID
 * especificamente para resetar o timer de ociosidade, sem processar o resto
 * como comando de verdade ("não gera retorno", por isso o resto dos campos
 * é irrelevante; usamos função "00"/byte13="1" = "lê status", a opção sem
 * efeito colateral caso o módulo algum dia trate isso como comando real).
 */
function buildKeepAliveFrame(ns) {
  if (ns.length !== 5) throw new Error(`ns precisa ter 5 chars: "${ns}"`);
  const frame = `<${KEEPALIVE_MODULE_ID}0010000${ns}>`;
  if (frame.length !== 24) {
    throw new Error(`Frame de keep-alive com tamanho errado (${frame.length}, esperado 24): ${JSON.stringify(frame)}`);
  }
  return frame;
}

/**
 * O comando "aciona saídas" seta as 4 saídas de uma vez — por isso é preciso
 * partir do bitmask atual conhecido (currentBitmask, 0-15) e só virar os
 * bits pedidos, preservando os demais. Sem isso, acionar uma saída
 * desligaria de quebra qualquer outro relé cabeado no mesmo controlador.
 *
 * `outputNumbers` é um array (1 ou mais saídas, 1-4) — todas viram o MESMO
 * frame MTCP, ou seja, são acionadas literalmente ao mesmo tempo (não 2
 * comandos separados). É assim que a cancela de entrada (2 saídas) é
 * ligada/desligada em sincronia de verdade.
 */
function buildOutputsCommand(currentBitmask, outputNumbers, turnOn, ns) {
  let nextBitmask = currentBitmask;
  for (const outputNumber of outputNumbers) {
    if (outputNumber < 1 || outputNumber > 4) {
      throw new Error(`outputNumber precisa estar entre 1 e 4: ${outputNumber}`);
    }
    const bitIndex = outputNumber - 1;
    nextBitmask = turnOn ? nextBitmask | (1 << bitIndex) : nextBitmask & ~(1 << bitIndex);
  }

  let outputs = '';
  for (let i = 0; i < 4; i += 1) {
    outputs += (nextBitmask >> i) & 1 ? '1' : '0';
  }

  return buildCommand('00', '0', outputs, ns);
}

/**
 * Pulso (função "02", base de 1s): o módulo liga as saídas pedidas e as
 * desliga sozinho depois de `seconds` segundos. As placas das cancelas são
 * de impulso (cada pulso alterna abre/fecha, como uma botoeira) — confirmado
 * em campo em 2026-09-24 com o app antigo. O byte 13 é o tempo como byte CRU
 * (1-50), não o dígito ASCII — String.fromCharCode + escrita 'ascii' gera
 * exatamente esse byte. Saídas em '0' no frame não são pulsadas.
 */
function buildPulseCommand(outputNumbers, seconds, ns) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 50) {
    throw new Error(`seconds precisa ser inteiro entre 1 e 50: ${seconds}`);
  }
  const bits = ['0', '0', '0', '0'];
  for (const outputNumber of outputNumbers) {
    if (outputNumber < 1 || outputNumber > 4) {
      throw new Error(`outputNumber precisa estar entre 1 e 4: ${outputNumber}`);
    }
    bits[outputNumber - 1] = '1';
  }
  return buildCommand('02', String.fromCharCode(seconds), bits.join(''), ns);
}

/**
 * Parseia um frame de RETORNO completo (Buffer incluindo '<' e '>', 21
 * bytes: <MTCPNSE014e<byte><byte>r<serial(5)>>... — opera em Buffer, não
 * string, porque os 2 bytes de status (entradas/saídas) são valores crus
 * 0-15, não ASCII, e nunca colidem com os delimitadores '<'/'>' (0x3C/0x3E).
 * Retorna null se o frame não bater com o formato esperado.
 */
function parseResponseFrame(buffer) {
  if (buffer.length !== 21) return null;
  if (buffer[0] !== OPEN_BRACKET || buffer[20] !== CLOSE_BRACKET) return null;

  const id = buffer.toString('ascii', 1, 11);
  if (id !== MODULE_ID) return null;
  if (buffer[11] !== 'e'.charCodeAt(0)) return null;
  if (buffer[13] !== 'r'.charCodeAt(0)) return null;

  return {
    inputsBitmask: buffer[12],
    outputsBitmask: buffer[14],
    serial: buffer.toString('ascii', 15, 20),
  };
}

/**
 * Bufferiza chunks de TCP (que não garante fronteira de mensagem) e emite
 * frames completos delimitados por '<'/'>'. O módulo manda um frame
 * espontâneo a cada ~2s por cima de qualquer ack, então mais de um frame
 * pode chegar acumulado num único chunk.
 */
class FrameExtractor {
  constructor() {
    this._buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    const frames = [];

    let start = this._buffer.indexOf(OPEN_BRACKET);
    let end = start === -1 ? -1 : this._buffer.indexOf(CLOSE_BRACKET, start);
    while (start !== -1 && end !== -1) {
      frames.push(this._buffer.subarray(start, end + 1));
      this._buffer = this._buffer.subarray(end + 1);
      start = this._buffer.indexOf(OPEN_BRACKET);
      end = start === -1 ? -1 : this._buffer.indexOf(CLOSE_BRACKET, start);
    }

    return frames;
  }
}

module.exports = {
  MODULE_ID,
  KEEPALIVE_MODULE_ID,
  buildCommand,
  buildKeepAliveFrame,
  buildOutputsCommand,
  buildPulseCommand,
  parseResponseFrame,
  FrameExtractor,
};
