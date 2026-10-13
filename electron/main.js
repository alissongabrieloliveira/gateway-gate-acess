const path = require('path');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const gatewayClient = require('../src/gatewayClient');
const status = require('../src/status');
const log = require('../src/log');
const configStore = require('./configStore');
const logFile = require('./logFile');

/**
 * App do gateway para a máquina da portaria: o porteiro abre no início do
 * expediente e fecha no fim. Roda o mesmo núcleo do modo terminal
 * (src/gatewayClient.js) dentro do processo principal do Electron; a janela
 * só mostra status, eventos e a configuração (URL do sistema + token).
 */
const MAX_LOG_ENTRIES = 300;
const recentLogs = [];
let mainWindow = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  // Já tem um gateway aberto: dois conectados com o mesmo token brigariam
  // pela conexão com o backend e com a controladora.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(onReady);
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function startGateway(config) {
  log.info('Iniciando gateway — conectando ao sistema...');
  gatewayClient.start(config);
}

async function stopGateway() {
  try {
    await gatewayClient.stop();
  } catch (err) {
    log.error(`Erro ao encerrar: ${err.message}`);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    title: `Gateway das Cancelas ${app.getVersion()}`,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Links externos nunca abrem dentro do app.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  mainWindow.on('close', async (event) => {
    if (quitting) return;
    event.preventDefault();
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Encerrar o gateway', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Encerrar o gateway?',
      message: 'Encerrar o gateway das cancelas?',
      detail: 'Enquanto ele estiver fechado, as cancelas não abrem pelo sistema. Feche só no fim do expediente.',
    });
    if (response !== 0) return;
    quitting = true;
    send('app:closing');
    await stopGateway();
    app.quit();
  });

  // Windows desligando ou fazendo logoff com o app aberto: avisa o backend
  // do mesmo jeito (melhor esforço — o Windows não espera muito).
  mainWindow.on('session-end', () => {
    quitting = true;
    stopGateway();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function onReady() {
  Menu.setApplicationMenu(null);
  logFile.removeOld();

  log.onEntry((entry) => {
    recentLogs.push(entry);
    if (recentLogs.length > MAX_LOG_ENTRIES) recentLogs.shift();
    logFile.append(entry);
    send('log:entry', entry);
  });
  status.onChange((snapshot) => send('status:change', snapshot));

  ipcMain.handle('app:get-state', () => ({
    version: app.getVersion(),
    configured: Boolean(configStore.load()),
    backendWsUrl: configStore.backendWsUrlOrDefault(),
    status: status.snapshot(),
    logs: recentLogs,
  }));

  ipcMain.handle('config:save', async (_event, input) => {
    try {
      const config = configStore.save(input || {});
      await stopGateway();
      log.info('Configuração salva');
      startGateway(config);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('logs:open-folder', () => shell.openPath(logFile.logsDir()));

  createWindow();

  const config = configStore.load();
  if (config) {
    startGateway(config);
  } else {
    log.warn('Gateway ainda não configurado — informe o endereço do sistema e o token.');
  }

  captureForDevelopment();
}

app.on('window-all-closed', () => app.quit());

// Só desenvolvimento: GATEWAY_CAPTURE=<arquivo.png> salva um print da janela e
// fecha o app (sem a pergunta de confirmação) — usado para conferir a tela
// sem abrir o app à mão.
function captureForDevelopment() {
  const target = process.env.GATEWAY_CAPTURE;
  if (!target) return;
  setTimeout(async () => {
    const image = await mainWindow.webContents.capturePage();
    require('fs').writeFileSync(target, image.toPNG());
    quitting = true;
    await stopGateway();
    app.quit();
  }, Number(process.env.GATEWAY_CAPTURE_DELAY_MS) || 3000);
}
