'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { validateConfig, loadConfig } = require('../src/config');
const { platformDefaults } = require('../src/platform');
const {
  createLibraryStore,
  migrateShortcutDefaults,
  normalizeDerivedHost,
  normalizeShortcut,
  validateDerivedHosts,
  validateGames,
  validateShortcuts
} = require('../src/library');
const {
  configurePermissions,
  createTrustChecker,
  hostnameMatches
} = require('../src/permissions');
const { isSameLocalFileUrl } = require('../src/window');

const projectRoot = path.resolve(__dirname, '..');
const sourceFiles = [
  'main.js',
  'src/config.js',
  'src/updater/index.js',
  'src/updater/install.js',
  'src/launcher/update-ui.js',
  'tools/updates-check.js',
  'tools/update-smoke.js',
  'tools/update-ui-smoke.js',
  'src/library.js',
  'src/logger.js',
  'src/permissions.js',
  'src/preload.js',
  'src/platform.js',
  'src/runtime.js',
  'src/icons.js',
  'src/identity.js',
  'src/shortcuts.js',
  'src/window.js',
  'src/launcher/app.js',
  'tools/check.js',
  'tools/close-smoke.js',
  'tools/launcher-smoke.js',
  'tools/run.js',
  'tools/mac-smoke.js',
  'tools/shortcuts-check.js',
  'tools/runtime-smoke.js',
  'tools/shortcut-smoke.js',
  'tools/identity-smoke.js',
  'tools/identity-fixture.js',
  'tools/capture-readme.js'
];

for (const file of sourceFiles) {
  const result = spawnSync(
    process.execPath,
    ['--check', path.join(projectRoot, file)],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, `${file}: ${result.stderr}`);
}

const defaultsPath = path.join(projectRoot, 'config.default.json');
const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));
const config = validateConfig(defaults, defaultsPath, false);
assert.equal(config.startMode, 'kiosk');
assert.equal(config.htmlFullscreenPolicy, 'block');
assert.equal(config.shortcuts.home, 'Ctrl+Shift+H');

assert.equal(normalizeShortcut('shift+ctrl+q'), 'Ctrl+Shift+Q');
assert.equal(normalizeShortcut('f11'), 'F11');
assert.throws(() => normalizeShortcut('Escape'), /ESC/);
assert.throws(() => normalizeShortcut('Q'), /修饰键/);
assert.throws(
  () => validateShortcuts({
    toggleDisplay: 'F11',
    quit: 'F11',
    home: 'Ctrl+Shift+H'
  }),
  /重复/
);
assert.equal(validateGames([
  { id: 'game-1', name: ' Test ', url: 'https://example.com/play' }
]).at(0).name, 'Test');
assert.throws(
  () => validateGames([{ name: 'Bad', url: 'http://example.com' }]),
  /HTTPS/
);

assert.equal(hostnameMatches('game.example.com', '*.example.com'), true);
assert.equal(hostnameMatches('example.com', '*.example.com'), false);
assert.equal(hostnameMatches('badexample.com', '*.example.com'), false);
assert.equal(hostnameMatches('EXAMPLE.COM', 'example.com'), true);

const trustDefaultHost = createTrustChecker(config);
assert.equal(trustDefaultHost('https://example.com/play'), true);
assert.equal(trustDefaultHost('https://login.example.com/'), false);
assert.equal(trustDefaultHost('http://example.com/'), false);
assert.equal(trustDefaultHost('file:///C:/Windows/System32/calc.exe'), false);

// Launcher local file URL matching across Windows 8.3 short paths, casing and special chars.
const winShortLauncher = 'C:\\Users\\ADMINI~1\\AppData\\Local\\Temp\\2z1234\\resources\\app.asar\\src\\launcher\\index.html';
assert.equal(isSameLocalFileUrl('file:///C:/Users/ADMINI~1/AppData/Local/Temp/2z1234/resources/app.asar/src/launcher/index.html', winShortLauncher, 'win32'), true);
assert.equal(isSameLocalFileUrl('file:///c:/Users/ADMINI%7E1/AppData/Local/Temp/2z1234/resources/app.asar/src/launcher/index.html#top', winShortLauncher, 'win32'), true);
assert.equal(isSameLocalFileUrl('file:///C:/Users/ADMINI~1/AppData/Local/Temp/2z1234/resources/app.asar/src/launcher/index.html?evil=1', winShortLauncher, 'win32'), false);
assert.equal(isSameLocalFileUrl('https://example.com/src/launcher/index.html', winShortLauncher, 'win32'), false);
const winBracketLauncher = 'C:\\Users\\Player[1]\\100%Game\\src\\launcher\\index.html';
assert.equal(isSameLocalFileUrl('file:///C:/Users/Player%5B1%5D/100%25Game/src/launcher/index.html', winBracketLauncher, 'win32'), true);
assert.equal(isSameLocalFileUrl('file:///C:/Users/Player[1]/100%25Game/src/launcher/index.html', winBracketLauncher, 'win32'), true);

