'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { BrowserWindow, screen } = require('electron');
const { installShortcuts, setDisplayMode } = require('./shortcuts');
const { PRODUCT_NAME } = require('./identity');

const DEFAULT_BOUNDS = Object.freeze({ width: 1280, height: 720 });

function normalizeLocalPath(filePath, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const resolved = pathApi.resolve(filePath);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function fileUrlToLocalPath(candidateUrl, platform = process.platform) {
  if (typeof candidateUrl !== 'string' || !candidateUrl) return null;
  let parsed;
  try {
    parsed = new URL(candidateUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'file:' || parsed.search) return null;
  parsed.hash = '';
  try {
    return fileURLToPath(parsed, { windows: platform === 'win32' });
  } catch {
    return null;
  }
}

function isSameLocalFileUrl(candidateUrl, expectedPath, platform = process.platform) {
  if (!expectedPath) return false;
  const candidatePath = fileUrlToLocalPath(candidateUrl, platform);
  if (!candidatePath) return false;
  if (normalizeLocalPath(candidatePath, platform) === normalizeLocalPath(expectedPath, platform)) {
    return true;
  }
  if (platform === process.platform) {
    try {
      const real = fs.realpathSync.native || fs.realpathSync;
      return normalizeLocalPath(real(candidatePath), platform) ===
        normalizeLocalPath(real(expectedPath), platform);
    } catch {
      return false;
    }
  }
  return false;
}

function getWindowStatePath(app) {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function boundsAreVisible(bounds) {
  if (!bounds ||
      !Number.isInteger(bounds.x) ||
      !Number.isInteger(bounds.y) ||
      !Number.isInteger(bounds.width) ||
      !Number.isInteger(bounds.height)) {
    return false;
  }
  if (bounds.width < 800 || bounds.height < 450) return false;

  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapWidth = Math.max(
      0,
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x)
    );
    const overlapHeight = Math.max(
      0,
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y)
    );
    return overlapWidth >= 100 && overlapHeight >= 100;
  });
}

function loadWindowBounds(app, logger, rememberWindowBounds) {
  if (!rememberWindowBounds) return DEFAULT_BOUNDS;
  try {
    const stored = JSON.parse(
      fs.readFileSync(getWindowStatePath(app), 'utf8')
    );
    return boundsAreVisible(stored) ? stored : DEFAULT_BOUNDS;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn('Could not restore window bounds', error.message);
    }
    return DEFAULT_BOUNDS;
  }
}

function saveWindowBounds(app, window, logger) {
  if (window.isDestroyed() || window.isMinimized()) {
    return;
  }
  try {
    fs.writeFileSync(
      getWindowStatePath(app),
      `${JSON.stringify(window.getNormalBounds(), null, 2)}\n`,
      'utf8'
    );
  } catch (error) {
    logger.warn('Could not save window bounds', error.message);
  }
}

