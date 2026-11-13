'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createUpdateService, downloadFile } = require('../src/updater');
const { MAC_HELPER, windowsHelper } = require('../src/updater/install');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
(async () => {
 const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudberth-updates-'));
 try {
  const data = Buffer.from('verified update fixture');
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  const base = 'https://github.com/Tikzen/CloudBerth/releases/download/v1.5.0/';
  const release = { tag_name: 'v1.5.0', name: 'CloudBerth 1.5.0', body: '<script>not executable</script>', assets: [
   { name: 'CloudBerth-1.5.0-mac-arm64.zip', browser_download_url: base + 'CloudBerth-1.5.0-mac-arm64.zip', size: data.length },
   { name: 'SHA256SUMS.txt', browser_download_url: base + 'SHA256SUMS.txt' }
  ] };
  let requests = 0, prepared = 0, installed = 0, quit = 0;
  const app = { getPath: () => temp, getVersion: () => '1.4.0', isPackaged: true, quit: () => quit++ };
  const changes = [];
  const fetcher = async (url) => { requests++; return new Response(url.includes('api.github') ? JSON.stringify([release])
   : url.endsWith('SHA256SUMS.txt') ? `${hash}  ${release.assets[0].name}\n` : data); };
  const options = { app, logger: { warn() {} }, fetcher, platform: 'darwin', arch: 'arm64', onChange: (s) => changes.push(s),
   prepare: async ({ file }) => { assert.deepEqual(await fs.readFile(file), data); prepared++; return {}; }, install: async () => installed++ };
  const service = createUpdateService(options);
  await Promise.all([service.check(), service.check()]);
  assert.equal(requests, 1, 'Concurrent checks must share one request');
  await service.skip();
  const again = createUpdateService(options);
  assert.equal((await again.getState()).skippedVersion, 'v1.5.0');
  assert.equal((await again.check()).status, 'available', 'Manual checks must still find a skipped update');
  assert.equal((await service.download()).status, 'ready');
  assert.equal(prepared, 1); assert(changes.some((s) => s.received === data.length && s.progress === 1));
  await service.restart(); assert.equal(installed, 1); assert.equal(quit, 1);
  const corrupt = path.join(temp, 'corrupt.zip');
  await assert.rejects(downloadFile({ fetcher: async () => new Response(data), asset: release.assets[0], destination: corrupt,
   expectedHash: '0'.repeat(64), signal: new AbortController().signal, onProgress() {} }), /校验失败/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(downloadFile({ fetcher: async () => new Response(data), asset: release.assets[0], destination: path.join(temp, 'cancel.zip'),
   expectedHash: hash, signal: controller.signal, onProgress() {} }));
  // Exercise real macOS helper file replacement and rollback against isolated fake bundles.
  if (process.platform !== 'win32') {
   const script = path.join(temp, 'install.sh');
   const target = path.join(temp, 'Original app'), candidate = path.join(temp, 'Candidate app'), backup = path.join(temp, 'Backup app');
   const marker = path.join(temp, 'result.json');
   await fs.writeFile(target, 'old'); await fs.writeFile(candidate, 'new');
   await fs.writeFile(script, MAC_HELPER.replaceAll('/usr/bin/open', '/usr/bin/true'));
   await exec('/bin/sh', [script, '99999999', target, candidate, backup, marker]);
   assert.equal(await fs.readFile(target, 'utf8'), 'new'); assert.equal(await fs.readFile(backup, 'utf8'), 'old');
   await fs.rm(backup);
   await assert.rejects(exec('/bin/sh', [script, '99999999', target, path.join(temp, 'missing'), backup, marker]));
   assert.equal(await fs.readFile(target, 'utf8'), 'new', 'Original app must be restored after replacement fails');
  }
  if (process.platform === 'win32') {
   const target = path.join(temp, 'CloudBerth test.exe'), candidate = path.join(temp, 'candidate.exe'), backup = path.join(temp, 'backup.exe');
   const result = path.join(temp, 'windows-result.json');
   const binary = path.join(process.env.SystemRoot, 'System32', 'whoami.exe');
   const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
   await fs.copyFile(binary, target); await fs.copyFile(binary, candidate);
   const run = (c) => exec(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsHelper(c), 'utf16le').toString('base64')], { windowsHide: true });
   await run({ target, candidate, backup, result, pid: 99999999 });
   assert.deepEqual(await fs.readFile(target), await fs.readFile(binary));
   assert.deepEqual(await fs.readFile(backup), await fs.readFile(binary));
   await fs.rm(backup);
   await assert.rejects(run({ target, candidate: path.join(temp, 'missing.exe'), backup, result, pid: 99999999 }));
   assert.deepEqual(await fs.readFile(target), await fs.readFile(binary), 'Native Windows helper must roll back');
  }
  service.dispose(); again.dispose();
  console.log('PASS: streamed update, persisted skips, duplicate checks, checksum rejection, cancellation, restart and helper rollback.');
 } finally { await fs.rm(temp, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