// Derived webpage host normalization, validation and interactive authorization flow.
assert.equal(normalizeDerivedHost('https://Stream.Example.COM/play?id=1'), 'stream.example.com');
assert.equal(normalizeDerivedHost('*.Cloud.Example.com'), '*.cloud.example.com');
assert.throws(() => normalizeDerivedHost('http://stream.example.com'), /HTTPS/);
assert.throws(() => normalizeDerivedHost('bad host/path'), /有效/);
assert.deepEqual(validateDerivedHosts(['Stream.Example.com', 'https://stream.example.com/a']), ['stream.example.com']);
assert.equal(validateGames([{ name: 'Trimmed', url: ' https://example.com/play ', derivedHosts: ['https://cdn.example.com/x'] }])[0].derivedHosts[0], 'cdn.example.com');

assert.throws(
  () => validateConfig({ ...defaults, startUrl: 'javascript:alert(1)' }, defaultsPath, false),
  /只允许 https/
);
assert.throws(
  () => validateConfig({ ...defaults, startMode: 'wrong' }, defaultsPath, false),
  /startMode/
);

const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
);
assert.equal(packageJson.name, 'cloudberth');
assert.equal(require('../src/updater').compareVersions(packageJson.releaseTag, packageJson.version), 0, 'Release tag must match the packaged version');
assert.equal(packageJson.productName, 'CloudBerth');
assert.equal(packageJson.build.productName, 'CloudBerth');
assert.equal(packageJson.build.appId, 'com.cloudberth.app');
assert.equal(packageJson.build.win.target[0].target, 'portable');
assert.equal(packageJson.devDependencies.electron, '45.2.3');
assert.equal(packageJson.build.mac.category, 'public.app-category.games');
assert.deepEqual(packageJson.build.mac.target, ['dmg', 'zip']);
assert(!packageJson.build.files.some((file) => file.startsWith('tools/')),
  'Production bundles must exclude developer test pages and scripts.');

