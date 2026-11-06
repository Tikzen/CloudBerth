'use strict';

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

function createTrustChecker(config, { getGameUrls = null } = {}) {
  const startUrl = new URL(config.startUrl);

  return function isTrustedUrl(candidate) {
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
    return patterns.some((pattern) => hostnameMatches(parsed.hostname, pattern));
  };
}

function configurePermissions(session, config, logger, options = {}) {
  const isTrustedUrl = createTrustChecker(config, options);
  const trustedPermissions = new Set([
    'pointerLock',
    'keyboardLock',
    'media',
    'mediaKeySystem'
  ]);

  function decide(permission, requestingUrl) {
    if (permission === 'fullscreen') {
      return config.htmlFullscreenPolicy === 'allow' &&
        isTrustedUrl(requestingUrl);
    }
    return trustedPermissions.has(permission) && isTrustedUrl(requestingUrl);
  }

  session.setPermissionCheckHandler((
    _webContents,
    permission,
    requestingOrigin,
    details
  ) => {
    const requestingUrl = details.requestingUrl ||
      details.securityOrigin ||
      requestingOrigin;
    const granted = decide(permission, requestingUrl);
    logger.info('Permission check', {
      permission,
      host: safeHostname(requestingUrl),
      granted
    });
    return granted;
  });

  session.setPermissionRequestHandler((
    _webContents,
    permission,
    callback,
    details
  ) => {
    const requestingUrl = details.requestingUrl || details.securityOrigin;
    const granted = decide(permission, requestingUrl);
    logger.info('Permission request', {
      permission,
      host: safeHostname(requestingUrl),
      granted
    });
    callback(granted);
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
  configurePermissions,
  createTrustChecker,
  hostnameMatches
};
