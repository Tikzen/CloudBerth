'use strict';

(() => {
  const bridge = window.cloudBerth;
  const api = bridge.updates;
  const find = (id) => document.getElementById(id);
  const dialog = find('updateDialog'), button = find('updateButton'), primary = find('updatePrimary');
  let state = { status: 'idle', currentVersion: '' }, running = [], prompted = '', busy = false;
  const bytes = (n) => `${(Number(n || 0) / 1024 / 1024).toFixed(1)} MB`;
  const active = () => ['downloading', 'preparing', 'installing'].includes(state.status);
  function maybePrompt() {
    if (state.status !== 'available' || state.trigger !== 'automatic' || !state.release ||
        state.skippedVersion === state.release.tag || prompted === state.release.tag || running.length ||
        !document.hasFocus() || document.hidden || document.querySelector('dialog[open]')) return;
    prompted = state.release.tag;
    dialog.showModal();
  }
  function render(next) {
    state = next;
    const available = Boolean(state.release);
    button.textContent = active() ? (state.status === 'downloading' ? `更新 ${Math.floor(state.progress * 100)}%` : '正在准备更新…')
      : state.status === 'ready' ? '重启更新' : available ? '发现新版本' : '检查更新';
    button.classList.toggle('has-update', available);
    find('updateTitle').textContent = state.status === 'ready' ? '更新已准备完成' : available ? '发现新版本' : '检查更新';
    find('updateVersion').textContent = `当前版本 ${state.currentVersion || '—'}${available ? ` → ${state.release.version}${state.release.prerelease ? '（测试版）' : ''}` : ''}`;
    const descriptions = {
      idle: '点击检查是否有适合这台电脑的新版本。', checking: '正在连接 GitHub 检查更新…',
      available: '可直接在软件中下载更新，下载完成后重启安装。',
      current: '当前已是此系统和架构可用的最新版本。',
      downloading: '正在下载更新包，可以关闭此窗口，下载会继续。',
      preparing: '下载已校验，正在准备安装文件…',
      ready: running.length ? '请先结束正在运行的游戏，再重启并更新。' : '安装文件已就绪。重启后自动完成替换，游戏库和登录数据会保留。',
      installing: '正在退出并更新，请稍候…', error: '更新未完成，请重试。'
    };
    find('updateStatus').textContent = descriptions[state.status] || '';
    find('updateNotes').hidden = !available;
    find('updateNotes').textContent = available ? state.release.notes || '此版本未提供更新说明。' : '';
    find('updateError').textContent = state.error || '';
    const progress = find('updateProgress');
    find('updateProgressArea').hidden = !['downloading', 'preparing', 'ready', 'installing'].includes(state.status);
    if (state.status === 'downloading' && !state.total) progress.removeAttribute('value');
    else progress.value = state.progress || 0;
    find('updateProgressText').textContent = state.status === 'downloading'
      ? `${bytes(state.received)}${state.total ? ` / ${bytes(state.total)} · ${Math.floor(state.progress * 100)}%` : ''}`
      : state.status === 'preparing' ? '校验完成 · 正在准备' : '下载与校验完成';
    find('updateSkip').hidden = state.status !== 'available';
    find('updateCancel').hidden = state.status !== 'downloading';
    primary.textContent = state.status === 'ready' ? '重启并更新' : available && state.status !== 'checking' ? '立即更新' : '重新检查';
    primary.disabled = active() || state.status === 'checking' || (state.status === 'ready' && running.length > 0);
    maybePrompt();
  }
  async function action(fn) {
    if (busy) return;
    busy = true;
    try { render(await fn()); }
    catch (error) { find('updateError').textContent = error.message; }
    finally { busy = false; }
  }
  async function show() {
    if (!dialog.open && !document.querySelector('dialog[open]')) dialog.showModal();
    if (['idle', 'current', 'error', 'available'].includes(state.status)) await action(() => api.check());
  }
  button.addEventListener('click', show);
  primary.addEventListener('click', () => action(() => state.status === 'ready' ? api.restart()
    : state.release && state.status !== 'checking' ? api.download() : api.check()));
  find('updateSkip').addEventListener('click', async () => { await action(() => api.skip()); dialog.close(); });
  find('updateCancel').addEventListener('click', () => { void api.cancel().catch((error) => { find('updateError').textContent = error.message; }); });
  find('updateClose').addEventListener('click', () => dialog.close());
  window.addEventListener('focus', maybePrompt);
  document.addEventListener('visibilitychange', maybePrompt);
  document.querySelectorAll('dialog').forEach((item) => item.addEventListener('close', maybePrompt));
  bridge.onStateChanged((next) => { running = next.runningGameIds || []; render(state); });
  bridge.getState().then((next) => { running = next.runningGameIds || []; render(state); }).catch(() => {});
  api.onChange(render); api.onShow(show);
  api.getState().then(render).catch(() => { /* Isolated developer fixtures may omit the update service. */ });
})();
