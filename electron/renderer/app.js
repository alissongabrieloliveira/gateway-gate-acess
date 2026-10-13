// Tela do app do gateway. Só lê o estado e os eventos que o processo
// principal manda (electron/preload.js) — toda a lógica fica em src/.
const MAX_EVENTS_SHOWN = 200;

const $ = (id) => document.getElementById(id);
let configured = false;
let closing = false;
let currentStatus = null;

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR');
}

function formatSince(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? `desde ${formatTime(iso)}` : `desde ${date.toLocaleString('pt-BR')}`;
}

// O aviso principal: o que o porteiro precisa saber de relance.
function bannerFor(status) {
  if (closing) return ['neutral', 'Encerrando…', 'Avisando o sistema que o gateway foi fechado.'];
  if (!configured) {
    return ['warn', 'Gateway não configurado', 'Informe o endereço do sistema e o token em Configurações.'];
  }
  const { backend, outputsCount, controllers } = status;
  if (backend.state === 'unauthorized') {
    return [
      'bad',
      'Token recusado pelo sistema',
      'O gateway pode ter sido revogado. Peça ao administrador um token novo e informe em Configurações.',
    ];
  }
  if (backend.state === 'connecting' || backend.state === 'stopped') {
    return ['warn', 'Conectando ao sistema…', ''];
  }
  if (backend.state === 'disconnected') {
    return ['bad', 'Sem conexão com o sistema', 'Tentando de novo automaticamente. Verifique a internet desta máquina.'];
  }
  if (outputsCount === null) return ['warn', 'Conectado — aguardando a configuração das cancelas', ''];
  if (outputsCount === 0) {
    return ['warn', 'Nenhuma cancela configurada no sistema', 'O administrador configura em Controle de Portões.'];
  }
  const list = Object.values(controllers);
  if (list.length === 0 || list.some((c) => !c.connected)) {
    return [
      'bad',
      'Sem conexão com a controladora das cancelas',
      'Tentando de novo. Verifique se a controladora está ligada e na rede.',
    ];
  }
  return ['ok', 'Funcionando — cancelas prontas', 'Pode deixar esta janela aberta (ou minimizada) até o fim do expediente.'];
}

const BACKEND_LABELS = {
  stopped: ['Parado', 'state-warn'],
  connecting: ['Conectando…', 'state-warn'],
  connected: ['Conectado', 'state-ok'],
  disconnected: ['Sem conexão', 'state-bad'],
  unauthorized: ['Token recusado', 'state-bad'],
};

function renderStatus(status) {
  currentStatus = status;
  const [tone, title, detail] = bannerFor(status);
  $('banner').className = `banner ${tone}`;
  $('banner-title').textContent = title;
  $('banner-detail').textContent = detail;

  const [label, cls] = BACKEND_LABELS[status.backend.state] ?? [status.backend.state, ''];
  $('backend-state').textContent = label;
  $('backend-state').className = `value ${cls}`;
  $('backend-since').textContent = configured ? formatSince(status.backend.since) : '';

  const controllers = $('controllers');
  controllers.replaceChildren();
  const entries = Object.entries(status.controllers);
  if (entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Aguardando a configuração do sistema';
    controllers.append(li);
  }
  for (const [address, controller] of entries) {
    const li = document.createElement('li');
    const state = document.createElement('strong');
    state.className = controller.connected ? 'state-ok' : 'state-bad';
    state.textContent = controller.connected ? 'Conectada' : 'Sem conexão';
    li.append(state, ` · ${address} `);
    const since = document.createElement('span');
    since.className = 'muted';
    since.textContent = formatSince(controller.since);
    li.append(since);
    controllers.append(li);
  }

  $('outputs-count').textContent = status.outputsCount ?? '—';
}

function addEvent(entry) {
  const li = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = formatTime(entry.time);
  const message = document.createElement('span');
  message.className = entry.level;
  message.textContent = entry.message;
  li.append(time, message);
  const list = $('events');
  list.prepend(li);
  while (list.children.length > MAX_EVENTS_SHOWN) list.lastElementChild.remove();
}

function showConfig(show) {
  $('config').classList.toggle('hidden', !show);
  $('config-error').classList.add('hidden');
  $('device-token').value = '';
  $('token-hint').textContent = configured
    ? 'Deixe em branco para manter o token atual.'
    : 'Cole aqui o token mostrado no sistema ao provisionar o gateway.';
  $('device-token').required = !configured;
  $('cancel-config').classList.toggle('hidden', !configured);
}

async function init() {
  const state = await window.gateway.getState();
  configured = state.configured;
  $('version').textContent = state.version;
  $('backend-url').value = state.backendWsUrl;
  for (const entry of state.logs) addEvent(entry);
  renderStatus(state.status);
  showConfig(!configured);

  window.gateway.onStatus(renderStatus);
  window.gateway.onLog(addEvent);
  window.gateway.onClosing(() => {
    closing = true;
    renderStatus(currentStatus);
  });

  $('toggle-config').addEventListener('click', () => showConfig($('config').classList.contains('hidden')));
  $('cancel-config').addEventListener('click', () => showConfig(false));
  $('open-logs').addEventListener('click', () => window.gateway.openLogsFolder());

  $('config-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await window.gateway.saveConfig({
      backendWsUrl: $('backend-url').value,
      deviceToken: $('device-token').value,
    });
    if (!result.ok) {
      $('config-error').textContent = result.error;
      $('config-error').classList.remove('hidden');
      return;
    }
    configured = true;
    showConfig(false);
    renderStatus(currentStatus);
  });
}

init();
