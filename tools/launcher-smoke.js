'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudberth-launcher-test-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);

const state = {
  version: 1,
  games: [{
    id: 'smoke-game',
    name: 'Smoke Test Game',
    url: 'https://example.com/play'
  }],
  shortcuts: {
    toggleDisplay: 'F11',
    quit: 'Ctrl+Shift+Q',
    home: 'Ctrl+Shift+H'
  }
};

ipcMain.handle('launcher:get-state', () => state);
ipcMain.handle('launcher:save-games', (_event, games) => ({ ...state, games }));
ipcMain.handle('launcher:save-shortcuts', (_event, shortcuts) => ({
  ...state,
  shortcuts
}));
ipcMain.handle('launcher:launch-game', () => true);
ipcMain.handle('launcher:quit', () => true);

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  await window.loadFile(
    path.join(__dirname, '..', 'src', 'launcher', 'index.html')
  );
  const result = await window.webContents.executeJavaScript(`({
    api: typeof window.cloudBerth,
    cards: document.querySelectorAll('.game-card').length,
    title: document.querySelector('.game-card h3')?.textContent,
    settingsInitiallyHidden: document.querySelector('#settingsSection').hidden
  })`, true);

  if (result.api !== 'object' ||
      result.cards !== 1 ||
      result.title !== 'Smoke Test Game' ||
      !result.settingsInitiallyHidden) {
    throw new Error(`Launcher UI assertion failed: ${JSON.stringify(result)}`);
  }

  await window.loadURL('data:text/html,<title>Remote</title>');
  const remoteApi = await window.webContents.executeJavaScript(
    'typeof window.cloudBerth',
    true
  );
  if (remoteApi !== 'undefined') {
    throw new Error('Launcher API was exposed to a remote page.');
  }

  console.log('PASS: launcher rendered and local API stayed isolated from remote pages.');
  window.destroy();
  app.exit(0);
}).catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  app.exit(1);
});
