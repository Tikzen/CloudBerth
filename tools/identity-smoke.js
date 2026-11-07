'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudberth-identity-test-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function run(stage) {
  const result = spawnSync(require('electron'), [path.join(__dirname, 'identity-fixture.js'), stage, temp], {
    env, encoding: 'utf8', timeout: 60000
  });
  assert.equal(result.status, 0, `${stage} failed: ${result.stdout}\n${result.stderr}`);
}
async function test() {
let holder;
try {
  run('seed');
  const legacy = path.join(temp, 'CloudGameShell');
  const cookieFile = ['Partitions/cloud-game/Cookies', 'Partitions/cloud-game/Network/Cookies']
    .map((relative) => path.join(legacy, relative)).find((file) => fs.existsSync(file));
  assert(cookieFile, 'The seeded legacy Cookie database must exist');
  const cookiesBefore = hash(cookieFile);
  const libraryBefore = hash(path.join(legacy, 'launcher.json'));
  holder = spawn(require('electron'), [path.join(__dirname, 'identity-fixture.js'), 'busy-legacy', temp], {
    env, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Legacy lock fixture timed out')), 10000);
    holder.once('message', () => { clearTimeout(timer); resolve(); });
    holder.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
  run('blocked');
  await new Promise((resolve) => { holder.once('exit', resolve); holder.kill(); });
  holder = null;
  run('migrate');
  assert.equal(hash(cookieFile), cookiesBefore);
  assert.equal(hash(path.join(legacy, 'launcher.json')), libraryBefore);
  run('reopen');
  console.log('PASS: CloudBerth name, data directory and app identity; legacy settings, encrypted Cookies and localStorage migrate and survive restart.');
  console.log('PASS: legacy profile untouched; existing CloudBerth data takes priority; no personal profile accessed.');
  console.log('PASS: running legacy app blocks copying; pending migration retries successfully after the old app exits.');
} finally {
  if (holder) holder.kill();
  fs.rmSync(temp, { recursive: true, force: true });
}
}
test().catch((error) => { console.error(error.message); process.exitCode = 1; });