const macDefaults = platformDefaults(defaults, 'darwin');
assert.equal(macDefaults.shortcuts.quit, 'Meta+Q');
assert.equal(macDefaults.shortcuts.toggleDisplay, 'Shift+Meta+F');
assert.equal(platformDefaults(defaults, 'win32').shortcuts.quit, 'Ctrl+Shift+Q');
assert.equal(normalizeShortcut('Control+Command+f'), 'Ctrl+Meta+F');
assert.equal(normalizeShortcut('Command+Shift+h'), 'Shift+Meta+H');
assert.equal(migrateShortcutDefaults({ toggleDisplay: 'Ctrl+Meta+F', home: 'Shift+Meta+H', quit: 'Meta+Q' }, 'darwin').toggleDisplay, 'Shift+Meta+F');
assert.equal(migrateShortcutDefaults({ toggleDisplay: 'Alt+Meta+F', home: 'Shift+Meta+H', quit: 'Meta+Q' }, 'darwin').toggleDisplay, 'Alt+Meta+F');
const iconFixture = 'data:image/png;base64,aGVsbG8=';
assert.equal(validateGames([{ name: 'Icon', url: 'https://example.com', icon: iconFixture }])[0].icon, iconFixture);
assert.throws(() => validateGames([{ name: 'Bad icon', url: 'https://example.com', icon: 'https://example.com/a.png' }]), /头像/);
// Check first-run persistence and partial overrides using an isolated directory.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudgameshell-config-'));
try {
  const fakeApp = { getAppPath: () => projectRoot, getPath: () => temp, isPackaged: true };
  const first = loadConfig(fakeApp);
  assert.equal(first.sourcePath, path.join(temp, 'config.json'));
  assert.equal(first.config.shortcuts.quit, platformDefaults(defaults).shortcuts.quit);
  fs.writeFileSync(first.userConfigPath, JSON.stringify({ shortcuts: { home: 'Alt+H' } }));
  const overridden = loadConfig(fakeApp);
  assert.equal(overridden.config.shortcuts.home, 'Alt+H');
  assert.equal(overridden.config.shortcuts.quit, first.config.shortcuts.quit);
  if (process.platform === 'darwin') {
    const legacy = { version: 1, games: [{ id: 'legacy', name: '保留的游戏', url: 'https://example.com/' }],
      shortcuts: { toggleDisplay: 'Ctrl+Meta+F', home: 'Shift+Meta+H', quit: 'Meta+Q' } };
    fs.writeFileSync(path.join(temp, 'launcher.json'), JSON.stringify(legacy));
    const logger = { info() {}, warn() {} };
    const migrated = createLibraryStore(fakeApp, first.config, logger);
    assert.equal(migrated.getShortcuts().toggleDisplay, 'Shift+Meta+F');
    assert.equal(migrated.getGames()[0].id, 'legacy');
    migrated.saveShortcuts(legacy.shortcuts);
    assert.equal(createLibraryStore(fakeApp, first.config, logger).getShortcuts().toggleDisplay, 'Ctrl+Meta+F',
      'The migration must run once, preserving later explicit user changes');
  }
  // Test derived host persistence and interactive permission approval / decline flow.
  const permLogger = { info() {}, warn() {} };
  const store = createLibraryStore(fakeApp, first.config, permLogger);
  const game = store.getGames()[0];
  let checkHandler, requestHandler;
  const fakeSession = {
    setPermissionCheckHandler: (fn) => { checkHandler = fn; },
    setPermissionRequestHandler: (fn) => { requestHandler = fn; }
  };
  let promptCalls = 0, nextApproval = false, closedCount = 0;
  const fakeWindow = { isDestroyed: () => false, close: () => { closedCount++; } };
  const fakeWebContents = { id: 1 };
  configurePermissions(fakeSession, first.config, permLogger, {
    getGameUrls: () => store.getGames().map((g) => g.url),
    getDerivedHosts: (id) => store.getDerivedHosts(id),
    getGameForWebContents: (wc) => wc === fakeWebContents ? { id: game.id, name: game.name, window: fakeWindow } : null,
    promptDerivedHost: async () => { promptCalls++; return nextApproval; },
    onApproveDerivedHost: (id, host) => store.addDerivedHost(id, host, { allowExisting: true })
  });
  const ask = (permission, requestingUrl) => new Promise((resolve) => {
    requestHandler(fakeWebContents, permission, resolve, { requestingUrl });
  });
  Promise.resolve().then(async () => {
    assert.equal(await ask('fullscreen', 'https://stream.other.com/play'), false);
    assert.equal(await ask('notifications', 'https://stream.other.com/play'), false);
    assert.equal(promptCalls, 0);
    assert.equal(closedCount, 0);
    assert.equal(await ask('pointerLock', 'https://stream.other.com/play'), false);
    assert.equal(promptCalls, 1);
    assert.equal(closedCount, 1);
    assert.deepEqual(store.getDerivedHosts(game.id), []);
    nextApproval = true;
    const [r1, r2] = await Promise.all([
      ask('pointerLock', 'https://stream.other.com/play'),
      ask('media', 'https://stream.other.com/play')
    ]);
    assert.equal(r1, true);
    assert.equal(r2, true);
    assert.equal(promptCalls, 2);
    assert.deepEqual(store.getDerivedHosts(game.id), ['stream.other.com']);
    assert.equal(checkHandler(fakeWebContents, 'pointerLock', 'https://stream.other.com', { requestingUrl: 'https://stream.other.com/play' }), true);
    assert.equal(await ask('keyboardLock', 'https://stream.other.com/play'), true);
    assert.equal(promptCalls, 2, 'Approved derived host must not prompt again');
    store.removeDerivedHost(game.id, 'stream.other.com');
    assert.equal(checkHandler(fakeWebContents, 'pointerLock', 'https://stream.other.com', { requestingUrl: 'https://stream.other.com/play' }), false);
    console.log('PASS: launcher file URL normalization, derived webpage authorization and revocation.');
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => {
    fs.rmSync(temp, { recursive: true, force: true });
  });
} catch (error) {
  fs.rmSync(temp, { recursive: true, force: true });
  throw error;
}

console.log(`PASS: ${sourceFiles.length} JavaScript files passed syntax checks.`);
console.log('PASS: configuration validation and permission host matching.');
console.log('PASS: macOS defaults, persisted config, Mac and Windows build targets.');
require('./shortcuts-check');

require('./updates-check');
