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

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudgameshell-shortcuts-'));
app.setPath('userData', temp);
app.setAppPath(path.resolve(__dirname, '..'));
const logger = { info() {}, warn() {}, error: console.error };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('FAIL: shortcut integration timed out'); app.exit(1); }, 30000);
async function until(check, name) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await delay(30);
  }
  throw new Error(`Timed out: ${name}`);
}

app.whenReady().then(async () => {
  const { config } = loadConfig(app, { manualTest: true });
  const library = createLibraryStore(app, config, logger, { allowFileUrl: true });
  let runtime;
  const refresh = () => installApplicationMenu({ app, Menu, config, logger,
    shortcuts: library.getShortcuts(), getWindow: () => runtime.getActionWindow() });
  runtime = createRuntime({ app, config, library, logger,
    persistentSession: session.fromPartition('persist:shortcut-test'), onShortcutsChanged: refresh });
  installLauncherHandlers({ app, ipcMain, runtime, logger,
    icons: { chooseAvatar: async () => null, getWebsiteIcon: async () => '' } });
  refresh();
  const window = runtime.launcher;
  const js = (script) => window.webContents.executeJavaScript(script, true);
  await window.ready;
  await until(async () => await js('Boolean(state.shortcuts.toggleDisplay)'), 'initial shortcut state');
  window.focus(); window.webContents.focus();
  await js('document.querySelector("#settingsButton").click()');
  const value = (action) => js(`document.querySelector('[data-shortcut="${action}"]').value`);
  const press = (key, modifiers = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
  };
  const record = async (action, key, modifiers, expected) => {
    await js(`document.querySelector('[data-shortcut="${action}"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await until(async () => await js(`document.querySelector('[data-shortcut="${action}"]').parentElement.classList.contains('is-recording')`), 'double-click arms recording');
    press(key, modifiers);
    await until(async () => (await value(action)) === expected && await js('recordingInput === null'), 'native shortcut captured');
  };
  const save = async () => {
    await js('document.querySelector("#shortcutForm").requestSubmit()');
    await until(async () => await js('document.querySelector("#shortcutMessage").textContent === "已保存，立即生效。"'), 'save shortcuts');
  };

  const original = await value('toggleDisplay');
  await js('document.querySelector("[data-shortcut=toggleDisplay]").focus()');
  press('F10');
  await delay(100);
  assert.equal(await value('toggleDisplay'), original, 'Single-click focus must not start recording');

  await record('toggleDisplay', 'f', ['shift', 'meta'], 'Shift+Command+F');
  assert(!window.isFullScreen(), 'Recording the currently assigned fullscreen key must not execute it');
  await record('toggleDisplay', 'g', ['shift', 'meta'], 'Shift+Command+G');
  await record('home', 'j', ['shift', 'meta'], 'Shift+Command+J');
  await save();
  assert.equal(library.getShortcuts().toggleDisplay, 'Shift+Meta+G');
  assert.equal(library.getShortcuts().home, 'Shift+Meta+J');
  assert.equal(Menu.getApplicationMenu().getMenuItemById('shell-toggle-fullscreen').accelerator, 'Shift+Command+G');
  assert.equal(Menu.getApplicationMenu().getMenuItemById('shell-home').accelerator, 'Shift+Command+J');
  assert(await js('document.querySelector("#shortcutHint").textContent.includes("⇧⌘G") && document.querySelector("#shortcutHint").textContent.includes("⇧⌘J")'));
  assert.deepEqual(createLibraryStore(app, config, logger, { allowFileUrl: true }).getShortcuts(), library.getShortcuts());

  await js('document.querySelector("[data-shortcut=home]").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))');
  await until(async () => await js('recordingInput?.dataset.shortcut === "home" && document.querySelector(".is-recording") !== null'), 'cancel recording armed');
  press('Escape');
  await until(async () => await js('recordingInput === null'), 'Escape cancels');
  assert.equal(await value('home'), 'Shift+Command+J');

  // Use the already assigned quit key while recording; the test must stay alive.
  await record('quit', 'q', ['meta'], 'Command+Q');
  assert(!window.isDestroyed());
  await record('quit', 'k', ['shift', 'meta'], 'Shift+Command+K');
  await save();
  assert.equal(Menu.getApplicationMenu().getMenuItemById('shell-quit').accelerator, 'Shift+Command+K');
  assert.equal(Menu.getApplicationMenu().getMenuItemById('shell-quit').label, '退出 CloudBerth');
  assert(await js('document.querySelector("#shortcutHint").textContent.includes("⇧⌘K")'));
  await js('document.querySelector("[data-reset-shortcut=toggleDisplay]").click()');
  await until(async () => (await value('toggleDisplay')) === 'Shift+Command+F', 'reset fullscreen');
  await js('document.querySelector("[data-reset-shortcut=home]").click()');
  await until(async () => (await value('home')) === 'Shift+Command+H', 'reset home');
  await js('document.querySelector("[data-reset-shortcut=quit]").click()');
  await until(async () => (await value('quit')) === 'Command+Q', 'reset quit');
  await save();
  assert.equal(Menu.getApplicationMenu().getMenuItemById('shell-toggle-fullscreen').accelerator, 'Shift+Command+F');
  assert.equal(Menu.getApplicationMenu().getMenuItemById('shell-home').accelerator, 'Shift+Command+H');
  assert.equal(Menu.getApplicationMenu().getMenuItemById('shell-quit').accelerator, 'Command+Q');
  assert(await js('document.querySelector(".brand").textContent.trim() === "CloudBerth" && document.title === "CloudBerth"'));
  assert(await js('document.querySelector("#shortcutHint").textContent.includes("⇧⌘F") && document.querySelector("#shortcutHint").textContent.includes("⇧⌘H")'));
  assert.deepEqual(createLibraryStore(app, config, logger, { allowFileUrl: true }).getShortcuts(), runtime.getState().defaultShortcuts);

  fs.mkdirSync(path.join(app.getAppPath(), 'tmp'), { recursive: true });
  window.setContentSize(800, 450);
  await js('Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))');
  fs.writeFileSync(path.join(app.getAppPath(), 'tmp/shortcut-settings-fixed.png'), (await window.webContents.capturePage()).toPNG());
  assert(await js('document.querySelector("#shortcutForm button[type=submit]").getBoundingClientRect().bottom <= innerHeight'));
  await js('document.querySelector("#settingsCloseButton").click()');
  press('f', ['shift', 'meta']);
  await until(() => window.isFullScreen(), 'new fullscreen shortcut works');
  await delay(1000);
  press('f', ['shift', 'meta']);
  await until(() => !window.isFullScreen(), 'new fullscreen shortcut exits');
  await delay(1000);
  window.destroy();
  clearTimeout(timeout);
  console.log('PASS: double-click native recording, single-click inert, Escape cancel and quit-key recording protection.');
  console.log('PASS: save/reset persistence, footer hints, native Mac menu accelerators and Shift+Command+F fullscreen.');
  app.exit(0);
}).catch((error) => { console.error(error.stack || error); app.exit(1); });
