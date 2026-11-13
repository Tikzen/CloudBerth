'use strict';

const { setDisplayMode, toggleDisplayMode } = require('./shortcuts');
const { MAC_SHORTCUT_DEFAULTS } = require('./library');
const { PRODUCT_NAME } = require('./identity');

function platformDefaults(defaults, platform = process.platform) {
  if (platform !== 'darwin') return { ...defaults };
  return {
    ...defaults,
    shortcuts: { ...MAC_SHORTCUT_DEFAULTS }
  };
}

function installApplicationMenu({
  Menu, app,
  onCheckUpdates = () => {},
  getWindow = () => null,
  config = { startMode: 'fullscreen' },
  shortcuts = platformDefaults({}, 'darwin').shortcuts,
  logger = { info() {} }
}, platform = process.platform) {
  if (platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const accelerator = (shortcut) => shortcut.split('+').map((key) => ({
    Meta: 'Command', ArrowUp: 'Up', ArrowDown: 'Down',
    ArrowLeft: 'Left', ArrowRight: 'Right'
  })[key] || key).join('+');
  const withWindow = (action) => () => {
    const window = getWindow();
    if (window && !window.isDestroyed()) action(window);
  };
  // Register shell actions with AppKit as well as before-input-event. Native
  // actions remain available when a game captures keyboard input.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: PRODUCT_NAME,
      submenu: [
        { role: 'about', label: `关于 ${PRODUCT_NAME}` },
        { id: 'shell-check-updates', label: '检查更新…', click: onCheckUpdates },
        { type: 'separator' },
        { id: 'shell-quit', label: `退出 ${PRODUCT_NAME}`,
          accelerator: accelerator(shortcuts.quit), click: () => app.quit() }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { id: 'shell-home', label: '返回游戏库',
          accelerator: accelerator(shortcuts.home),
          click: withWindow((window) => window.showLauncher()) },
        { type: 'separator' },
        { id: 'shell-toggle-fullscreen', label: '切换全屏',
          accelerator: accelerator(shortcuts.toggleDisplay),
          click: withWindow((window) => toggleDisplayMode(window, config.startMode, logger)) },
        { id: 'shell-exit-fullscreen', label: '退出全屏',
          click: withWindow((window) => setDisplayMode(window, 'windowed', logger)) }
      ]
    }
  ]));
  if (app.dock?.setMenu) {
    app.dock.setMenu(Menu.buildFromTemplate([
      { label: '返回游戏库', click: withWindow((window) => window.showLauncher()) },
      { label: '退出全屏', click: withWindow((window) => setDisplayMode(window, 'windowed', logger)) }
    ]));
  }
}

module.exports = { platformDefaults, installApplicationMenu };
