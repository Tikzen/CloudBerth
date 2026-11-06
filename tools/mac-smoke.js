'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, ipcMain, Menu, session } = require('electron');
const { loadConfig } = require('../src/config');
const { createLibraryStore } = require('../src/library');
const { installApplicationMenu } = require('../src/platform');
const { createRuntime, installLauncherHandlers } = require('../src/runtime');
const { configurePermissions } = require('../src/permissions');
const { setDisplayMode } = require('../src/shortcuts');

if (process.platform !== 'darwin') throw new Error('Run test:mac on macOS.');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudgameshell-mac-'));
app.setPath('userData', temp);
app.setAppPath(path.resolve(__dirname, '..'));
const logger = { info() {}, warn() {}, error: console.error };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = setTimeout(() => {
  console.error('FAIL: macOS integration test timed out.');
  app.exit(1);
}, 45000);

async function waitFor(check, description) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${description}`);
}

app.whenReady().then(async () => {
  const { config: defaults } = loadConfig(app);
  assert.equal(defaults.shortcuts.quit, 'Meta+Q');
  const { config: manual } = loadConfig(app, { manualTest: true });
  const config = { ...manual, startMode: 'kiosk' };
  const library = createLibraryStore(app, config, logger, { allowFileUrl: true });
  const persistentSession = session.fromPartition('persist:mac-smoke');
  configurePermissions(persistentSession, config, logger);
  const runtime = createRuntime({ app, config, persistentSession, logger, library });
  installLauncherHandlers({ ipcMain, runtime, app, logger,
    icons: { chooseAvatar: async () => null, getWebsiteIcon: async () => '' } });
  const launcher = runtime.launcher;
  await launcher.ready;
  const game = library.getGames()[0];
  await runtime.launchGame(game.id);
  const window = runtime.getGameWindow(game.id);
  installApplicationMenu({ app, Menu, config, logger, shortcuts: library.getShortcuts(), getWindow: () => runtime.getActionWindow() });
  assert.equal(Menu.getApplicationMenu().getMenuItemById('shell-home').accelerator, 'Shift+Command+H');
  assert.equal(Menu.getApplicationMenu().getMenuItemById('shell-toggle-fullscreen').accelerator, 'Shift+Command+F');
  await waitFor(() => window.isFullScreen(), 'Mac immersive fullscreen enter');
  assert(!window.isKiosk(), 'Mac must preserve its native exit controls');
  // isFullScreen changes before AppKit's transition animation finishes.
  await delay(1200);
  window.focus();
  window.webContents.focus();
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(async () => (await window.webContents.executeJavaScript(
    'document.getElementById("escapeCount").textContent'
  )) === '1', 'ESC reaches game');
  await delay(400);
  assert(window.isFullScreen(), 'ESC must reach the game without exiting native fullscreen');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'f', modifiers: ['shift', 'meta'] });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'f', modifiers: ['shift', 'meta'] });
  await waitFor(() => !window.isFullScreen(), 'Shift+Command+F exits fullscreen');
  await delay(1200);
  setDisplayMode(window, 'fullscreen', logger);
  await waitFor(() => window.isFullScreen(), 'fullscreen reenter');
  await delay(1200);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'h', modifiers: ['meta', 'shift'] });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'h', modifiers: ['meta', 'shift'] });
  await waitFor(() => !window.isVisible() && launcher.isVisible(), 'Command+Shift+H shows launcher and preserves game');
  assert.equal(window.webContents.getURL(), game.url);
  assert(runtime.getState().runningGameIds.includes(game.id));
  await waitFor(() => !window.isFullScreen() && !window.isKiosk(), 'return home exits fullscreen');
  await delay(1200);
  await runtime.launchGame(game.id);
  setDisplayMode(window, 'fullscreen', logger);
  await waitFor(() => window.isFullScreen(), 'fullscreen enter');
  await delay(1200);
  Menu.getApplicationMenu().getMenuItemById('shell-exit-fullscreen').click();
  await waitFor(() => !window.isFullScreen(), 'fullscreen exit');
  await delay(1200);
  await runtime.launchGame(game.id);
  setDisplayMode(window, 'fullscreen', logger);
  await waitFor(() => window.isFullScreen(), 'fullscreen for native home action');
  await delay(1200);
  Menu.getApplicationMenu().getMenuItemById('shell-home').click();
  await waitFor(() => !window.isVisible() && launcher.isVisible() && !window.isFullScreen(), 'native menu returns to separate launcher');
  assert(runtime.getState().runningGameIds.includes(game.id));
  await delay(1200);
  await runtime.stopGame(game.id);
  launcher.destroy();
  clearTimeout(timeout);
  console.log(`PASS: macOS ${process.arch}, Electron ${process.versions.electron}, Chromium ${process.versions.chrome}.`);
  console.log('PASS: native menu exit/home, Shift+Command+F, Command+Shift+H, persisted library and fullscreen ESC.');
  app.exit(0);
}).catch((error) => {
  console.error(error.stack || error);
  app.exit(1);
});

app.on('will-quit', () => {
  fs.rmSync(temp, { recursive: true, force: true });
});
