'use strict';

const { normalizeShortcut } = require('./library');
const macDisplayStates = new WeakMap();

function setMacFullscreen(window, fullScreen, logger) {
  let state = macDisplayStates.get(window);
  if (!state) {
    state = { target: window.isFullScreen(), transitioning: false };
    macDisplayStates.set(window, state);
    const settled = () => {
      if (!state.transitioning) {
        state.target = window.isFullScreen();
        return;
      }
      state.transitioning = false;
      apply();
    };
    window.on('enter-full-screen', settled);
    window.on('leave-full-screen', settled);
  }
  state.target = fullScreen;
  apply();

  function apply() {
    if (window.isDestroyed() || state.transitioning) return;
    // A request during AppKit's animation is applied after its completion event.
    if (window.isKiosk()) {
      state.transitioning = true;
      window.setKiosk(false);
    } else if (window.isFullScreen() !== state.target) {
      state.transitioning = true;
      window.setFullScreen(state.target);
    }
    logger.info('Requested macOS fullscreen state', { fullscreen: state.target });
  }
}

function setDisplayMode(window, mode, logger) {
  if (window.isDestroyed()) return;

  if (process.platform === 'darwin') {
    // Kiosk hides the Mac menu bar and normal exit controls. Use native
    // fullscreen for both immersive modes so those controls remain reachable.
    setMacFullscreen(window, mode !== 'windowed', logger);
    return;
  }

  if (mode === 'windowed') {
    if (window.isKiosk()) window.setKiosk(false);
    if (window.isFullScreen()) window.setFullScreen(false);
    logger.info('Entered native windowed mode');
    return;
  }

  if (mode === 'kiosk') {
    if (window.isFullScreen() && !window.isKiosk()) {
      window.setFullScreen(false);
    }
    window.setKiosk(true);
    logger.info('Entered native kiosk mode');
    return;
  }

  if (window.isKiosk()) window.setKiosk(false);
  window.setFullScreen(true);
  logger.info('Entered native fullscreen mode');
}

function toggleDisplayMode(window, configuredMode, logger) {
  const macState = macDisplayStates.get(window);
  const fullScreen = macState?.transitioning
    ? macState.target
    : window.isKiosk() || window.isFullScreen();
  if (fullScreen) {
    setDisplayMode(window, 'windowed', logger);
  } else {
    setDisplayMode(
      window,
      configuredMode === 'windowed' ? 'fullscreen' : configuredMode,
      logger
    );
  }
}

function shortcutFromInput(input, { strict = false } = {}) {
  const parts = [];
  if (input.control) parts.push('Ctrl');
  if (input.alt) parts.push('Alt');
  if (input.shift) parts.push('Shift');
  if (input.meta) parts.push('Meta');
  let key = input.key;
  // With Control held, macOS can report a control character instead of a
  // letter. IMEs can also change key; code still identifies the shortcut key.
  if ((input.control || input.meta) && /^Key[A-Z]$/.test(input.code || '')) {
    key = input.code.slice(3);
  } else if ((input.control || input.meta) && /^Digit[0-9]$/.test(input.code || '')) {
    key = input.code.slice(5);
  }
  if (key === ' ') key = 'Space';
  if (typeof key === 'string' && key.length === 1) key = key.toUpperCase();
  parts.push(key);
  try {
    return normalizeShortcut(parts.join('+'));
  } catch (error) {
    if (strict) throw error;
    return null;
  }
}

function installShortcuts(
  webContents,
  window,
  config,
  app,
  logger,
  {
    getShortcuts = () => config.shortcuts,
    onHome = () => {},
    shouldSuspend = () => false,
    onCapture
  } = {}
) {
  webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyUp') return;
    const suspended = shouldSuspend();
    webContents.setIgnoreMenuShortcuts(suspended);
    if (suspended) {
      // Record before Chromium/AppKit handles the combination. Tab remains
      // available to leave the recorder and restore ordinary keyboard input.
      if (!onCapture || input.key === 'Tab') return;
      event.preventDefault();
      if (input.isAutoRepeat || ['control', 'ctrl', 'shift', 'alt', 'meta', 'command'].includes(input.key.toLowerCase())) return;
      if (input.key === 'Escape') { onCapture({ cancelled: true }); return; }
      try { onCapture({ shortcut: shortcutFromInput(input, { strict: true }) }); }
      catch (error) { onCapture({ error: error.message }); }
      return;
    }

    const key = input.key.toLowerCase();
    const control = input.control || input.meta;
    const pressed = shortcutFromInput(input);
    const shortcuts = getShortcuts();

    if (pressed === shortcuts.quit) {
      event.preventDefault();
      logger.info('Quit shortcut used', { shortcut: shortcuts.quit });
      app.quit();
      return;
    }

    if (pressed === shortcuts.toggleDisplay) {
      event.preventDefault();
      toggleDisplayMode(window, config.startMode, logger);
      return;
    }

    if (pressed === shortcuts.home) {
      event.preventDefault();
      logger.info('Home shortcut used', { shortcut: shortcuts.home });
      onHome();
      return;
    }

    if (key === 'f12' && config.enableDevTools) {
      event.preventDefault();
      webContents.toggleDevTools();
      return;
    }

    const blockedControlKeys = new Set(['r', 'w', 't', 'n', 'l']);
    const blockedZoomCodes = new Set([
      'Equal',
      'Minus',
      'Digit0',
      'NumpadAdd',
      'NumpadSubtract'
    ]);
    const blocked =
      key === 'f5' ||
      (control && blockedControlKeys.has(key)) ||
      (control && blockedZoomCodes.has(input.code)) ||
      (!config.enableDevTools && control && input.shift && key === 'i');

    if (blocked) {
      event.preventDefault();
      logger.info('Blocked browser shortcut', {
        key: input.key,
        code: input.code
      });
    }
    // Escape is deliberately not handled: it must reach the game page.
  });
}

module.exports = {
  installShortcuts,
  setDisplayMode,
  shortcutFromInput,
  toggleDisplayMode
};
