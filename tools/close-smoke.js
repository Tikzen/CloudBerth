'use strict';

const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configureWebContents } = require('../src/window');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudberth-close-test-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);

const config = {
  startUrl: 'https://example.com',
  startMode: 'windowed',
  stripElectronFromUserAgent: false,
  htmlFullscreenPolicy: 'block',
  enableDevTools: false
};
const logger = {
  info() {},
  warn() {},
  error() {}
};

app.whenReady().then(async () => {
  let internalNavigationRequested = false;
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  configureWebContents({
    webContents: window.webContents,
    window,
    app,
    config,
    persistentSession: session.defaultSession,
    logger,
    isMainWindow: true,
    shouldBypassUnload: () => internalNavigationRequested
  });

  const timeout = setTimeout(() => {
    console.error('FAIL: beforeunload prevented the BrowserWindow from closing.');
    app.exit(1);
  }, 5000);

  window.once('closed', () => {
    clearTimeout(timeout);
    console.log('PASS: explicit navigation and close bypassed page beforeunload handlers.');
    app.exit(0);
  });

  await window.loadURL(
    'data:text/html,<button id="activate">activate</button>'
  );
  await window.webContents.executeJavaScript(`
    window.addEventListener('beforeunload', (event) => {
      event.preventDefault();
      event.returnValue = '';
    });
    document.getElementById('activate').click();
  `, true);
  internalNavigationRequested = true;
  await window.loadURL(
    'data:text/html,<title>Internal navigation passed</title><button id="activate">activate</button>'
  );
  internalNavigationRequested = false;
  if (window.webContents.getTitle() !== 'Internal navigation passed') {
    throw new Error('Explicit internal navigation was blocked by beforeunload.');
  }
  await window.webContents.executeJavaScript(`
    window.addEventListener('beforeunload', (event) => {
      event.preventDefault();
      event.returnValue = '';
    });
    document.getElementById('activate').click();
  `, true);
  window.close();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
