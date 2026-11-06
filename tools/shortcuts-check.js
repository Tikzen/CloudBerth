'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { shortcutFromInput, installShortcuts, setDisplayMode, toggleDisplayMode } = require('../src/shortcuts');
const { installApplicationMenu } = require('../src/platform');

const logger = { info() {} };
const shortcuts = { toggleDisplay: 'Shift+Meta+F', home: 'Shift+Meta+H', quit: 'Meta+Q' };
assert.equal(shortcutFromInput({ key: '\u0006', code: 'KeyF', control: true, meta: true }), 'Ctrl+Meta+F');
assert.equal(shortcutFromInput({ key: '中', code: 'KeyH', shift: true, meta: true }), shortcuts.home);
assert.equal(shortcutFromInput({ key: 'Escape', code: 'Escape' }), null);

class TestWindow extends EventEmitter {
  full = false;
  kiosk = false;
  requests = [];
  homes = 0;
  isDestroyed() { return false; }
  isFullScreen() { return this.full; }
  isKiosk() { return this.kiosk; }
  setKiosk(value) { this.kiosk = value; }
  setFullScreen(value) { this.requests.push(value); }
  showLauncher() { this.homes++; }
  complete(value) {
    this.full = value;
    this.emit(value ? 'enter-full-screen' : 'leave-full-screen');
  }
}

if (process.platform === 'darwin') {
  const window = new TestWindow();
  setDisplayMode(window, 'kiosk', logger);
  assert.equal(window.kiosk, false, 'Mac immersive mode must leave native exit controls accessible');
  toggleDisplayMode(window, 'kiosk', logger);
  assert.deepEqual(window.requests, [true], 'Wait for AppKit before reversing a transition');
  window.complete(true);
  assert.deepEqual(window.requests, [true, false]);
  window.complete(false);
  assert.equal(window.full, false);
}

const contents = new EventEmitter();
contents.setIgnoreMenuShortcuts = () => {};
const window = new TestWindow();
let homes = 0;
installShortcuts(contents, window, { shortcuts }, {}, logger, { onHome: () => homes++ });
let prevented = false;
contents.emit('before-input-event', { preventDefault() { prevented = true; } },
  { type: 'keyDown', key: '中', code: 'KeyH', meta: true, shift: true });
assert.equal(homes, 1);
assert(prevented);
const recorder = new EventEmitter();
recorder.setIgnoreMenuShortcuts = () => {};
let captured;
let preventedRecord = false;
installShortcuts(recorder, window, { shortcuts }, { quit() { throw new Error('Recording must not quit the app'); } }, logger,
  { shouldSuspend: () => true, onCapture: (result) => { captured = result; } });
recorder.emit('before-input-event', { preventDefault() { preventedRecord = true; } },
  { type: 'keyDown', key: 'q', code: 'KeyQ', meta: true });
assert(preventedRecord);
assert.equal(captured.shortcut, 'Meta+Q');

let applicationMenu;
const Menu = {
  buildFromTemplate(template) { return template; },
  setApplicationMenu(menu) { applicationMenu = menu; }
};
const install = (keys) => installApplicationMenu({
  Menu, app: { quit() {} }, getWindow: () => window, shortcuts: keys, logger
}, 'darwin');
install(shortcuts);
let items = applicationMenu.flatMap((item) => item.submenu);
assert.equal(items.find((item) => item.id === 'shell-toggle-fullscreen').accelerator, 'Shift+Command+F');
const home = items.find((item) => item.id === 'shell-home');
assert.equal(home.accelerator, 'Shift+Command+H');
home.click();
assert.equal(window.homes, 1, 'Native home action must work without a renderer input event');
assert(items.find((item) => item.id === 'shell-exit-fullscreen'));
install({ ...shortcuts, home: 'Alt+Meta+H' });
items = applicationMenu.flatMap((item) => item.submenu);
assert.equal(items.find((item) => item.id === 'shell-home').accelerator, 'Alt+Command+H');
console.log('PASS: control/IME shortcut keys, native menu fallbacks, customization and queued Mac fullscreen exit.');
