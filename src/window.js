'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, screen } = require('electron');
const { installShortcuts, setDisplayMode } = require('./shortcuts');
const { PRODUCT_NAME } = require('./identity');

const DEFAULT_BOUNDS = Object.freeze({ width: 1280, height: 720 });

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

function secureWebPreferences(persistentSession, config) {
  return {
    session: persistentSession,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    devTools: config.enableDevTools,
    preload: path.join(__dirname, 'preload.js'),
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
  launcherUrl = null,
  getShortcuts,
  onHome,
  shouldSuspendShortcuts,
  onShortcutCapture,
  shouldBypassUnload = () => false
}) {
  let windowCloseRequested = false;

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
    const isManualTestFile = isMainWindow &&
      config.startUrl.startsWith('file:') &&
      url.startsWith('file:');
    const isLauncher = isMainWindow && launcherUrl &&
      withoutFragment(url) === withoutFragment(launcherUrl);
    if (!safeWebProtocol(url) && !isManualTestFile && !isLauncher) {
      event.preventDefault();
      logger.warn('Blocked unsafe navigation', {
        protocol: protocolOf(url)
      });
    }
  });

  webContents.on('will-redirect', (event, url) => {
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
  app, config, persistentSession, logger, library, launcherPath,
  show = true, onClose = () => false
}) {
  const window = new BrowserWindow({
    ...loadWindowBounds(app, logger, config.rememberWindowBounds),
    minWidth: 800, minHeight: 450, show: false,
    title: `${PRODUCT_NAME} · 游戏库`, autoHideMenuBar: true,
    backgroundColor: '#1f1a45',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: secureWebPreferences(persistentSession, config)
  });
  window.setMenu(null);
  const launcherUrl = require('node:url').pathToFileURL(launcherPath).href;
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
    webContents: window.webContents, window, app, config, persistentSession,
    logger, isMainWindow: true, launcherUrl,
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
  window.ready = window.loadFile(launcherPath);
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
  window.showLauncher = () => onHome(window);
  const configure = (target, isMainWindow = false) => {
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

function withoutFragment(candidate) {
  try {
    const parsed = new URL(candidate);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return candidate;
  }
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
  safeWebProtocol,
  stripElectronToken
};
