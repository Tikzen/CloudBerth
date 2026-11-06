'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SHORTCUT_ACTIONS = Object.freeze([
  'toggleDisplay',
  'quit',
  'home'
]);
const MAC_SHORTCUT_DEFAULTS = Object.freeze({
  toggleDisplay: 'Shift+Meta+F', quit: 'Meta+Q', home: 'Shift+Meta+H'
});

function migrateShortcutDefaults(shortcuts, platform = process.platform) {
  const result = { ...shortcuts };
  if (platform === 'darwin' && result.toggleDisplay === 'Ctrl+Meta+F' &&
      ![result.home, result.quit].includes(MAC_SHORTCUT_DEFAULTS.toggleDisplay)) {
    result.toggleDisplay = MAC_SHORTCUT_DEFAULTS.toggleDisplay;
  }
  return result;
}

const KEY_ALIASES = Object.freeze({
  control: 'Ctrl',
  ctrl: 'Ctrl',
  command: 'Meta',
  cmd: 'Meta',
  meta: 'Meta',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  space: 'Space',
  spacebar: 'Space',
  return: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown'
});

const NAMED_KEYS = new Set([
  'Tab', 'Space', 'Enter', 'Backspace', 'Delete', 'Insert',
  'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
]);

function normalizeKey(rawKey) {
  const trimmed = String(rawKey).trim();
  const alias = KEY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  if (/^[a-z]$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9]$/.test(trimmed)) return trimmed;
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const named = [...NAMED_KEYS].find(
    (candidate) => candidate.toLowerCase() === trimmed.toLowerCase()
  );
  return named || null;
}

function normalizeShortcut(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('快捷键不能为空。');
  }

  const parts = value.split('+').map((part) => part.trim()).filter(Boolean);
  const modifiers = new Set();
  let key = null;
  for (const part of parts) {
    const normalized = normalizeKey(part);
    if (['Ctrl', 'Alt', 'Shift', 'Meta'].includes(normalized)) {
      modifiers.add(normalized);
    } else if (normalized && key === null) {
      key = normalized;
    } else {
      throw new Error(`不支持的快捷键：${value}`);
    }
  }

  if (!key) throw new Error(`快捷键缺少主键：${value}`);
  if (key === 'Escape') throw new Error('ESC 必须保留给游戏使用。');
  if (key === 'F12') throw new Error('F12 保留给开发者工具。');
  if (!/^F\d+$/.test(key) && modifiers.size === 0) {
    throw new Error('字母、数字和普通按键至少需要一个 Ctrl、Alt、Shift 或 Meta 修饰键。');
  }

  return [
    ...['Ctrl', 'Alt', 'Shift', 'Meta'].filter((item) => modifiers.has(item)),
    key
  ].join('+');
}

function validateShortcuts(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('shortcuts 必须是对象。');
  }
  const shortcuts = {};
  const used = new Set();
  for (const action of SHORTCUT_ACTIONS) {
    const shortcut = normalizeShortcut(raw[action]);
    if (used.has(shortcut)) {
      throw new Error(`快捷键重复：${shortcut}`);
    }
    used.add(shortcut);
    shortcuts[action] = shortcut;
  }
  return shortcuts;
}

function validateGame(raw, { allowFileUrl = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('游戏条目格式无效。');
  }
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > 80) {
    throw new Error('游戏名称长度必须为 1–80 个字符。');
  }
  if (typeof raw.url !== 'string' || raw.url.length > 2048) {
    throw new Error(`“${name}”的网址无效。`);
  }
  let parsed;
  try {
    parsed = new URL(raw.url);
  } catch {
    throw new Error(`“${name}”的网址不是合法 URL。`);
  }
  if (parsed.protocol !== 'https:' &&
      !(allowFileUrl && parsed.protocol === 'file:')) {
    throw new Error(`“${name}”只允许使用 HTTPS 网址。`);
  }
  const icons = {};
  for (const key of ['icon', 'siteIcon']) {
    if (raw[key] == null || raw[key] === '') continue;
    if (typeof raw[key] !== 'string' || raw[key].length > 200000 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(raw[key])) {
      throw new Error(`“${name}”的头像无效，请重新选择图片。`);
    }
    icons[key] = raw[key];
  }
  return {
    id: typeof raw.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(raw.id)
      ? raw.id
      : randomUUID(),
    name,
    url: parsed.href,
    ...icons
  };
}

function validateGames(raw, options) {
  if (!Array.isArray(raw)) throw new Error('games 必须是数组。');
  if (raw.length > 100) throw new Error('游戏列表最多保存 100 项。');
  const games = raw.map((game) => validateGame(game, options));
  const ids = new Set();
  for (const game of games) {
    if (ids.has(game.id)) throw new Error(`游戏 ID 重复：${game.id}`);
    ids.add(game.id);
  }
  return games;
}

function getLibraryPath(app) {
  return path.join(app.getPath('userData'), 'launcher.json');
}

function createLibraryStore(app, config, logger, { allowFileUrl = false } = {}) {
  const filePath = getLibraryPath(app);
  const initial = {
    version: 1,
    games: [{
      id: randomUUID(),
      name: '默认游戏',
      url: config.startUrl
    }],
    shortcuts: config.shortcuts
  };
  let state;

  try {
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    state = {
      version: 1,
      games: validateGames(stored.games, { allowFileUrl }),
      shortcuts: validateShortcuts(stored.shortcuts),
      shortcutDefaultsVersion: 2
    };
    if (stored.shortcutDefaultsVersion !== 2) {
      state.shortcuts = migrateShortcutDefaults(state.shortcuts);
      persist();
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn('Could not load launcher settings; defaults restored', error.message);
    }
    state = {
      version: 1,
      games: validateGames(initial.games, { allowFileUrl }),
      shortcuts: migrateShortcutDefaults(validateShortcuts(initial.shortcuts)),
      shortcutDefaultsVersion: 2
    };
    persist();
  }

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(state));
  }

  return {
    filePath,
    getState: snapshot,
    getGames: () => snapshot().games,
    getShortcuts: () => ({ ...state.shortcuts }),
    setSiteIcon(id, url, icon) {
      const game = state.games.find((item) => item.id === id && item.url === url);
      if (!game || game.siteIcon === icon) return false;
      const validated = validateGame({ ...game, siteIcon: icon }, { allowFileUrl });
      Object.assign(game, validated);
      persist();
      return true;
    },
    saveGames(rawGames) {
      state.games = validateGames(rawGames, { allowFileUrl });
      persist();
      logger.info('Game library updated', { count: state.games.length });
      return snapshot();
    },
    saveShortcuts(rawShortcuts) {
      state.shortcuts = validateShortcuts(rawShortcuts);
      persist();
      logger.info('Shortcuts updated', state.shortcuts);
      return snapshot();
    }
  };
}

module.exports = {
  SHORTCUT_ACTIONS,
  MAC_SHORTCUT_DEFAULTS,
  migrateShortcutDefaults,
  createLibraryStore,
  normalizeShortcut,
  validateGame,
  validateGames,
  validateShortcuts
};
