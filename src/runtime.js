'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow } = require('electron');
const { createMainWindow, createGameWindow } = require('./window');
const { setDisplayMode } = require('./shortcuts');
const { platformDefaults } = require('./platform');
const { SHORTCUT_ACTIONS } = require('./library');

function createRuntime({ app, config, persistentSession, logger, library, icons,
  showWindows = true, onShortcutsChanged = () => {} }) {
  const running = new Map();
  const iconJobs = new Set();
  let revision = 0;
  let quitting = false;
  let lastGame = null;
  const launcherPath = path.join(app.getAppPath(), 'src/launcher/index.html');
  const launcher = createMainWindow({
    app, config, persistentSession, logger, library, launcherPath,
    show: showWindows, onClose: () => !quitting && running.size > 0
  });
  const defaultShortcuts = platformDefaults(require('../config.default.json')).shortcuts;
  const snapshot = () => ({ ...library.getState(), defaultShortcuts: { ...defaultShortcuts }, revision, runningGameIds: [...running.keys()] });
  const notify = () => {
    revision++;
    if (!launcher.isDestroyed()) {
      launcher.webContents.send('launcher:state-changed', snapshot());
    }
  };
  launcher.webContents.on('did-finish-load', notify);
  const beforeQuit = () => { quitting = true; };
  app.on('before-quit', beforeQuit);
  launcher.once('closed', () => app.removeListener('before-quit', beforeQuit));

  function showLauncher(fromGame = null) {
    if (launcher.isDestroyed()) return;
    if (fromGame && !fromGame.isDestroyed()) {
      const afterExit = () => {
        if (!fromGame.isDestroyed()) fromGame.hide();
        if (!launcher.isDestroyed()) launcher.showLauncher();
      };
      if (fromGame.isFullScreen() || fromGame.isKiosk()) {
        fromGame.once('leave-full-screen', afterExit);
        setDisplayMode(fromGame, 'windowed', logger);
      } else {
        setDisplayMode(fromGame, 'windowed', logger);
        fromGame.hide();
      }
    }
    if (showWindows) launcher.showLauncher();
  }

  async function updateIcon(game, candidates = null) {
    const jobKey = `${game.id}:${game.url}`;
    if (!icons || (!candidates && game.siteIcon) || iconJobs.has(jobKey)) return;
    iconJobs.add(jobKey);
    try {
      const icon = await icons.getWebsiteIcon(game.url, { candidates, refresh: Boolean(candidates) });
      if (icon && library.setSiteIcon(game.id, game.url, icon)) notify();
    } catch (error) { logger.warn('Website icon unavailable', { host: new URL(game.url).hostname }); }
    finally { iconJobs.delete(jobKey); }
  }
  async function refreshIcons() {
    const games = library.getGames();
    // Bounded concurrency; game launch never waits for website metadata.
    let index = 0;
    await Promise.all([0, 1].map(async () => {
      while (index < games.length) await updateIcon(games[index++]);
    }));
  }

  const runtime = {
    launcher,
    launcherUrl: pathToFileURL(launcherPath).href,
    getState: snapshot,
    getGameWindow: (id) => running.get(id) || null,
    getActionWindow() {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused && !focused.isDestroyed()) return focused.gameWindow || focused;
      return lastGame && !lastGame.isDestroyed() ? lastGame : launcher;
    },
    showLauncher,
    refreshIcons,
    async launchGame(id) {
      const game = library.getGames().find((item) => item.id === id);
      if (!game) throw new Error('找不到这个游戏，它可能已被删除。');
      let window = running.get(id);
      if (window && !window.isDestroyed()) {
        if (showWindows) {
          if (window.isMinimized()) window.restore();
          window.show(); window.focus();
        }
        return snapshot();
      }
      logger.info('Opening separate game window', { gameId: id, host: new URL(game.url).hostname });
      window = createGameWindow({
        app, config, persistentSession, logger, library, game,
        show: showWindows, onHome: showLauncher,
        onFavicon: (urls) => { void updateIcon(game, urls); }
      });
      running.set(id, window);
      lastGame = window;
      window.on('focus', () => { lastGame = window; });
      window.once('closed', () => {
        if (running.get(id) === window) running.delete(id);
        if (lastGame === window) lastGame = null;
        notify();
        if (!quitting && showWindows && running.size === 0 && !launcher.isDestroyed()) launcher.showLauncher();
      });
      notify();
      try { await window.ready; }
      catch (error) {
        if (window.isDestroyed()) return snapshot();
        if (!window.isDestroyed()) window.destroy();
        throw new Error(`游戏页面打开失败：${error.message}`);
      }
      return snapshot();
    },
    stopGame(id) {
      const window = running.get(id);
      if (!window || window.isDestroyed()) return Promise.resolve(snapshot());
      return new Promise((resolve) => {
        window.once('closed', () => resolve(snapshot()));
        // configureWebContents bypasses beforeunload for explicit closes.
        window.close();
      });
    },
    saveGames(games) {
      for (const [id] of running) {
        const old = library.getGames().find((game) => game.id === id);
        const next = Array.isArray(games) && games.find((game) => game.id === id);
        if (!next || next.url !== old.url) throw new Error('请先结束正在运行的游戏，再删除入口或更改网址。');
      }
      library.saveGames(games);
      notify();
      void refreshIcons();
      return snapshot();
    },
    saveShortcuts(shortcuts) {
      library.saveShortcuts(shortcuts);
      onShortcutsChanged();
      notify();
      return snapshot();
    }
  };
  return runtime;
}