function safeWebProtocol(candidate) {
  try {
    const protocol = new URL(candidate).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function stripElectronToken(userAgent) {
  return userAgent
    .replace(/\sElectron\/[^\s]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function secureWebPreferences(targetSession, config, { includePreload = false } = {}) {
  return {
    ...(targetSession ? { session: targetSession } : {}),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    devTools: config.enableDevTools,
    ...(includePreload ? { preload: path.join(__dirname, 'preload.js') } : {}),
    // Cloud streams must not be throttled when focus briefly moves elsewhere.
    backgroundThrottling: false
  };
}

function configureWebContents({
  webContents,
  window,
  app,
  config,
  persistentSession,
  logger,
  isMainWindow = false,
  launcherPath = null,
  getShortcuts,
  onHome,
  shouldSuspendShortcuts,
  onShortcutCapture,
  shouldBypassUnload = () => false
}) {
  let windowCloseRequested = false;
  const isLauncherWindow = Boolean(isMainWindow && launcherPath);

  // A cloud-game page must not trap the user in the application with a
  // beforeunload handler. Ordinary page navigation keeps its normal warning.
  window.on('close', () => {
    windowCloseRequested = true;
  });
  webContents.on('will-prevent-unload', (event) => {
    if (!windowCloseRequested && !shouldBypassUnload()) return;
    event.preventDefault();
    logger.info('Ignored page beforeunload during an explicit shell action');
  });

  if (config.stripElectronFromUserAgent) {
    webContents.setUserAgent(
      stripElectronToken(webContents.getUserAgent())
    );
  }

  installShortcuts(webContents, window, config, app, logger, {
    getShortcuts,
    onHome,
    shouldSuspend: shouldSuspendShortcuts,
    onCapture: onShortcutCapture
  });

  webContents.setWindowOpenHandler(({ url }) => {
    if (isLauncherWindow) {
      logger.warn('Blocked window.open from launcher window');
      return { action: 'deny' };
    }
    if (!safeWebProtocol(url)) {
      logger.warn('Blocked window.open with unsafe protocol', {
        protocol: protocolOf(url)
      });
      return { action: 'deny' };
    }

    logger.info('Allowed controlled web popup', { host: hostnameOf(url) });
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: window,
        width: 960,
        height: 720,
        show: true,
        autoHideMenuBar: true,
        backgroundColor: '#000000',
        webPreferences: secureWebPreferences(persistentSession, config)
      }
    };
  });

  webContents.on('will-navigate', (event, url) => {
    if (isLauncherWindow) {
      if (!isSameLocalFileUrl(url, launcherPath)) {
        event.preventDefault();
        logger.warn('Blocked external navigation in launcher window', {
          protocol: protocolOf(url)
        });
      }
      return;
    }
    const isManualTestFile = isMainWindow &&
      config.startUrl.startsWith('file:') &&
      url.startsWith('file:');
    if (!safeWebProtocol(url) && !isManualTestFile) {
      event.preventDefault();
      logger.warn('Blocked unsafe navigation', {
        protocol: protocolOf(url)
      });
    }
  });

  webContents.on('will-redirect', (event, url) => {
    if (isLauncherWindow) {
      if (!isSameLocalFileUrl(url, launcherPath)) {
        event.preventDefault();
        logger.warn('Blocked redirect in launcher window', {
          protocol: protocolOf(url)
        });
      }
      return;
    }
    if (!safeWebProtocol(url)) {
      event.preventDefault();
      logger.warn('Blocked unsafe redirect', {
        protocol: protocolOf(url)
      });
    }
  });

  webContents.on('enter-html-full-screen', () => {
    logger.info('Entered HTML fullscreen');
    if (config.htmlFullscreenPolicy === 'block') {
      webContents.executeJavaScript(
        'if (document.fullscreenElement) document.exitFullscreen()',
        false
      ).catch((error) => {
        logger.warn('Could not exit HTML fullscreen', error.message);
      });
    }
  });
  webContents.on('leave-html-full-screen', () => {
    logger.info('Left HTML fullscreen');
  });

  webContents.on('did-fail-load', (
    _event,
    errorCode,
    errorDescription,
    validatedURL,
    isMainFrame
  ) => {
    if (!isMainFrame || errorCode === -3) return;
    logger.error('Page failed to load', {
      errorCode,
      errorDescription,
      host: hostnameOf(validatedURL)
    });
  });
}

function createMainWindow({
  app, config, logger, library, launcherPath,
  show = true, onClose = () => false
}) {
  const window = new BrowserWindow({
    ...loadWindowBounds(app, logger, config.rememberWindowBounds),
    minWidth: 800, minHeight: 450, show: false,
    title: `${PRODUCT_NAME} · 游戏库`, autoHideMenuBar: true,
    backgroundColor: '#1f1a45',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: secureWebPreferences(null, config, { includePreload: true })
  });
  window.setMenu(null);
  const launcherUrl = pathToFileURL(launcherPath).href;
  let shortcutCaptureActive = false;
  let shortcutCaptureAction = null;
  window.showLauncher = () => {
    if (window.isDestroyed()) return;
    shortcutCaptureActive = false;
    shortcutCaptureAction = null;
    window.webContents.setIgnoreMenuShortcuts(false);
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  window.setShortcutCapture = (active, action = null) => {
    shortcutCaptureActive = Boolean(active);
    shortcutCaptureAction = shortcutCaptureActive ? action : null;
    window.webContents.setIgnoreMenuShortcuts(shortcutCaptureActive);
    return shortcutCaptureActive;
  };
  configureWebContents({
    webContents: window.webContents, window, app, config,
    logger, isMainWindow: true, launcherPath,
    getShortcuts: library.getShortcuts, onHome: window.showLauncher,
    shouldSuspendShortcuts: () => shortcutCaptureActive,
    onShortcutCapture: (result) => {
      const action = shortcutCaptureAction;
      if (result.shortcut || result.cancelled) window.setShortcutCapture(false);
      window.webContents.send('launcher:shortcut-captured', { ...result, action });
    }
  });
  window.on('close', (event) => {
    if (config.rememberWindowBounds) saveWindowBounds(app, window, logger);
    if (onClose()) { event.preventDefault(); window.hide(); }
  });
  window.ready = window.loadURL(launcherUrl);
  window.ready.catch((error) => logger.error('Launcher load failed', error.message));
  if (show) window.once('ready-to-show', () => window.show());
  return window;
}

function createGameWindow({
  app, config, persistentSession, logger, library, game, onHome,
  onFavicon = () => {}, show = true
}) {
  const window = new BrowserWindow({
    width: 1280, height: 720, minWidth: 800, minHeight: 450, show: false,
    title: game.name, autoHideMenuBar: true, backgroundColor: '#000000',
    webPreferences: secureWebPreferences(persistentSession, config)
  });
  window.setMenu(null);
  window.gameId = game.id;
  window.showLauncher = () => onHome(window);
  const configure = (target, isMainWindow = false) => {
    target.gameId = game.id;
    target.gameWindow = window;
    target.showLauncher = window.showLauncher;
    configureWebContents({
      webContents: target.webContents, window: target, app, config,
      persistentSession, logger, isMainWindow,
      getShortcuts: library.getShortcuts, onHome: () => onHome(window)
    });
    target.webContents.on('did-create-window', (child) => {
      configure(child);
      const closeChild = () => { if (!child.isDestroyed()) child.destroy(); };
      window.once('closed', closeChild);
      child.once('closed', () => window.removeListener('closed', closeChild));
    });
  };
  configure(window, true);
  window.webContents.on('page-favicon-updated', (_event, urls) => onFavicon(urls));
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('Game renderer process gone', { gameId: game.id, reason: details.reason });
  });
  window.on('enter-full-screen', () => logger.info('Game fullscreen entered', { gameId: game.id }));
  window.on('leave-full-screen', () => logger.info('Game fullscreen left', { gameId: game.id }));
  let revealed = false;
  const reveal = () => {
    if (!show || revealed || window.isDestroyed()) return;
    revealed = true;
    window.show();
    setDisplayMode(window, config.startMode, logger);
  };
  window.once('ready-to-show', reveal);
  const revealTimer = setTimeout(reveal, 8000);
  window.once('closed', () => clearTimeout(revealTimer));
  window.ready = window.loadURL(game.url).then(reveal);
  // Runtime awaits ready; attach a handler immediately to avoid stray rejections.
  window.ready.catch(() => {});
  return window;
}

function protocolOf(candidate) {
  try {
    return new URL(candidate).protocol;
  } catch {
    return 'invalid';
  }
}

function hostnameOf(candidate) {
  try {
    return new URL(candidate).hostname || new URL(candidate).protocol;
  } catch {
    return 'invalid';
  }
}

module.exports = {
  boundsAreVisible,
  configureWebContents,
  createMainWindow,
  createGameWindow,
  fileUrlToLocalPath,
  isSameLocalFileUrl,
  normalizeLocalPath,
  safeWebProtocol,
  stripElectronToken
};
