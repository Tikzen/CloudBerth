'use strict';

const api = window.cloudBerth;
const displayShortcut = (value) => api.platform === 'darwin'
  ? value.replaceAll('Meta', 'Command').replaceAll('Alt', 'Option')
  : value;
const macKeySymbols = { Ctrl: '⌃', Option: '⌥', Shift: '⇧', Command: '⌘' };
const keyParts = (value) => displayShortcut(value).split(/\+(?=.)/)
  .map((key) => api.platform === 'darwin' ? macKeySymbols[key] || key : key);
const gameSection = document.querySelector('#gameSection');
const settingsSection = document.querySelector('#settingsSection');
const gameGrid = document.querySelector('#gameGrid');
const emptyState = document.querySelector('#emptyState');
const gameCount = document.querySelector('#gameCount');
const gameDialog = document.querySelector('#gameDialog');
const gameForm = document.querySelector('#gameForm');
const deleteDialog = document.querySelector('#deleteDialog');
const shortcutForm = document.querySelector('#shortcutForm');
const shortcutMessage = document.querySelector('#shortcutMessage');
const toast = document.querySelector('#toast');
const ambient = document.querySelector('#ambient');
let state = { games: [], shortcuts: {} };
let deleteTargetId = null;
let toastTimer = null;
let draftIcon = '';
let draftSiteIcon = '';
let iconRequest = 0;
const pendingLaunches = new Set();
let litGameIds = new Set();
const panelTones = new Map();
let recordingInput = null;
let recordingGeneration = 0;
let selectedGameId = null;
let ambientKey = null;
let ambientTimer = null;

function applyState(next) {
  if (next.revision != null && state.revision != null && next.revision < state.revision) return;
  state = { ...next, runningGameIds: next.runningGameIds || [] };
  renderGames();
  renderShortcutHint();
}

function avatarFor(name, icon, className = 'game-monogram') {
  const avatar = document.createElement('div');
  avatar.className = className;
  const letter = document.createElement('span');
  letter.textContent = [...name][0]?.toUpperCase() || 'G';
  avatar.append(letter);
  if (icon) {
    const image = document.createElement('img');
    image.alt = `${name}头像`;
    image.src = icon;
    image.addEventListener('error', () => { image.remove(); avatar.classList.remove('has-image'); });
    avatar.classList.add('has-image');
    avatar.append(image);
  }
  return avatar;
}

// The darkest colour a panel falls to: the avatar's main hue, kept saturated
// so a dimmed game still looks like itself rather than fading to black.
function toneOf(image) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, 16, 16);
  const { data } = context.getImageData(0, 0, 16, 16);
  let [red, green, blue, total] = [0, 0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const weight = (Math.max(data[i], data[i + 1], data[i + 2]) -
      Math.min(data[i], data[i + 1], data[i + 2])) / 255 + .04;
    red += data[i] * weight;
    green += data[i + 1] * weight;
    blue += data[i + 2] * weight;
    total += weight;
  }
  if (!total) return '';
  const [r, g, b] = [red / total, green / total, blue / total];
  const max = Math.max(r, g, b);
  const range = max - Math.min(r, g, b);
  if (!range) return '';
  const hue = max === r ? ((g - b) / range + 6) % 6
    : max === g ? (b - r) / range + 2 : (r - g) / range + 4;
  return `hsl(${Math.round(hue * 60)} 58% 25%)`;
}

// The avatar blurred into light, used for cards and the room behind them.
function lightFor(name, icon) {
  const light = document.createElement('div');
  light.className = 'game-light';
  if (icon) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = icon;
    image.addEventListener('error', () => image.remove());
    const applyTone = () => {
      if (!panelTones.has(icon)) panelTones.set(icon, toneOf(image));
      if (panelTones.get(icon)) light.style.setProperty('--panel-tone', panelTones.get(icon));
    };
    if (panelTones.has(icon)) applyTone();
    else image.addEventListener('load', applyTone, { once: true });
    light.append(image);
  }
  return light;
}

