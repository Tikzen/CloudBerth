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
  normalizeShortcut,
  validateGames,
  validateShortcuts
} = require('../src/library');
const {
  createTrustChecker,
  hostnameMatches
} = require('../src/permissions');

const projectRoot = path.resolve(__dirname, '..');
const sourceFiles = [
  'main.js',
  'src/config.js',
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
  'tools/capture-readme.js',
  'tools/verify-windows.js'
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
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log(`PASS: ${sourceFiles.length} JavaScript files passed syntax checks.`);
console.log('PASS: configuration validation and permission host matching.');
console.log('PASS: macOS defaults, persisted config, Mac and Windows build targets.');
require('./shortcuts-check');
