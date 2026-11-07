'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, ipcMain, Menu, session } = require('electron');
const { loadConfig } = require('../src/config');
const { createLibraryStore } = require('../src/library');
const { createRuntime, installLauncherHandlers } = require('../src/runtime');
const { installApplicationMenu } = require('../src/platform');

assert.equal(process.platform, 'win32', 'Run test:win on Windows');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudberth-windows-test-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);
app.setAppPath(path.resolve(__dirname, '..'));
const logger = { info() {}, warn() {}, error: console.error };
const timer = setTimeout(() => { console.error('Windows shortcut test timed out'); app.exit(1); }, 45000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, description) {
  for (let i = 0; i < 180; i++) {
    if (await check()) return;
    await delay(30);
  }
  throw new Error(`Timed out: ${description}`);
}
function press(window, key, modifiers) {
  window.focus(); window.webContents.focus();
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
}

app.whenReady().then(async () => {
  const { config: manual } = loadConfig(app, { manualTest: true });
  const config = { ...manual, startMode: 'kiosk' };
  const library = createLibraryStore(app, config, logger, { allowFileUrl: true });
  assert.deepEqual(library.getShortcuts(), { toggleDisplay: 'Alt+Shift+F', quit: 'Alt+Q', home: 'Alt+Shift+H' });
  const runtime = createRuntime({ app, config, library, logger,
    persistentSession: session.fromPartition('persist:windows-test') });
  installLauncherHandlers({ app, ipcMain, runtime, logger,
    icons: { chooseAvatar: async () => null, getWebsiteIcon: async () => '' } });
  installApplicationMenu({ app, Menu, config, shortcuts: library.getShortcuts() });
  const launcher = runtime.launcher;
  const js = (script) => launcher.webContents.executeJavaScript(script, true);
  await launcher.ready;
  await until(async () => await js('Boolean(state.shortcuts.home)'), 'launcher state');
  assert(await js('document.querySelector("#shortcutHint").textContent.includes("Alt+Shift+F") && !document.querySelector("#shortcutHint").textContent.includes("Command")'));
  assert(await js('document.querySelector("[data-platform=darwin]").hidden && !document.querySelector("[data-platform=win32]").hidden'));

  const game = library.getGames()[0];
  await runtime.launchGame(game.id);
  const window = runtime.getGameWindow(game.id);
  await until(() => window.isKiosk() || window.isFullScreen(), 'immersive enter');
  press(window, 'Escape', []);
  await until(async () => (await window.webContents.executeJavaScript('document.querySelector("#escapeCount").textContent')) === '1', 'ESC reaches game');
  assert(window.isKiosk() || window.isFullScreen());
  press(window, 'f', ['alt', 'shift']);
  await until(() => !window.isKiosk() && !window.isFullScreen(), 'Alt+Shift+F exits');
  press(window, 'f', ['alt', 'shift']);
  await until(() => window.isKiosk() || window.isFullScreen(), 'Alt+Shift+F enters');
  await window.webContents.executeJavaScript('window.retainedState = 42');
  press(window, 'h', ['alt', 'shift']);
  await until(() => launcher.isVisible() && !window.isVisible(), 'Alt+Shift+H returns to library');
  assert.equal(await window.webContents.executeJavaScript('window.retainedState'), 42);

  await js('document.querySelector("#settingsButton").click(); document.querySelector("[data-shortcut=quit]").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))');
  await until(async () => await js('Boolean(document.querySelector(".is-recording"))'), 'quit recording');
  press(launcher, 'q', ['alt']);
  await until(async () => await js('recordingInput === null'), 'recording Alt+Q does not quit');
  await js('document.querySelector("[data-shortcut=quit]").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))');
  await until(async () => await js('Boolean(document.querySelector(".is-recording"))'), 'custom quit recording');
  press(launcher, 'k', ['alt']);
  await until(async () => await js('document.querySelector("[data-shortcut=quit]").value === "Alt+K"'), 'record custom quit');
  await js('document.querySelector("#shortcutForm").requestSubmit()');
  await until(() => library.getShortcuts().quit === 'Alt+K', 'save custom quit');
  assert(await js('document.querySelector("#shortcutHint").textContent.includes("Alt+K")'));
  await js('document.querySelector("[data-reset-shortcut=quit]").click()');
  await until(async () => await js('document.querySelector("[data-shortcut=quit]").value === "Alt+Q"'), 'restore Alt+Q');
  await js('document.querySelector("#shortcutForm").requestSubmit()');
  await until(() => library.getShortcuts().quit === 'Alt+Q', 'save restored quit');
  assert(await js('document.querySelector("#shortcutHint").textContent.includes("Alt+Q")'));
  app.once('before-quit', () => {
    clearTimeout(timer);
    console.log('PASS: Windows Alt fullscreen/home/quit shortcuts, ESC preservation, retained game state, recording protection, restore defaults and footer synchronization.');
  });
  press(launcher, 'q', ['alt']);
}).catch((error) => { console.error(error.stack || error.message); app.exit(1); });