function renderDraftAvatar() {
  const typedName = document.querySelector('#gameName').value;
  const name = typedName || '游戏';
  const icon = draftIcon || draftSiteIcon;
  const index = state.games.findIndex((game) => game.id === document.querySelector('#gameId').value);
  const accent = `accent-${(index < 0 ? state.games.length : index) % 6}`;
  const stage = document.querySelector('#avatarPreview');
  stage.className = `poster-stage ${accent}`;
  stage.replaceChildren(lightFor(name, icon));
  const anchor = document.querySelector('#avatarAnchor');
  anchor.className = `poster-avatar ${accent}`;
  anchor.replaceChildren(avatarFor(name, icon));
  document.querySelector('#previewName').textContent = typedName || '游戏名称';
  document.querySelector('#avatarStatus').textContent = draftIcon
    ? '自定义头像' : draftSiteIcon ? '网站图标' : '自动获取网站图标；暂时没有图标时显示首字';
}

function closeRunMenus() {
  for (const menu of document.querySelectorAll('.run-menu')) menu.hidden = true;
  for (const button of document.querySelectorAll('.run-menu-toggle')) button.setAttribute('aria-expanded', 'false');
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
}

function renderShortcutHint() {
  const hints = [
    [state.shortcuts.toggleDisplay, '切换全屏'],
    [state.shortcuts.home, '返回游戏库'],
    [state.shortcuts.quit, '退出']
  ].map(([shortcut, label]) => {
    const hint = document.createElement('span');
    hint.className = 'legend-hint';
    const keys = document.createElement('kbd');
    keys.textContent = keyParts(shortcut).join(api.platform === 'darwin' ? '' : '+');
    hint.append(keys, label);
    return hint;
  });
  document.querySelector('#shortcutHint').replaceChildren(...hints);
}

function renderKeycaps(input) {
  const caps = keyParts(input.value).map((key) => {
    const cap = document.createElement('kbd');
    cap.textContent = key;
    return cap;
  });
  input.parentElement.querySelector('.keycaps').replaceChildren(...caps);
}

function selectedGame() {
  return state.games.find((game) => game.id === selectedGameId) || state.games[0];
}

// The room takes on the selected game's light, cross-fading from the last one.
function renderAmbient() {
  const game = selectedGame();
  const icon = game?.icon || game?.siteIcon || '';
  const key = game ? `${game.id}|${icon}` : '';
  if (key === ambientKey) return;
  ambientKey = key;
  if (!game) { ambient.replaceChildren(); return; }
  const light = lightFor(game.name, icon);
  light.classList.add(`accent-${state.games.indexOf(game) % 6}`);
  ambient.append(light);
  clearTimeout(ambientTimer);
  ambientTimer = setTimeout(() => {
    while (ambient.children.length > 1) ambient.firstElementChild.remove();
  }, 700);
}