function installLauncherHandlers({ ipcMain, runtime, icons, app, logger, updates }) {
  const isTrustedSender = (event) => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || event.sender !== runtime.launcher.webContents) return false;
    return frame.url.split('#')[0] === runtime.launcherUrl;
  };
  const trusted = (handler) => async (event, ...args) => {
    if (!isTrustedSender(event)) {
      logger.warn('Rejected launcher IPC from untrusted page');
      throw new Error('此操作只允许从 CloudBerth 主页执行。');
    }
    return handler(...args);
  };
  ipcMain.handle('launcher:get-state', trusted(runtime.getState));
  ipcMain.handle('launcher:save-games', trusted(runtime.saveGames));
  ipcMain.handle('launcher:save-shortcuts', trusted(runtime.saveShortcuts));
  ipcMain.handle('launcher:launch-game', trusted(runtime.launchGame));
  ipcMain.handle('launcher:stop-game', trusted(runtime.stopGame));
  ipcMain.handle('launcher:choose-avatar', trusted(() => icons.chooseAvatar(runtime.launcher)));
  ipcMain.handle('launcher:fetch-icon', trusted((url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('请输入有效的 HTTPS 游戏网址。');
    return icons.getWebsiteIcon(parsed.href, { refresh: true });
  }));
  ipcMain.handle('launcher:set-shortcut-capture', trusted((active, action) => {
    if (active && !SHORTCUT_ACTIONS.includes(action)) throw new Error('请选择要录入的快捷键。');
    if (runtime.launcher.isDestroyed()) return false;
    return runtime.launcher.setShortcutCapture(Boolean(active), action);
  }));
  if (updates) {
    ipcMain.handle('updates:get-state', trusted(updates.getState));
    ipcMain.handle('updates:check', trusted(() => updates.check('manual')));
    ipcMain.handle('updates:download', trusted(updates.download));
    ipcMain.handle('updates:cancel', trusted(updates.cancel));
    ipcMain.handle('updates:skip', trusted(updates.skip));
    ipcMain.handle('updates:restart', trusted(() => {
      if (runtime.getState().runningGameIds.length) throw new Error('请先结束正在运行的游戏，再重启更新。');
      return updates.restart();
    }));
  }
  ipcMain.handle('launcher:quit', trusted(() => { app.quit(); return true; }));
}

module.exports = { createRuntime, installLauncherHandlers };
