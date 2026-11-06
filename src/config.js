'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { validateShortcuts } = require('./library');
const { platformDefaults } = require('./platform');

const VALID_MODES = new Set(['windowed', 'fullscreen', 'kiosk']);
const VALID_FULLSCREEN_POLICIES = new Set(['block', 'allow']);

class ConfigError extends Error {
  constructor(message, filePath) {
    super(`${message}\n\n配置文件：${filePath}`);
    this.name = 'ConfigError';
    this.filePath = filePath;
  }
}

function validateConfig(rawConfig, filePath, allowFileUrl) {
  const config = { ...rawConfig };

  if (typeof config.startUrl !== 'string') {
    throw new ConfigError('startUrl 必须是字符串。', filePath);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(config.startUrl);
  } catch {
    throw new ConfigError('startUrl 不是合法 URL。', filePath);
  }

  const allowedProtocol = parsedUrl.protocol === 'https:' ||
    (allowFileUrl && parsedUrl.protocol === 'file:');
  if (!allowedProtocol) {
    throw new ConfigError(
      'startUrl 只允许 https://；开发测试模式下也允许 file://。',
      filePath
    );
  }

  if (!VALID_MODES.has(config.startMode)) {
    throw new ConfigError(
      'startMode 必须是 windowed、fullscreen 或 kiosk。',
      filePath
    );
  }

  if (!VALID_FULLSCREEN_POLICIES.has(config.htmlFullscreenPolicy)) {
    throw new ConfigError(
      'htmlFullscreenPolicy 必须是 block 或 allow。',
      filePath
    );
  }

  for (const key of [
    'rememberWindowBounds',
    'stripElectronFromUserAgent',
    'enableDevTools'
  ]) {
    if (typeof config[key] !== 'boolean') {
      throw new ConfigError(`${key} 必须是 true 或 false。`, filePath);
    }
  }

  if (!Array.isArray(config.allowedPermissionHosts) ||
      config.allowedPermissionHosts.some((host) => typeof host !== 'string')) {
    throw new ConfigError(
      'allowedPermissionHosts 必须是字符串数组。',
      filePath
    );
  }

  const hostPattern = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
  for (const host of config.allowedPermissionHosts) {
    if (!hostPattern.test(host)) {
      throw new ConfigError(
        `allowedPermissionHosts 包含无效主机名：${host}`,
        filePath
      );
    }
  }

  try {
    config.shortcuts = validateShortcuts(config.shortcuts);
  } catch (error) {
    throw new ConfigError(`shortcuts 配置无效：${error.message}`, filePath);
  }

  return Object.freeze(config);
}

function uniquePaths(paths) {
  const seen = new Set();
  return paths.filter((candidate) => {
    const resolved = path.resolve(candidate);
    const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function loadConfig(app, { manualTest = false } = {}) {
  const appRoot = app.getAppPath();
  const userConfigPath = path.join(app.getPath('userData'), 'config.json');
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  const executableDirectory = portableDirectory || path.dirname(process.execPath);
  const defaultPath = path.join(appRoot, 'config.default.json');
  const defaults = platformDefaults(JSON.parse(fs.readFileSync(defaultPath, 'utf8')));

  if (manualTest) {
    const defaultConfig = { ...defaults };
    defaultConfig.startUrl = pathToFileURL(
      path.join(appRoot, 'tools', 'fullscreen-test.html')
    ).href;
    defaultConfig.startMode = 'windowed';
    defaultConfig.enableDevTools = true;
    return {
      config: validateConfig(defaultConfig, defaultPath, true),
      sourcePath: 'npm run test:manual',
      userConfigPath
    };
  }

  const candidates = uniquePaths([
    // An installed .app is immutable; all Mac settings live in userData.
    ...(process.platform === 'win32' ? [path.join(executableDirectory, 'config.json')] : []),
    ...(!app.isPackaged ? [path.join(appRoot, 'config.json')] : []),
    userConfigPath
  ]);
  let sourcePath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!sourcePath) {
    fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
    fs.writeFileSync(userConfigPath, `${JSON.stringify(defaults, null, 2)}\n`, 'utf8');
    sourcePath = userConfigPath;
  }

  let userConfig;
  try {
    userConfig = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  } catch (error) {
    throw new ConfigError(`无法读取或解析 JSON：${error.message}`, sourcePath);
  }

  return {
    config: validateConfig(
      { ...defaults, ...userConfig, shortcuts: { ...defaults.shortcuts, ...userConfig.shortcuts } },
      sourcePath,
      !app.isPackaged
    ),
    sourcePath,
    userConfigPath
  };
}

module.exports = {
  ConfigError,
  loadConfig,
  validateConfig
};