function selectGame(id) {
  if (id === selectedGame()?.id) return;
  selectedGameId = id;
  for (const card of gameGrid.children) {
    const selected = card.dataset.gameId === id;
    card.classList.toggle('is-selected', selected);
    card.classList.toggle('just-selected', selected);
    if (selected) {
      card.querySelector('.game-tile').scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }
  closeRunMenus();
  renderAmbient();
}

function cardFor(game, index) {
  const article = document.createElement('article');
  const running = state.runningGameIds?.includes(game.id);
  const opening = pendingLaunches.has(game.id);
  article.className = `game-card accent-${index % 6}`;
  article.classList.toggle('is-running', Boolean(running));
  article.classList.toggle('just-lit', Boolean(running) && !litGameIds.has(game.id));
  article.classList.toggle('is-selected', game.id === selectedGameId);
  article.dataset.gameId = game.id;

  const tile = document.createElement('button');
  tile.className = 'game-tile';
  tile.type = 'button';
  tile.title = game.name;
  tile.setAttribute('aria-label', game.name);
  const tileName = document.createElement('span');
  tileName.className = 'tile-name';
  tileName.setAttribute('aria-hidden', 'true');
  tileName.textContent = game.name;
  tile.append(lightFor(game.name, game.icon || game.siteIcon),
    avatarFor(game.name, game.icon || game.siteIcon), tileName);
  if (running) {
    const status = document.createElement('span');
    status.className = 'tile-status';
    status.textContent = '运行中';
    tile.append(status);
  }
  tile.addEventListener('click', () => selectGame(game.id));
  tile.addEventListener('focus', () => selectGame(game.id));

  const top = document.createElement('div');
  top.className = 'game-info';
  const title = document.createElement('h3');
  title.textContent = game.name;
  const host = document.createElement('p');
  host.className = 'game-host';
  try {
    host.textContent = new URL(game.url).hostname || '本地测试页';
  } catch {
    host.textContent = game.url;
  }
  top.append(title, host);

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const controls = document.createElement('div');
  controls.className = `run-controls${running ? ' is-running' : ''}`;
  const play = document.createElement('button');
  play.className = 'primary-button play';
  play.type = 'button';
  play.disabled = opening && !running;
  play.textContent = running ? '运行中' : opening ? '正在打开…' : '开始游戏';
  play.title = running ? '回到正在运行的游戏窗口' : '在独立窗口中打开游戏';
  play.addEventListener('click', async () => {
    pendingLaunches.add(game.id);
    renderGames();
    try {
      applyState(await api.launchGame(game.id));
    } catch (error) {
      showToast(error.message);
    } finally {
      pendingLaunches.delete(game.id);
      renderGames();
    }
  });
  controls.append(play);
  if (running) {
    const toggle = document.createElement('button');
    toggle.className = 'primary-button run-menu-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', `${game.name}运行选项`);
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.className = 'run-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.setAttribute('role', 'menuitem');
    stop.textContent = '结束游戏';
    stop.addEventListener('click', async () => {
      stop.disabled = true;
      stop.textContent = '正在结束…';
      try { applyState(await api.stopGame(game.id)); }
      catch (error) { showToast(error.message); stop.disabled = false; stop.textContent = '结束游戏'; }
    });
    toggle.addEventListener('click', () => {
      const open = menu.hidden;
      closeRunMenus();
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) {
        menu.classList.toggle('open-up', menu.getBoundingClientRect().bottom > window.innerHeight - 12);
        stop.focus();
      }
    });
    menu.append(stop);
    controls.append(toggle, menu);
  }
  const edit = document.createElement('button');
  edit.className = 'ghost-button';
  edit.type = 'button';
  edit.textContent = '修改';
  edit.title = '修改游戏';
  edit.addEventListener('click', () => openGameDialog(game));
  const remove = document.createElement('button');
  remove.className = 'ghost-button';
  remove.type = 'button';
  remove.textContent = '删除';
  remove.disabled = Boolean(running);
  remove.title = running ? '请先结束正在运行的游戏' : '删除游戏入口';
  remove.addEventListener('click', () => openDeleteDialog(game));
  actions.append(controls, edit, remove);
  const detail = document.createElement('div');
  detail.className = 'game-detail';
  detail.append(top, actions);
  article.append(tile, detail);
  return article;
}

function renderGames() {
  selectedGameId = selectedGame()?.id ?? null;
  gameGrid.replaceChildren(...state.games.map(cardFor));
  renderAmbient();
  litGameIds = new Set(state.runningGameIds);
  gameCount.textContent = state.games.length
    ? `共 ${state.games.length} 个入口`
    : '';
  emptyState.hidden = state.games.length !== 0;
  gameGrid.hidden = state.games.length === 0;
}

function openGameDialog(game = null) {
  document.querySelector('#dialogTitle').textContent = game ? '修改游戏' : '添加游戏';
  document.querySelector('#gameId').value = game?.id || '';
  document.querySelector('#gameName').value = game?.name || '';
  document.querySelector('#gameUrl').value = game?.url || '';
  document.querySelector('#gameMessage').textContent = '';
  draftIcon = game?.icon || '';
  draftSiteIcon = game?.siteIcon || '';
  iconRequest++;
  renderDraftAvatar();
  document.querySelector('#gameUrl').readOnly = Boolean(game && state.runningGameIds?.includes(game.id));
  gameDialog.showModal();
  document.querySelector('#gameName').focus();
}

