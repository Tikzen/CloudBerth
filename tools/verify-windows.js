'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist/windows');
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const application = path.join(output, 'win-unpacked');
const exe = fs.readFileSync(path.join(application, 'CloudBerth.exe'));
assert.equal(exe.toString('ascii', 0, 2), 'MZ');
const pe = exe.readUInt32LE(0x3c);
assert.equal(exe.toString('ascii', pe, pe + 4), 'PE\0\0');
assert.equal(exe.readUInt16LE(pe + 4), 0x8664, 'The game application must be Windows x64');

const archive = path.join(application, 'resources/app.asar');
const packageJson = JSON.parse(asar.extractFile(archive, 'package.json'));
assert.deepEqual(JSON.parse(asar.extractFile(archive, 'config.default.json')).shortcuts,
  { toggleDisplay: 'Alt+Shift+F', quit: 'Alt+Q', home: 'Alt+Shift+H' });
for (const key of ['name', 'productName', 'version', 'description']) {
  assert.equal(packageJson[key], sourcePackage[key]);
}
for (const file of ['main.js', 'src/identity.js', 'src/platform.js', 'src/runtime.js',
  'src/window.js', 'src/shortcuts.js', 'src/preload.js', 'src/launcher/index.html',
  'src/launcher/app.js', 'src/launcher/styles.css', 'src/launcher/brand-mark.svg',
  'build/icon.png', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  assert(asar.extractFile(archive, file).equals(fs.readFileSync(path.join(root, file))), file);
}
assert(!asar.listPackage(archive).map((file) => file.replaceAll('\\', '/')).some((file) =>
  /^\/(tools|tmp|docs|node_modules)\//.test(file) || /(^|\/)(launcher|config)\.json$/.test(file)));

const artifact = `CloudBerth-${sourcePackage.version}-x64.exe`;
const portable = fs.readFileSync(path.join(output, artifact));
assert.equal(portable.toString('ascii', 0, 2), 'MZ', 'The portable launcher must be a Windows executable');
const digest = crypto.createHash('sha256').update(portable).digest('hex');
fs.writeFileSync(path.join(output, 'SHA256SUMS-windows.txt'), `${digest}  ${artifact}\n`);
console.log('PASS: Windows x64 PE architecture, production source and metadata, excluded personal/developer data, portable executable and SHA-256.');
