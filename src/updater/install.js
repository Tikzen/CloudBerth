'use strict';

// Bypass Electron's virtual ASAR filesystem when removing staged app bundles.
const fs = (process.versions.electron ? require('original-fs') : require('node:fs')).promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile, spawn } = require('node:child_process');
const exec = promisify(execFile);

function installationTarget(platform, executable = process.execPath, env = process.env) {
  if (platform === 'darwin') {
    const target = path.posix.resolve(path.posix.dirname(executable), '../..');
    if (!target.endsWith('.app') || target.startsWith('/Volumes/')) throw new Error('请先把 CloudBerth 拖入“应用程序”，再从应用程序启动更新。');
    return target;
  }
  if (platform === 'win32') {
    const target = env.PORTABLE_EXECUTABLE_FILE;
    if (!target || !path.win32.isAbsolute(target) || !target.toLowerCase().endsWith('.exe')) throw new Error('请从 CloudBerth 便携 EXE 启动后再更新。');
    return target;
  }
  throw new Error('当前系统不支持应用内更新。');
}
async function prepareInstallation({ app, platform, file, staging, version, directory }) {
  const target = installationTarget(platform);
  const suffix = crypto.randomUUID();
  const candidate = path.join(path.dirname(target), `.CloudBerth-update-${suffix}${platform === 'darwin' ? '.app' : '.exe'}`);
  const backup = path.join(path.dirname(target), `.CloudBerth-backup-${suffix}${platform === 'darwin' ? '.app' : '.exe'}`);
  try {
    if (platform === 'darwin') {
      const { stdout } = await exec('/usr/bin/unzip', ['-Z', '-1', file], { maxBuffer: 4 * 1024 * 1024 });
      const entries = stdout.split(/\r?\n/).filter(Boolean);
      if (entries.some((entry) => entry.startsWith('/') || entry.split('/').includes('..') ||
          !(entry === 'CloudBerth.app' || entry.startsWith('CloudBerth.app/') || entry.startsWith('__MACOSX/')))) throw new Error('更新 ZIP 的目录结构无效。');
      const unpacked = path.join(staging, 'unpacked');
      await fs.mkdir(unpacked);
      await exec('/usr/bin/ditto', ['-x', '-k', file, unpacked]);
      const bundle = path.join(unpacked, 'CloudBerth.app');
      const plist = path.join(bundle, 'Contents/Info.plist');
      const read = async (key) => (await exec('/usr/libexec/PlistBuddy', ['-c', `Print:${key}`, plist])).stdout.trim();
      if (await read('CFBundleIdentifier') !== 'com.cloudberth.app' || await read('CFBundleShortVersionString') !== version) throw new Error('更新包的应用标识或版本不匹配。');
      await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
      await exec('/usr/bin/ditto', [bundle, candidate]);
    } else {
      const handle = await fs.open(file, 'r');
      try { const header = Buffer.alloc(64); await handle.read(header, 0, 64, 0); if (header.toString('ascii', 0, 2) !== 'MZ') throw new Error('下载文件不是 Windows 应用。'); }
      finally { await handle.close(); }
      await fs.copyFile(file, candidate, require('node:fs').constants.COPYFILE_EXCL);
    }
    return { platform, target, candidate, backup, directory };
  } catch (error) {
    await fs.rm(candidate, { recursive: true, force: true }).catch(() => {});
    throw new Error(`无法准备安装，请确认应用所在目录可写。${error.message}`);
  }
}
const MAC_HELPER = `#!/bin/sh
# Arguments are data, never interpolated into shell source.
pid="$1"; target="$2"; candidate="$3"; backup="$4"; result="$5"
fail() { printf '{"phase":"error"}\\n' > "$result"; }
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1)); if [ "$i" -ge 120 ]; then fail; exit 1; fi
  sleep 1
done
if ! /bin/mv "$target" "$backup"; then fail; /usr/bin/open -n "$target"; exit 1; fi
if ! /bin/mv "$candidate" "$target"; then /bin/mv "$backup" "$target"; fail; /usr/bin/open -n "$target"; exit 1; fi
if ! /usr/bin/open -n "$target"; then
  /bin/mv "$target" "$candidate"; /bin/mv "$backup" "$target"; fail; /usr/bin/open -n "$target"; exit 1
fi
`;
function windowsHelper(config) {
  const data = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
  return `$ErrorActionPreference = 'Stop'
$c = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
function Fail { '{"phase":"error"}' | Set-Content -LiteralPath $c.result -Encoding UTF8 }
try {
  $limit = (Get-Date).AddSeconds(120)
  while (Get-Process -Id $c.pid -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $limit) { Fail; exit 1 }; Start-Sleep -Milliseconds 250
  }
  $moved = $false
  for ($i=0; $i -lt 60; $i++) {
    try { Move-Item -LiteralPath $c.target -Destination $c.backup -ErrorAction Stop; $moved=$true; break }
    catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $moved) { throw 'Original executable remains locked' }
  Move-Item -LiteralPath $c.candidate -Destination $c.target
  Start-Process -FilePath $c.target -WorkingDirectory (Split-Path -LiteralPath $c.target) -ErrorAction Stop
} catch {
  Fail
  if (Test-Path -LiteralPath $c.backup) {
    if (Test-Path -LiteralPath $c.target) { Move-Item -LiteralPath $c.target -Destination $c.candidate -Force }
    Move-Item -LiteralPath $c.backup -Destination $c.target
  }
  if (Test-Path -LiteralPath $c.target) { Start-Process -FilePath $c.target }
  exit 1
}
`;
}
async function launchInstaller(config) {
  const result = path.join(config.directory, 'result.json');
  await fs.writeFile(result, JSON.stringify({ phase: 'installing', version: config.version, target: config.target, backup: config.backup }));
  let command, args;
  if (config.platform === 'darwin') {
    const script = path.join(config.directory, 'install.sh');
    await fs.writeFile(script, MAC_HELPER, { mode: 0o700 });
    command = '/bin/sh'; args = [script, String(config.pid), config.target, config.candidate, config.backup, result];
  } else {
    command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsHelper({ ...config, result }), 'utf16le').toString('base64')];
  }
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
}
module.exports = { installationTarget, prepareInstallation, launchInstaller, windowsHelper, MAC_HELPER };
