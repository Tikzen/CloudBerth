'use strict';

const PERMISSION_LABELS = Object.freeze({
  pointerLock: '鼠标锁定',
  keyboardLock: '键盘锁定',
  media: '麦克风或摄像头',
  mediaKeySystem: '受保护媒体播放（DRM）',
  fullscreen: '网页全屏'
});

function hostnameMatches(hostname, pattern) {
  const normalizedHost = hostname.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();
  if (normalizedPattern.startsWith('*.')) {
    const base = normalizedPattern.slice(2);
    return normalizedHost.endsWith(`.${base}`) &&
      normalizedHost.length > base.length + 1;
  }
  return normalizedHost === normalizedPattern;
}

function createTrustChecker(config, { getGameUrls = null, getDerivedHosts = null } = {}) {
  const startUrl = new URL(config.startUrl);

  return function isTrustedUrl(candidate, gameId = null) {
    if (!candidate || typeof candidate !== 'string') return false;
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      return false;
    }

    if (parsed.protocol === 'file:') {
      return startUrl.protocol === 'file:' && parsed.href === startUrl.href;
    }
    if (parsed.protocol !== 'https:') return false;
    const gameHosts = typeof getGameUrls === 'function'
      ? getGameUrls().map((url) => {
        try {
          return new URL(url).hostname;
        } catch {
          return '';
        }
      }).filter(Boolean)
      : [];
    const patterns = config.allowedPermissionHosts.length > 0
      ? config.allowedPermissionHosts
      : [...new Set([
        ...(startUrl.hostname ? [startUrl.hostname] : []),
        ...gameHosts
      ])];
    if (patterns.some((pattern) => hostnameMatches(parsed.hostname, pattern))) {
      return true;
    }
    const derived = typeof getDerivedHosts === 'function'
      ? (getDerivedHosts(gameId) || [])
      : [];
    return derived.some((pattern) => hostnameMatches(parsed.hostname, pattern));
  };
}

function createDerivedHostPrompt(dialog) {
  return async ({ game, hostname, permission, window }) => {
    const permissionName = PERMISSION_LABELS[permission] || permission;
    const options = {
      type: 'question',
      title: '网页权限授权',
      message: '是否授权该网页在 CloudBerth 中使用？',
      detail: [
        `所属游戏：${game.name}`,
        `衍生网页：${hostname}`,
        `申请权限：${permissionName}`,
        '',
        '点击“同意并解锁”后，会将该网页标记为该游戏的衍生网页并解锁权限，之后可在「设置 → 衍生网页」中查看或删除。',
        '点击“不同意并关闭窗口”将退出当前网页窗口，下次打开仍会再次询问。'
      ].join('\n'),
      buttons: ['同意并解锁', '不同意并关闭窗口'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    };
    const parent = window && !window.isDestroyed() ? window : undefined;
    const result = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    return result.response === 0;
  };
}

function configurePermissions(session, config, logger, options = {}) {
  const {
    getGameForWebContents = null,
    promptDerivedHost = null,
    onApproveDerivedHost = null
  } = options;
  const isTrustedUrl = createTrustChecker(config, options);
  const trustedPermissions = new Set([
    'pointerLock',
    'keyboardLock',
    'media',
    'mediaKeySystem'
  ]);
  const pendingPrompts = new Map();

  function isPermissionSupported(permission) {
    if (permission === 'fullscreen') {
      return config.htmlFullscreenPolicy === 'allow';
    }
    return trustedPermissions.has(permission);
  }

  function decide(permission, requestingUrl, gameId = null) {
    return isPermissionSupported(permission) && isTrustedUrl(requestingUrl, gameId);
  }

  session.setPermissionCheckHandler((
    webContents,
    permission,
    requestingOrigin,
    details
  ) => {
    const requestingUrl = details.requestingUrl ||
      details.securityOrigin ||
      requestingOrigin;
    const gameId = typeof getGameForWebContents === 'function'
      ? getGameForWebContents(webContents)?.id ?? null
      : null;
    const granted = decide(permission, requestingUrl, gameId);
    logger.info('Permission check', {
      permission,
      host: safeHostname(requestingUrl),
      granted
    });
    return granted;
  });

  session.setPermissionRequestHandler((
    webContents,
    permission,
    callback,
    details
  ) => {
    const requestingUrl = details.requestingUrl || details.securityOrigin;
    const gameContext = typeof getGameForWebContents === 'function'
      ? getGameForWebContents(webContents)
      : null;
    const gameId = gameContext?.id ?? null;

    if (!isPermissionSupported(permission)) {
      logger.info('Permission request', {
        permission,
        host: safeHostname(requestingUrl),
        granted: false
      });
      callback(false);
      return;
    }

    if (isTrustedUrl(requestingUrl, gameId)) {
      logger.info('Permission request', {
        permission,
        host: safeHostname(requestingUrl),
        granted: true
      });
      callback(true);
      return;
    }

    let parsed = null;
    try {
      parsed = new URL(requestingUrl);
    } catch {
      parsed = null;
    }

    if (!parsed || parsed.protocol !== 'https:' || !parsed.hostname ||
        !gameContext || typeof promptDerivedHost !== 'function') {
      logger.info('Permission request', {
        permission,
        host: safeHostname(requestingUrl),
        granted: false
      });
      callback(false);
      return;
    }

    const hostname = parsed.hostname.toLowerCase();
    const promptKey = `${gameContext.id}:${hostname}`;
    let pending = pendingPrompts.get(promptKey);
    if (!pending) {
      pending = (async () => {
        try {
          const approved = await promptDerivedHost({
            game: gameContext,
            hostname,
            requestingUrl,
            permission,
            window: gameContext.window
          });
          if (approved) {
            if (typeof onApproveDerivedHost === 'function') {
              await onApproveDerivedHost(gameContext.id, hostname);
            }
            logger.info('Derived webpage authorized', {
              gameId: gameContext.id,
              host: hostname,
              permission
            });
            return true;
          }
          logger.info('Derived webpage declined; closing window', {
            gameId: gameContext.id,
            host: hostname,
            permission
          });
          if (gameContext.window && !gameContext.window.isDestroyed()) {
            gameContext.window.close();
          }
          return false;
        } catch (error) {
          logger.warn('Derived webpage prompt failed', error.message);
          return false;
        } finally {
          pendingPrompts.delete(promptKey);
        }
      })();
      pendingPrompts.set(promptKey, pending);
    }

    pending.then((granted) => callback(Boolean(granted)));
  });

  return { isTrustedUrl };
}

function safeHostname(candidate) {
  try {
    const parsed = new URL(candidate);
    return parsed.hostname || parsed.protocol;
  } catch {
    return 'unknown';
  }
}

module.exports = {
  PERMISSION_LABELS,
  configurePermissions,
  createDerivedHostPrompt,
  createTrustChecker,
  hostnameMatches
};