function openDeleteDialog(game) {
  deleteTargetId = game.id;
  document.querySelector('#deleteMessage').textContent =
    `“${game.name}”将从主页移除。登录会话和网站数据不会因此删除。`;
  deleteDialog.showModal();
}

async function saveGames(games) {
  applyState(await api.saveGames(games));
}

function showSettings() {
  for (const input of shortcutForm.querySelectorAll('[data-shortcut]')) {
    input.value = displayShortcut(state.shortcuts[input.dataset.shortcut]);
    renderKeycaps(input);
  }
  shortcutMessage.textContent = '';
  gameSection.hidden = true;
  settingsSection.hidden = false;
}

async function stopShortcutRecording() {
  recordingGeneration++;
  const input = recordingInput;
  recordingInput = null;
  if (input) {
    input.parentElement.classList.remove('is-recording');
    renderKeycaps(input);
  }
  try { await api.setShortcutCapture(false); }
  catch { /* The page may be closing; no recording state is persisted. */ }
}

async function startShortcutRecording(input) {
  await stopShortcutRecording();
  if (settingsSection.hidden || !input) return;
  const generation = ++recordingGeneration;
  recordingInput = input;
  input.focus();
  shortcutMessage.textContent = '正在开启快捷键录入…';
  shortcutMessage.classList.remove('error');
  try {
    await api.setShortcutCapture(true, input.dataset.shortcut);
    if (generation !== recordingGeneration || recordingInput !== input) return;
    input.parentElement.classList.add('is-recording');
    input.parentElement.querySelector('.keycaps').textContent = '请按组合键…';
    shortcutMessage.textContent = '正在录入，按下组合键；ESC 取消，Tab 离开。';
  } catch (error) {
    await stopShortcutRecording();
    shortcutMessage.textContent = error.message;
    shortcutMessage.classList.add('error');
  }
}

api.onShortcutCaptured((result) => {
  const input = recordingInput;
  if (!input || settingsSection.hidden || result.action !== input.dataset.shortcut) return;
  if (result.error) {
    shortcutMessage.textContent = result.error;
    shortcutMessage.classList.add('error');
    return;
  }
  if (result.shortcut) input.value = displayShortcut(result.shortcut);
  void stopShortcutRecording();
  input.blur();
  shortcutMessage.textContent = result.cancelled ? '已取消录入。' : '已录入，点击“保存快捷键”后生效。';
  shortcutMessage.classList.remove('error');
});

gameForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = document.querySelector('#gameId').value;
  const game = {
    ...(id ? { id } : {}),
    name: document.querySelector('#gameName').value,
    url: document.querySelector('#gameUrl').value,
    icon: draftIcon, siteIcon: draftSiteIcon
  };
  const games = id
    ? state.games.map((item) => item.id === id ? game : item)
    : [...state.games, game];
  try {
    await saveGames(games);
    gameDialog.close();
    showToast(id ? '游戏已更新' : '游戏已添加');
  } catch (error) {
    document.querySelector('#gameMessage').textContent = error.message;
  }
});

document.querySelector('#deleteConfirmButton').addEventListener('click', async () => {
  try {
    await saveGames(state.games.filter((game) => game.id !== deleteTargetId));
    deleteDialog.close();
    showToast('游戏已删除');
  } catch (error) {
    showToast(error.message);
  }
});

shortcutForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const shortcuts = {};
  for (const input of shortcutForm.querySelectorAll('[data-shortcut]')) {
    shortcuts[input.dataset.shortcut] = input.value;
  }
  try {
    await stopShortcutRecording();
    applyState(await api.saveShortcuts(shortcuts));
    document.activeElement?.blur();
    shortcutMessage.textContent = '已保存，立即生效。';
    shortcutMessage.classList.remove('error');
  } catch (error) {
    shortcutMessage.textContent = error.message;
    shortcutMessage.classList.add('error');
  }
});

