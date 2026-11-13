'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('node:fs');
const { prepareInstallation, launchInstaller } = require('./install');

const RELEASES_API = 'https://api.github.com/repos/Tikzen/CloudBerth/releases?per_page=100';
const LIMIT = 1536 * 1024 * 1024;
function versionOf(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?$/.exec(value || '');
  return match ? match.slice(1, 4).map(Number) : null;
}
function compareVersions(a, b) {
  const x = versionOf(a), y = versionOf(b);
  if (!x || !y) throw new Error('版本号格式无效。');
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i]);
  return 0;
}
function trustedAsset(asset) {
  if (!asset || typeof asset.name !== 'string') return false;
  try {
    const url = new URL(asset.browser_download_url);
    return url.origin === 'https://github.com' && !url.username && !url.password &&
      url.pathname.startsWith('/Tikzen/CloudBerth/releases/download/') &&
      decodeURIComponent(url.pathname.split('/').at(-1)) === asset.name;
  } catch { return false; }
}
function selectRelease(releases, currentVersion, platform, arch) {
  if (!Array.isArray(releases)) throw new Error('更新服务器返回的数据无效。');
  if (!['darwin', 'win32'].includes(platform)) return null;
  const found = [];
  for (const release of releases) {
    if (!release || release.draft || !versionOf(release.tag_name) ||
        (platform === 'darwin' && release.prerelease) || compareVersions(release.tag_name, currentVersion) <= 0) continue;
    const version = versionOf(release.tag_name).join('.');
    const name = platform === 'darwin' ? `CloudBerth-${version}-mac-${arch}.zip` : `CloudBerth-${version}-${arch}.exe`;
    const checksumName = platform === 'darwin' ? 'SHA256SUMS.txt' : 'SHA256SUMS-windows.txt';
    const assets = Array.isArray(release.assets) ? release.assets.filter(trustedAsset) : [];
    const asset = assets.find((item) => item.name === name);
    const checksum = assets.find((item) => item.name === checksumName);
    if (!asset || !checksum) continue;
    found.push({ version, tag: release.tag_name, name: String(release.name || version),
      notes: String(release.body || '').slice(0, 16000), prerelease: Boolean(release.prerelease),
      asset, checksum });
  }
  found.sort((a, b) => compareVersions(b.version, a.version) || Number(a.prerelease) - Number(b.prerelease));
  return found[0] || null;
}
function checksumFor(text, name) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f\d]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (match && match[2] === name) return match[1].toLowerCase();
  }
  throw new Error('发行包缺少匹配的 SHA-256 校验值。');
}
async function request(fetcher, url, signal) {
  const response = await fetcher(url, { signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CloudBerth-Updater' } });
  if (!response.ok) throw new Error(response.status === 403 || response.status === 429
    ? 'GitHub 请求过于频繁，请稍后重试。' : `更新服务器暂时不可用（${response.status}）。`);
  return response;
}
async function downloadFile({ fetcher, asset, destination, expectedHash, signal, onProgress }) {
  const response = await request(fetcher, asset.browser_download_url, signal);
  const total = Number(response.headers.get('content-length')) || Number(asset.size) || 0;
  if (total > LIMIT) throw new Error('更新文件大小异常。');
  let received = 0;
  const hash = crypto.createHash('sha256');
  let last = 0;
  async function* chunks() {
    for await (const chunk of response.body) {
      if (signal.aborted) throw new Error('下载已取消。');
      received += chunk.length;
      if (received > LIMIT) throw new Error('更新文件大小异常。');
      hash.update(chunk);
      if (Date.now() - last > 100) { onProgress(received, total); last = Date.now(); }
      yield chunk;
    }
  }
  await pipeline(Readable.from(chunks()), createWriteStream(destination, { flags: 'wx' }), { signal });
  if ((total && received !== total) || !received) throw new Error('更新文件下载不完整，请重试。');
  if (hash.digest('hex') !== expectedHash) throw new Error('更新文件校验失败，请重新下载。');
  onProgress(received, total || received);
}

function createUpdateService({ app, logger, fetcher, onChange = () => {}, platform = process.platform, arch = process.arch,
  prepare = prepareInstallation, install = launchInstaller }) {
  const directory = path.join(app.getPath('userData'), 'updates');
  const prefs = path.join(directory, 'preferences.json');
  let state = { status: 'idle', currentVersion: app.getVersion(), release: null, received: 0, total: 0,
    progress: 0, error: '', trigger: 'automatic', skippedVersion: '' };
  let selected = null, prepared = null, job = null, controller = null, staging = null;
  let startupTimer, interval, disposed = false;
  const snapshot = () => JSON.parse(JSON.stringify(state));
  const change = (patch) => { state = { ...state, ...patch }; if (!disposed) onChange(snapshot()); };
  async function initialize() {
    try { state.skippedVersion = JSON.parse(await fs.readFile(prefs, 'utf8')).skippedVersion || ''; } catch { /* First run. */ }
    try {
      const markerPath = path.join(directory, 'result.json');
      const marker = JSON.parse((await fs.readFile(markerPath, 'utf8')).replace(/^\uFEFF/, ''));
      if (marker.version === app.getVersion() && marker.phase !== 'error') {
        // Only remove the updater-created sibling backup after the new version actually starts.
        if (marker.target && marker.backup && path.dirname(marker.target) === path.dirname(marker.backup) &&
            path.basename(marker.backup).startsWith('.CloudBerth-backup-')) await fs.rm(marker.backup, { recursive: true, force: true });
        await fs.rm(markerPath, { force: true });
      } else if (marker.phase === 'error' || marker.phase === 'installing') {
        state.status = 'error'; state.error = '上次更新未完成，已保留原程序。请重新检查更新。';
      }
    } catch { /* No previous installation. */ }
    change({});
  }
  const initialized = initialize();
  async function check(trigger = 'manual') {
    await initialized;
    if (job) return job;
    if (['ready', 'installing'].includes(state.status)) return snapshot();
    change({ status: 'checking', error: '', trigger });
    job = (async () => {
      try {
        const response = await request(fetcher, RELEASES_API, AbortSignal.timeout(20000));
        selected = selectRelease(await response.json(), app.getVersion(), platform, arch);
        change({ status: selected ? 'available' : 'current', release: selected ? {
          version: selected.version, tag: selected.tag, name: selected.name, notes: selected.notes,
          prerelease: selected.prerelease, size: selected.asset.size || 0
        } : null, progress: 0, received: 0, total: 0 });
      } catch (error) { logger.warn('Update check failed', error.message); change({ status: 'error', error: '检查更新失败，请检查网络后重试。' }); }
      return snapshot();
    })().finally(() => { job = null; });
    return job;
  }
  async function download() {
    await initialized;
    if (job) return job;
    if (state.status === 'ready') return snapshot();
    if (!selected) throw new Error('请先检查更新。');
    if (!app.isPackaged) throw new Error('开发运行不支持替换安装，请使用正式应用测试更新。');
    change({ status: 'downloading', received: 0, total: selected.asset.size || 0, progress: 0, error: '' });
    controller = new AbortController();
    const timer = setTimeout(() => controller?.abort(), 30 * 60 * 1000);
    job = (async () => {
      try {
        await fs.mkdir(directory, { recursive: true });
        staging = await fs.mkdtemp(path.join(directory, 'download-'));
        const response = await request(fetcher, selected.checksum.browser_download_url, controller.signal);
        const checksumText = await response.text();
        if (checksumText.length > 100000) throw new Error('校验文件大小异常。');
        const expectedHash = checksumFor(checksumText, selected.asset.name);
        const file = path.join(staging, selected.asset.name);
        await downloadFile({ fetcher, asset: selected.asset, destination: file, expectedHash, signal: controller.signal,
          onProgress: (received, total) => change({ received, total, progress: total ? Math.min(1, received / total) : 0 }) });
        change({ status: 'preparing', progress: 1 });
        prepared = await prepare({ app, platform, arch, file, staging, version: selected.version, directory });
        change({ status: 'ready' });
      } catch (error) {
        logger.warn('Update download failed', error.message);
        const cancelled = controller.signal.aborted;
        change({ status: cancelled ? 'available' : 'error', error: cancelled ? '' : `更新失败：${error.message}` });
        if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      } finally { clearTimeout(timer); controller = null; }
      return snapshot();
    })().finally(() => { job = null; });
    return job;
  }
  return {
    getState: async () => { await initialized; return snapshot(); }, check, download,
    cancel() { controller?.abort(); return snapshot(); },
    async skip() {
      if (state.status !== 'available' || !selected) throw new Error('当前没有可以跳过的版本。');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(prefs, JSON.stringify({ skippedVersion: selected.tag }));
      change({ skippedVersion: selected.tag }); return snapshot();
    },
    async restart() {
      if (state.status !== 'ready' || !prepared) throw new Error('更新尚未准备完成。');
      try {
        change({ status: 'installing', error: '' });
        await install({ ...prepared, directory, version: selected.version, pid: process.pid });
        app.quit();
      } catch (error) { change({ status: 'ready', error: `无法开始安装：${error.message}` }); }
      return snapshot();
    },
    start() {
      if (!app.isPackaged) return;
      startupTimer = setTimeout(() => { void check('automatic'); }, 15000);
      interval = setInterval(() => { void check('automatic'); }, 6 * 60 * 60 * 1000);
      startupTimer.unref?.(); interval.unref?.();
    },
    dispose() { disposed = true; clearTimeout(startupTimer); clearInterval(interval); controller?.abort(); }
  };
}
module.exports = { compareVersions, selectRelease, checksumFor, downloadFile, createUpdateService };
