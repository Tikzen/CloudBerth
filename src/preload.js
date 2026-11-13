'use strict';

const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:' &&
    location.pathname.replaceAll('\\', '/').endsWith('/launcher/index.html')) {
  contextBridge.exposeInMainWorld('cloudBerth', Object.freeze({
    platform: process.platform,
    getState: () => ipcRenderer.invoke('launcher:get-state'),
    saveGames: (games) => ipcRenderer.invoke('launcher:save-games', games),
    saveShortcuts: (shortcuts) =>
      ipcRenderer.invoke('launcher:save-shortcuts', shortcuts),
    setShortcutCapture: (active, action) =>
      ipcRenderer.invoke('launcher:set-shortcut-capture', Boolean(active), action),
    onShortcutCaptured: (callback) => {
      if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
      const listener = (_event, result) => callback(result);
      ipcRenderer.on('launcher:shortcut-captured', listener);
      return () => ipcRenderer.removeListener('launcher:shortcut-captured', listener);
    },
    launchGame: (id) => ipcRenderer.invoke('launcher:launch-game', id),
    stopGame: (id) => ipcRenderer.invoke('launcher:stop-game', id),
    chooseAvatar: () => ipcRenderer.invoke('launcher:choose-avatar'),
    fetchIcon: (url) => ipcRenderer.invoke('launcher:fetch-icon', url),
    onStateChanged: (callback) => {
      if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('launcher:state-changed', listener);
      return () => ipcRenderer.removeListener('launcher:state-changed', listener);
    },
    updates: Object.freeze({
      getState: () => ipcRenderer.invoke('updates:get-state'),
      check: () => ipcRenderer.invoke('updates:check'),
      download: () => ipcRenderer.invoke('updates:download'),
      cancel: () => ipcRenderer.invoke('updates:cancel'),
      skip: () => ipcRenderer.invoke('updates:skip'),
      restart: () => ipcRenderer.invoke('updates:restart'),
      onChange: (callback) => {
        if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('updates:changed', listener);
        return () => ipcRenderer.removeListener('updates:changed', listener);
      },
      onShow: (callback) => {
        if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
        const listener = () => callback();
        ipcRenderer.on('updates:show', listener);
        return () => ipcRenderer.removeListener('updates:show', listener);
      }
    }),
    quit: () => ipcRenderer.invoke('launcher:quit')
  }));
}
