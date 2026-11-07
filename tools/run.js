'use strict';

// Use the same commands in Terminal, PowerShell and CI without shell-specific
// environment-variable syntax. Explicit caller settings always take priority.
const { spawn } = require('node:child_process');
const path = require('node:path');

const [action, ...extra] = process.argv.slice(2);
const root = path.resolve(__dirname, '..');
const electronCommands = {
  start: ['.'],
  manual: ['.', '--manual-test'],
  close: ['tools/close-smoke.js'],
  launcher: ['tools/launcher-smoke.js'],
  runtime: ['tools/runtime-smoke.js'],
  shortcuts: ['tools/shortcut-smoke.js'],
  screenshots: ['tools/capture-readme.js'],
  'mac-test': ['tools/mac-smoke.js'],
  'win-test': ['tools/windows-smoke.js']
};
let executable;
let args;
if (electronCommands[action]) {
  executable = require('electron');
  args = [...electronCommands[action], ...extra];
} else if (action === 'pack' || action === 'dist') {
  executable = process.execPath;
  args = [require.resolve('electron-builder/cli.js')];
  if (extra.length) {
    args.push(...extra);
  } else if (process.platform === 'darwin') {
    args.push('--mac', `--${process.arch}`);
  } else if (process.platform === 'win32') {
    args.push('--win', '--x64');
  } else {
    throw new Error('Build on macOS or Windows, or specify a target explicitly.');
  }
  if (action === 'pack') args.push('--dir');
} else {
  throw new Error(`Unknown command: ${action}`);
}

const env = { ...process.env };
// Electron is an application here, even when the parent is an Electron editor.
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit' });
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
