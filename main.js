'use strict';

const { app, dialog, ipcMain, Menu, session } = require('electron');
const { ConfigError, loadConfig } = require('./src/config');
const { createLibraryStore } = require('./src/library');
const { createLogger } = require('./src/logger');
const { configurePermissions } = require('./src/permissions');
const { createRuntime, installLauncherHandlers } = require('./src/runtime');
const { createIconService } = require('./src/icons');
const { installApplicationMenu } = require('./src/platform');
const { APP_ID, PRODUCT_NAME, SESSION_PARTITION, configureIdentity,
  isLegacyCookieWorker, startLegacyCookieWorker, migrateLegacyCookies } = require('./src/identity');

const manualTest = !app.isPackaged && process.argv.includes('--manual-test');
let mainWindow = null;

if (isLegacyCookieWorker()) {
  startLegacyCookieWorker(app, session);
} else {
  startApplication();
}

function startApplication() {
  let migration;
  try { migration = configureIdentity(app); }
  catch (error) {
    dialog.showErrorBox(`${PRODUCT_NAME} 数据迁移`, error.message);
    app.exit(1); return;
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

    app.on('second-instance', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });

    app.whenReady().then(async () => {
      await migrateLegacyCookies(app, session, migration);
      app.setAboutPanelOptions({ applicationName: PRODUCT_NAME });
      const logger = createLogger(app.getPath('userData'));
      let loaded;

      try {
        loaded = loadConfig(app, { manualTest });
      } catch (error) {
        logger.error('Configuration error', error.message);
        const message = error instanceof ConfigError
          ? error.message
          : `读取配置时发生错误：${error.message}`;
        dialog.showErrorBox(`${PRODUCT_NAME} 配置错误`, message);
        app.quit();
        return;
      }

      const { config, sourcePath, userConfigPath } = loaded;
      const library = createLibraryStore(app, config, logger, {
        allowFileUrl: manualTest || !app.isPackaged
      });
      const startUrl = new URL(config.startUrl);
      logger.info(`${PRODUCT_NAME} started`, {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        startHost: startUrl.hostname || startUrl.protocol,
        startMode: config.startMode,
        configPath: sourcePath,
        userConfigPath,
        libraryPath: library.filePath
      });

      const persistentSession = session.fromPartition(SESSION_PARTITION, {
        cache: true
      });
      configurePermissions(persistentSession, config, logger, {
        getGameUrls: () => library.getGames().map((game) => game.url)
      });

      const icons = createIconService({ logger });
      let runtime;
      const refreshMenu = () => installApplicationMenu({
        Menu, app, config, logger,
        getWindow: () => runtime.getActionWindow(),
        shortcuts: library.getShortcuts()
      });
      runtime = createRuntime({ app, config, persistentSession, logger, library, icons,
        onShortcutsChanged: refreshMenu });
      mainWindow = runtime.launcher;
      installLauncherHandlers({ ipcMain, runtime, icons, app, logger });
      refreshMenu();
      void runtime.refreshIcons();
      mainWindow.on('closed', () => {
        mainWindow = null;
      });
    }).catch((error) => {
      dialog.showErrorBox(`${PRODUCT_NAME} 启动失败`, error.stack || error.message);
      app.quit();
    });

    app.on('window-all-closed', () => app.quit());
  }
}

process.on('uncaughtException', (error) => {
  console.error(error);
  dialog.showErrorBox(`${PRODUCT_NAME} 未处理错误`, error.stack || error.message);
  app.quit();
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

module.exports = { APP_ID, SESSION_PARTITION };
