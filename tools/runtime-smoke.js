'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, ipcMain, nativeImage, session } = require('electron');
const { loadConfig } = require('../src/config');
const { createLibraryStore } = require('../src/library');
const { createRuntime, installLauncherHandlers } = require('../src/runtime');
const { iconCandidates, normalizeImage, createIconService } = require('../src/icons');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudgameshell-runtime-'));
app.setPath('userData', temp);
app.setAppPath(path.resolve(__dirname, '..'));
const logger = { info() {}, warn() {}, error: console.error };
const timeout = setTimeout(() => { console.error('FAIL: runtime test timed out'); app.exit(1); }, 40000);
async function until(check, name) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out: ${name}`);
}

app.whenReady().then(async () => {
  const { config: manual } = loadConfig(app, { manualTest: true });
  const config = { ...manual, startMode: 'windowed' };
  const library = createLibraryStore(app, config, logger, { allowFileUrl: true });
  const url = pathToFileURL(path.join(app.getAppPath(), 'tools/fullscreen-test.html')).href;
  library.saveGames([{ id: 'first', name: '测试游戏', url }, { id: 'second', name: '第二个游戏', url }]);
  const image = nativeImage.createFromBitmap(Buffer.from([200, 100, 40, 255]), { width: 1, height: 1 });
  const siteIcon = normalizeImage(image.toPNG());
  const customIcon = normalizeImage(fs.readFileSync(path.join(app.getAppPath(), 'build/icon.png')));
  fs.mkdirSync(path.join(app.getAppPath(), 'tmp'), { recursive: true });
  assert.throws(() => normalizeImage(Buffer.from('not an image')), /无法读取/);
  assert.deepEqual(iconCandidates('<link href="../icon.png" rel="shortcut icon"><link rel="apple-touch-icon" href="https://cdn.example.com/icon.png">', 'https://example.com/cloud/index.html'),
    ['https://example.com/icon.png', 'https://cdn.example.com/icon.png', 'https://example.com/favicon.ico']);
  const icons = { getWebsiteIcon: async () => siteIcon, chooseAvatar: async () => customIcon };
  const runtime = createRuntime({ app, config, library, icons, logger,
    persistentSession: session.fromPartition('persist:runtime-test'), showWindows: false });
  installLauncherHandlers({ app, ipcMain, runtime, icons, logger });
  const launcher = runtime.launcher;
  const js = (script) => launcher.webContents.executeJavaScript(script, true);
  const capture = async (filename) => {
    await js('Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})))');
    await js('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const image = await launcher.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    fs.writeFileSync(path.join(app.getAppPath(), 'tmp', filename), image.toPNG());
  };
  await launcher.ready;
  await runtime.refreshIcons();
  await until(async () => await js('document.querySelectorAll(".game-card").length === 2'), 'initial cards');
  assert.equal(library.getGames()[0].siteIcon, siteIcon);
  await until(async () => await js('document.querySelectorAll(".game-monogram img").length === 2'), 'site icon repaint');
  if (await js('Boolean(document.querySelector(".game-tile"))')) {
    await js('document.querySelectorAll(".game-tile")[1].click()');
    assert.equal(await js('document.querySelector(".game-card.is-selected").dataset.gameId'), 'second');
    await js('document.querySelectorAll(".game-tile")[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))');
    assert.equal(await js('document.querySelector(".game-card.is-selected").dataset.gameId'), 'first');
  }

  await js('Promise.all([window.cloudBerth.launchGame("first"), window.cloudBerth.launchGame("first")])');
  const gameWindow = runtime.getGameWindow('first');
  assert(gameWindow && gameWindow !== launcher);
  assert.deepEqual(runtime.getState().runningGameIds, ['first']);
  assert.equal(launcher.webContents.getURL(), runtime.launcherUrl);
  await until(async () => await js('document.querySelector(".play").textContent === "运行中"'), 'running label');
  assert.equal(await gameWindow.webContents.executeJavaScript('typeof window.cloudBerth'), 'undefined');
  await gameWindow.webContents.executeJavaScript('window.retainedGameState = 42');
  gameWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'h', modifiers: ['meta', 'shift'] });
  gameWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'h', modifiers: ['meta', 'shift'] });
  await js('window.cloudBerth.launchGame("first")');
  assert.equal(runtime.getGameWindow('first'), gameWindow);
  assert.equal(await gameWindow.webContents.executeJavaScript('window.retainedGameState'), 42);
  assert.throws(() => runtime.saveGames([]), /先结束/);

  // Invoke the real launcher menu and IPC, not just the runtime stop method.
  await gameWindow.webContents.executeJavaScript(`window.addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = ''; }); document.body.click();`, true);
  await js('document.querySelector(".run-menu-toggle").click()');
  assert.equal(await js('document.querySelector(".run-menu").hidden'), false);
  await capture('launcher-running-menu.png');
  await js('document.querySelector(".run-menu button").click()');
  await until(() => runtime.getGameWindow('first') === null, 'stop closes game');
  await until(async () => await js('document.querySelector(".play").textContent === "开始游戏"'), 'start label restored');

  // Custom image selection, save, and restoration to automatic site icon.
  await js('document.querySelector(".card-actions > .ghost-button").click(); document.querySelector("#chooseAvatarButton").click();');
  await until(async () => await js('document.querySelector("#avatarStatus").textContent === "自定义头像"'), 'custom avatar preview');
  await capture('launcher-custom-avatar.png');
  await js('document.querySelector("#gameForm").requestSubmit()');
  await until(() => library.getGames()[0].icon === customIcon, 'custom avatar saved');
  const reloaded = createLibraryStore(app, config, logger, { allowFileUrl: true });
  assert.equal(reloaded.getGames()[0].icon, customIcon);
  await js('document.querySelector(".card-actions > .ghost-button").click(); document.querySelector("#gameUrl").value = "https://example.com/play"; document.querySelector("#autoAvatarButton").click();');
  await until(async () => await js('document.querySelector("#avatarStatus").textContent === "网站图标"'), 'auto icon restored');
  await js(`document.querySelector('#gameUrl').value = ${JSON.stringify(url)}; document.querySelector('#gameForm').requestSubmit()`);
  await until(() => !library.getGames()[0].icon, 'custom icon removed');

  await runtime.launchGame('first');
  await runtime.launchGame('second');
  assert.equal(runtime.getState().runningGameIds.length, 2);
  const first = runtime.getGameWindow('first');
  first.close();
  await until(() => !runtime.getGameWindow('first'), 'native close updates state');
  assert.deepEqual(runtime.getState().runningGameIds, ['second']);
  const second = runtime.getGameWindow('second');
  launcher.close();
  assert(!launcher.isDestroyed(), 'Closing the launcher must preserve running games and the return target');
  await runtime.stopGame('second');
  assert(second.isDestroyed());

  // The redesigned launcher must remain usable at its minimum content size.
  launcher.setContentSize(800, 450);
  await js('document.querySelector("#settingsButton").click()');
  assert.equal(await js('document.querySelector("#settingsSection").hidden'), false);
  assert.equal(await js('document.querySelectorAll(".keycaps kbd").length > 0'), true);
  await capture('launcher-settings-small.png');
  const settingsFits = await js(`(() => {
    const button = document.querySelector('#shortcutForm button[type="submit"]');
    const rect = button.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
  })()`);
  assert(settingsFits, 'Settings save button must fit at 800x450');
  await js('document.querySelector("#settingsCloseButton").click(); document.querySelector("#addButton").click()');
  await capture('launcher-entry-small.png');
  assert.equal(await js('document.querySelector("#gameDialog").open'), true);
  await js('document.querySelector("#cancelButton").click()');
  assert.equal(await js('document.querySelector("#gameDialog").open'), false);

  // Verify the actual game's public favicon can be decoded on this Mac.
  const liveIcon = await createIconService({ logger: { warn: console.log } }).getWebsiteIcon('https://yh.wanmei.com/cloud/index.html');
  assert(liveIcon.startsWith('data:image/png;base64,'), 'Cloud Yihuan favicon must decode');
  fs.mkdirSync(path.join(app.getAppPath(), 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(app.getAppPath(), 'tmp/yihuan-favicon.png'), Buffer.from(liveIcon.split(',')[1], 'base64'));
  launcher.destroy();
  clearTimeout(timeout);
  console.log('PASS: separate game windows, duplicate launch reuse, home retains game state, stop dropdown, native close and multiple running games.');
  console.log('PASS: website icons, custom avatar persistence/reset, actual Yihuan favicon decoding and remote bridge isolation.');
  app.exit(0);
}).catch((error) => { console.error(error.stack || error); app.exit(1); });
