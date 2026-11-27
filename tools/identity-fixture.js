'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');
const { configureIdentity, isLegacyCookieWorker, startLegacyCookieWorker,
  migrateLegacyCookies, APP_ID } = require('../src/identity');

if (isLegacyCookieWorker()) {
  startLegacyCookieWorker(app, session);
} else {
  const [, , stage, root] = process.argv;
  const workerOptions = process.env.CLOUDBERTH_TEST_PACKAGED_WORKER
    ? { executable: process.env.CLOUDBERTH_TEST_PACKAGED_WORKER, workerArgs: [] }
    : { workerArgs: [__filename] };
  const isLegacy = ['seed', 'busy-legacy'].includes(stage);
  const dataPath = path.join(root, isLegacy ? 'CloudGameShell' : 'CloudBerth');
  let migration;
  if (isLegacy) {
    fs.mkdirSync(dataPath, { recursive: true });
    app.setName('CloudGameShell');
    app.setPath('userData', dataPath);
    app.setPath('sessionData', dataPath);
    if (stage === 'busy-legacy') assert(app.requestSingleInstanceLock());
  } else {
    migration = configureIdentity(app, { appDataPath: root });
    assert.equal(app.getName(), 'CloudBerth');
    assert.equal(app.getPath('userData'), dataPath);
    assert.equal(app.getPath('sessionData'), dataPath);
    assert.equal(APP_ID, 'com.cloudberth.app');
    if (stage === 'reopen') assert.equal(migration.legacyPath, null);
    assert(app.requestSingleInstanceLock());
  }
  const timer = setTimeout(() => { console.error('Identity fixture timed out'); app.exit(1); }, 50000);
  app.whenReady().then(async () => {
    if (stage === 'busy-legacy') { clearTimeout(timer); process.send({ type: 'ready' }); return; }
    if (stage === 'blocked') {
      await assert.rejects(() => migrateLegacyCookies(app, session, migration, workerOptions), /请先退出旧版/);
      assert.equal(JSON.parse(fs.readFileSync(path.join(dataPath, '.cloudberth-migration.json'))).status, 'pending');
      assert(!fs.existsSync(path.join(dataPath, 'launcher.json')));
      clearTimeout(timer); app.quit(); return;
    }
    if (migration) await migrateLegacyCookies(app, session, migration, workerOptions);
    const ses = session.fromPartition('persist:cloud-game');
    ses.protocol.handle('https', () => new Response('<title>Isolated migration fixture</title>', { headers: { 'content-type': 'text/html' } }));
    const window = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true } });
    await window.loadURL('https://migration.example.test/');
    if (stage === 'seed') {
      fs.writeFileSync(path.join(dataPath, 'launcher.json'), JSON.stringify({ games: [{ name: 'Fixture only' }], shortcuts: { quit: 'Meta+Q' } }));
      fs.writeFileSync(path.join(dataPath, 'config.json'), JSON.stringify({ startMode: 'windowed' }));
      fs.writeFileSync(path.join(dataPath, 'lockfile'), 'Synthetic legacy lock: must not be copied');
      await ses.cookies.set({ url: 'https://migration.example.test/', name: 'test-login', value: 'synthetic-cookie-only', secure: true, httpOnly: true,
        sameSite: 'no_restriction', expirationDate: Date.now() / 1000 + 3600 });
      await window.webContents.executeJavaScript('localStorage.setItem("migration-test", "synthetic-storage-only")');
    } else {
      assert.equal(JSON.parse(fs.readFileSync(path.join(dataPath, 'launcher.json'))).games[0].name, 'Fixture only');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dataPath, 'config.json'))).startMode, 'windowed');
      if (process.platform !== 'win32') assert(!fs.existsSync(path.join(dataPath, 'lockfile')));
      const cookies = await ses.cookies.get({ name: 'test-login' });
      assert.equal(cookies.length, 1);
      assert.equal(cookies[0].value, 'synthetic-cookie-only');
      assert.equal(cookies[0].httpOnly, true);
      assert.equal(await window.webContents.executeJavaScript('localStorage.getItem("migration-test")'), 'synthetic-storage-only');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dataPath, '.cloudberth-migration.json'))).status, 'complete');
    }
    await ses.cookies.flushStore();
    ses.flushStorageData();
    window.destroy();
    clearTimeout(timer);
    app.quit();
  }).catch((error) => { console.error(error.message); app.exit(1); });
}
