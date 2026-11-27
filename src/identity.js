'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PRODUCT_NAME = 'CloudBerth';
const APP_ID = 'com.cloudberth.app';
const LEGACY_NAME = 'CloudGameShell';
const EXPORT_FLAG = '--cloudberth-legacy-cookie-export';
const MARKER = '.cloudberth-migration.json';
const SESSION_PARTITION = 'persist:cloud-game';

function configureIdentity(app, { appDataPath = app.getPath('appData') } = {}) {
  const dataPath = path.join(appDataPath, PRODUCT_NAME);
  const legacyPath = path.join(appDataPath, LEGACY_NAME);
  const markerPath = path.join(dataPath, MARKER);
  let pending = false;
  if (fs.existsSync(markerPath)) {
    pending = JSON.parse(fs.readFileSync(markerPath, 'utf8')).status === 'pending';
  }
  const existingProfile = ['launcher.json', 'config.json', 'Partitions/cloud-game']
    .some((relative) => fs.existsSync(path.join(dataPath, relative))) ||
    (fs.existsSync(markerPath) && !pending);
  fs.mkdirSync(dataPath, { recursive: true });
  app.setName(PRODUCT_NAME);
  app.setPath('userData', dataPath);
  app.setPath('sessionData', dataPath);
  // Copying happens only after the caller acquires CloudBerth's instance lock.
  // The helper separately holds the legacy lock while taking its snapshot.
  return { dataPath, legacyPath: fs.existsSync(legacyPath) && (pending || !existingProfile) ? legacyPath : null };
}

function isLegacyCookieWorker() {
  return process.argv.includes(EXPORT_FLAG) && typeof process.send === 'function';
}

function startLegacyCookieWorker(app, session) {
  const index = process.argv.indexOf(EXPORT_FLAG);
  const profile = process.argv[index + 1];
  const legacyPath = process.argv[index + 2];
  const dataPath = process.argv[index + 3];
  if (!path.isAbsolute(profile || '') || !path.basename(profile).startsWith('cloudberth-cookie-migration-') ||
      !path.isAbsolute(legacyPath || '') || path.basename(legacyPath) !== LEGACY_NAME ||
      !path.isAbsolute(dataPath || '') || path.basename(dataPath) !== PRODUCT_NAME) {
    app.exit(1); return;
  }
  // Electron initializes its macOS Keychain identity before ready. Only this
  // isolated helper uses the old name to decrypt old Cookies through Electron.
  app.setName(LEGACY_NAME);
  app.setPath('userData', legacyPath);
  if (!app.requestSingleInstanceLock()) {
    process.send({ type: 'error', message: '请先退出旧版 CloudGameShell，再打开 CloudBerth 迁移数据。' }, () => app.exit(1));
    return;
  }
  try {
    // Windows uses "lockfile" while macOS uses Singleton*. The target profile
    // already holds its own lock; replacing it would fail or break exclusion.
    const excluded = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile', MARKER,
      'logs', 'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache']);
    // Migrate application data and persistent sessions, not the browser's live
    // root process state (Crashpad, metrics, locks, or Local State). The target
    // owns a fresh encryption state; legacy Local State is used only below in
    // the isolated decrypting helper.
    for (const relative of ['config.json', 'launcher.json', 'window-state.json', 'Partitions']) {
      const source = path.join(legacyPath, relative);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(dataPath, relative), {
        recursive: true, filter: (file) => !excluded.has(path.basename(file))
      });
    }
    if (fs.existsSync(path.join(legacyPath, 'Local State'))) {
      fs.copyFileSync(path.join(legacyPath, 'Local State'), path.join(profile, 'Local State'));
    }
    for (const relative of ['Partitions/cloud-game', 'Partitions/cloud-game/Network']) {
      const source = path.join(legacyPath, relative);
      if (!fs.existsSync(source)) continue;
      const destination = path.join(profile, relative);
      fs.mkdirSync(destination, { recursive: true });
      for (const file of fs.readdirSync(source).filter((name) => /^Cookies(?:-|$)/.test(name))) {
        fs.copyFileSync(path.join(source, file), path.join(destination, file));
      }
    }
  } catch (error) {
    app.releaseSingleInstanceLock();
    // Include only an error code and filename, never profile contents or a
    // decrypted Cookie. This makes cross-platform copy failures diagnosable.
    const detail = [error.code, error.syscall, error.path && path.basename(error.path)].filter(Boolean).join(', ');
    process.send({ type: 'error', message: `无法复制旧版数据${detail ? `（${detail}）` : ''}；原目录保持完整，请重试。` }, () => app.exit(1));
    return;
  }
  app.releaseSingleInstanceLock();
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  app.whenReady().then(async () => {
    const cookies = await session.fromPartition(SESSION_PARTITION).cookies.get({});
    process.send({ type: 'cookies', cookies }, () => app.quit());
  }).catch(() => app.exit(1));
}

async function migrateLegacyCookies(app, session, migration, {
  executable = process.execPath,
  workerArgs = app.isPackaged ? [] : [app.getAppPath()]
} = {}) {
  if (!migration.legacyPath) return;
  fs.writeFileSync(path.join(migration.dataPath, MARKER), JSON.stringify({ status: 'pending', version: 1 }));
  const cookieProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudberth-cookie-migration-'));
  fs.chmodSync(cookieProfile, 0o700);
  try {
    const cookies = await new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(executable, [...workerArgs, EXPORT_FLAG, cookieProfile, migration.legacyPath, migration.dataPath], {
        env, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
      });
      let result;
      let failure;
      const timer = setTimeout(() => { child.kill(); reject(new Error('登录数据迁移超时，请重新打开 CloudBerth。')); }, 120000);
      child.on('message', (message) => {
        if (message?.type === 'cookies' && Array.isArray(message.cookies)) result = message.cookies;
        if (message?.type === 'error') failure = message.message;
      });
      child.once('error', () => { clearTimeout(timer); reject(new Error('无法启动登录数据迁移，请重新打开 CloudBerth。')); });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0 && result) resolve(result);
        else reject(new Error(failure || '登录数据迁移未完成；旧数据已保留，请重新打开 CloudBerth。'));
      });
    });
    const target = session.fromPartition(SESSION_PARTITION);
    for (const cookie of cookies) {
      const details = {
        url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`,
        name: cookie.name, value: cookie.value, path: cookie.path,
        secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite
      };
      if (!cookie.hostOnly) details.domain = cookie.domain;
      if (!cookie.session) details.expirationDate = cookie.expirationDate;
      await target.cookies.set(details);
    }
    await target.cookies.flushStore();
    fs.writeFileSync(path.join(migration.dataPath, MARKER), JSON.stringify({ status: 'complete', version: 1 }));
  } finally {
    // No decrypted cookies are written to a file, log or renderer. The helper
    // sends them only over a private parent/child IPC channel for re-encryption.
    fs.rmSync(cookieProfile, { recursive: true, force: true });
  }
}

module.exports = { PRODUCT_NAME, APP_ID, SESSION_PARTITION, configureIdentity,
  isLegacyCookieWorker, startLegacyCookieWorker, migrateLegacyCookies };