for (const input of shortcutForm.querySelectorAll('[data-shortcut]')) {
  input.addEventListener('dblclick', () => { void startShortcutRecording(input); });
  input.addEventListener('blur', () => {
    if (recordingInput === input) void stopShortcutRecording();
  });
  input.addEventListener('keydown', (event) => {
    // The main process records the key; ordinary single-click focus is inert.
    if (event.key !== 'Tab') event.preventDefault();
  });
}
for (const button of shortcutForm.querySelectorAll('[data-reset-shortcut]')) {
  button.addEventListener('click', async () => {
    await stopShortcutRecording();
    const action = button.dataset.resetShortcut;
    const input = shortcutForm.querySelector(`[data-shortcut="${action}"]`);
    input.value = displayShortcut(state.defaultShortcuts[action]);
    renderKeycaps(input);
    shortcutMessage.textContent = '已恢复默认，点击“保存快捷键”后生效。';
    shortcutMessage.classList.remove('error');
  });
}
window.addEventListener('blur', () => {
  if (recordingInput) void stopShortcutRecording();
});

document.querySelector('#addButton').addEventListener('click', () => openGameDialog());
document.querySelector('#emptyAddButton').addEventListener('click', () => openGameDialog());
document.querySelector('#settingsButton').addEventListener('click', showSettings);
document.querySelector('#settingsCloseButton').addEventListener('click', () => {
  void stopShortcutRecording();
  settingsSection.hidden = true;
  gameSection.hidden = false;
});
document.querySelector('#dialogCloseButton').addEventListener('click', () => gameDialog.close());
document.querySelector('#cancelButton').addEventListener('click', () => gameDialog.close());
document.querySelector('#deleteCancelButton').addEventListener('click', () => deleteDialog.close());

document.addEventListener('click', (event) => {
  if (!event.target.closest('.run-controls')) closeRunMenus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeRunMenus();
});
document.querySelector('#gameName').addEventListener('input', renderDraftAvatar);
document.querySelector('#gameUrl').addEventListener('input', () => {
  draftSiteIcon = '';
  iconRequest++;
  renderDraftAvatar();
});
document.querySelector('#chooseAvatarButton').addEventListener('click', async () => {
  const request = ++iconRequest;
  try {
    const icon = await api.chooseAvatar();
    if (icon && gameDialog.open && request === iconRequest) {
      draftIcon = icon;
      renderDraftAvatar();
    }
  } catch (error) { document.querySelector('#gameMessage').textContent = error.message; }
});
document.querySelector('#autoAvatarButton').addEventListener('click', async () => {
  const request = ++iconRequest;
  draftIcon = '';
  renderDraftAvatar();
  const url = document.querySelector('#gameUrl').value;
  if (!url) return;
  document.querySelector('#avatarStatus').textContent = '正在获取网站图标…';
  try {
    const icon = await api.fetchIcon(url);
    if (gameDialog.open && request === iconRequest) {
      draftSiteIcon = icon || '';
      renderDraftAvatar();
    }
  } catch (error) {
    if (request === iconRequest) {
      renderDraftAvatar();
      document.querySelector('#gameMessage').textContent = error.message;
    }
  }
});
// Purely visual: a soft highlight follows the pointer across a card.
gameGrid.addEventListener('pointermove', (event) => {
  const tile = event.target.closest('.game-tile');
  if (!tile) return;
  const box = tile.getBoundingClientRect();
  tile.style.setProperty('--pointer-x', `${event.clientX - box.left}px`);
  tile.style.setProperty('--pointer-y', `${event.clientY - box.top}px`);
});
// The row scrolls sideways, so a plain mouse wheel should move it too.
gameGrid.addEventListener('wheel', (event) => {
  if (!event.deltaX) gameGrid.scrollLeft += event.deltaY;
}, { passive: true });
// Left and right walk the row, as on a console home screen.
document.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || gameSection.hidden) return;
  if (document.querySelector('dialog[open]') || event.target.closest('.run-controls')) return;
  const index = state.games.indexOf(selectedGame()) + (event.key === 'ArrowLeft' ? -1 : 1);
  const game = state.games[index];
  if (!game) return;
  event.preventDefault();
  selectGame(game.id);
  gameGrid.querySelector(`[data-game-id="${CSS.escape(game.id)}"] .game-tile`)
    ?.focus({ preventScroll: true });
});
api.onStateChanged(applyState);
api.getState().then(applyState).catch((error) => {
  showToast(`主页初始化失败：${error.message}`);
});
