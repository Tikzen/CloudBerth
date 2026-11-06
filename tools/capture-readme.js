'use strict';

// Reproducible documentation screenshots. All games, icons and running states
// below are synthetic examples; no real profile, account or website is loaded.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { MAC_SHORTCUT_DEFAULTS } = require('../src/library');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudberth-readme-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);
let state = {
  version: 1, revision: 1, shortcutDefaultsVersion: 2,
  shortcuts: { ...MAC_SHORTCUT_DEFAULTS }, defaultShortcuts: { ...MAC_SHORTCUT_DEFAULTS },
  runningGameIds: ['adventure'],
  games: [
    { id: 'adventure', name: '云端冒险', url: 'https://adventure.example.com/' },
    { id: 'racing', name: '极速赛道', url: 'https://racing.example.com/' },
    { id: 'space', name: '星际远航', url: 'https://space.example.com/' }
  ]
};
ipcMain.handle('launcher:get-state', () => state);
ipcMain.handle('launcher:set-shortcut-capture', () => true);
const timer = setTimeout(() => { console.error('Documentation capture timed out'); app.exit(1); }, 20000);

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1280, height: 760, useContentSize: true, show: false,
    webPreferences: { preload: path.join(__dirname, '../src/preload.js'), sandbox: true,
      contextIsolation: true, nodeIntegration: false } });
  const js = (code) => window.webContents.executeJavaScript(code, true);
  await window.loadFile(path.join(__dirname, '../src/launcher/index.html'));
  const icons = await js(`(() => {
    const colors = [['#1d2753','#8867d9','#f8d6ae'],['#163c50','#2d98a7','#acf4d6'],['#35244e','#a85e94','#ffda99']];
    return colors.map(([dark,light,accent], index) => {
      const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');
      const fill=g.createLinearGradient(0,0,256,256);fill.addColorStop(0,light);fill.addColorStop(1,dark);g.fillStyle=fill;g.fillRect(0,0,256,256);
      g.fillStyle=accent;g.globalAlpha=.85;
      if(index===0){g.beginPath();g.arc(182,76,30,0,Math.PI*2);g.fill();g.fillStyle='#252c60';g.beginPath();g.moveTo(0,226);g.lineTo(86,83);g.lineTo(175,226);g.closePath();g.fill();g.fillStyle='#6658a7';g.beginPath();g.moveTo(95,256);g.lineTo(183,138);g.lineTo(270,256);g.closePath();g.fill();}
      if(index===1){g.save();g.translate(128,128);g.rotate(-.52);g.fillStyle=accent;g.fillRect(-24,-76,48,152);g.fillStyle=dark;g.fillRect(-14,-64,28,35);g.fillRect(-14,29,28,35);g.restore();g.globalAlpha=.24;for(let i=0;i<5;i++){g.fillStyle=accent;g.fillRect(20+i*48,0,5,256);}}
      if(index===2){g.strokeStyle=accent;g.lineWidth=12;g.beginPath();g.ellipse(128,128,91,32,-.42,0,Math.PI*2);g.stroke();g.fillStyle=accent;g.beginPath();g.arc(128,128,49,0,Math.PI*2);g.fill();g.globalAlpha=.7;for(const [x,y,r] of [[42,48,3],[206,65,5],[208,215,3],[61,198,4]]){g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();}}
      return c.toDataURL('image/png');
    });
  })()`);
  state = { ...state, revision: 2, games: state.games.map((game, index) => ({ ...game, icon: icons[index] })) };
  window.webContents.send('launcher:state-changed', state);
  const settle = async () => {
    await js('Promise.all([...document.images].map(i => i.decode().catch(() => {})))');
    await js('Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))');
    await new Promise((resolve) => setTimeout(resolve, 900));
  };
  const output = path.join(__dirname, '../docs/images');
  fs.mkdirSync(output, { recursive: true });
  await settle();
  fs.writeFileSync(path.join(output, 'launcher.png'), (await window.webContents.capturePage()).resize({ width: 1280 }).toPNG());
  await js('document.querySelector("#settingsButton").click()');
  await settle();
  fs.writeFileSync(path.join(output, 'shortcuts.png'), (await window.webContents.capturePage()).resize({ width: 1280 }).toPNG());
  window.destroy();
  clearTimeout(timer);
  console.log('PASS: README launcher and shortcuts screenshots captured from isolated sample data.');
  app.quit();
}).catch((error) => { console.error(error.message); app.exit(1); });
