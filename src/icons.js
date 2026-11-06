'use strict';

const fs = require('node:fs/promises');
const https = require('node:https');
const { dialog, nativeImage } = require('electron');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function decodeIco(buffer) {
  if (buffer.length < 22 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) return null;
  const count = Math.min(buffer.readUInt16LE(4), 64);
  const entries = [];
  for (let i = 0; i < count && 6 + (i + 1) * 16 <= buffer.length; i++) {
    const pos = 6 + i * 16;
    entries.push({ width: buffer[pos] || 256, height: buffer[pos + 1] || 256,
      length: buffer.readUInt32LE(pos + 8), offset: buffer.readUInt32LE(pos + 12) });
  }
  entries.sort((a, b) => b.width * b.height - a.width * a.height);
  for (const entry of entries) {
    if (entry.offset + entry.length > buffer.length || entry.length < 8) continue;
    const data = buffer.subarray(entry.offset, entry.offset + entry.length);
    if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      const image = nativeImage.createFromBuffer(data);
      if (!image.isEmpty()) return image;
      continue;
    }
    if (data.length < 40) continue;
    const header = data.readUInt32LE(0);
    const width = data.readInt32LE(4);
    const height = Math.abs(data.readInt32LE(8)) / 2;
    const bits = data.readUInt16LE(14);
    if (header < 40 || width !== entry.width || height !== entry.height ||
        ![24, 32].includes(bits) || data.readUInt32LE(16) !== 0) continue;
    const stride = Math.ceil(width * bits / 32) * 4;
    const start = header + data.readUInt32LE(32) * 4;
    if (start + stride * height > data.length) continue;
    const pixels = Buffer.alloc(width * height * 4);
    const maskStart = start + stride * height;
    const maskStride = Math.ceil(width / 32) * 4;
    let hasAlpha = false;
    if (bits === 32) {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (data[start + y * stride + x * 4 + 3]) hasAlpha = true;
      }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const row = data.readInt32LE(8) > 0 ? height - 1 - y : y;
      const source = start + row * stride + x * (bits / 8);
      const target = (y * width + x) * 4;
      let alpha = bits === 32 && hasAlpha ? data[source + 3] : 255;
      const mask = maskStart + row * maskStride + (x >> 3);
      if (mask < data.length && data[mask] & (0x80 >> (x % 8))) alpha = 0;
      // Electron's raw bitmap is premultiplied BGRA on supported desktops.
      for (let channel = 0; channel < 3; channel++) pixels[target + channel] = Math.round(data[source + channel] * alpha / 255);
      pixels[target + 3] = alpha;
    }
    return nativeImage.createFromBitmap(pixels, { width, height });
  }
  return null;
}

function normalizeImage(buffer) {
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('请选择 5 MB 以内的图片。');
  let image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) image = decodeIco(buffer);
  if (!image || image.isEmpty()) throw new Error('无法读取图片，请选择 PNG 或 JPEG 图片。');
  const size = image.getSize();
  if (size.width > 8192 || size.height > 8192) throw new Error('图片尺寸过大，请选择较小的图片。');
  const thumbnail = image.resize({ width: 128, height: 128, quality: 'best' });
  return `data:image/png;base64,${thumbnail.toPNG().toString('base64')}`;
}

function readHttps(url, maxBytes, redirects = 0) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return Promise.reject(new Error('图标只允许使用 HTTPS 地址。'));
  }
  return new Promise((resolve, reject) => {
    // Public website metadata only: never send game cookies or credentials.
    const request = https.get(parsed, { headers: { 'User-Agent': 'CloudBerth', Accept: '*/*' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirects >= 3) { reject(new Error('图标重定向次数过多。')); return; }
        readHttps(new URL(response.headers.location, parsed).href, maxBytes, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`HTTP ${response.statusCode}`)); return; }
      const chunks = [];
      let length = 0;
      response.on('data', (chunk) => {
        length += chunk.length;
        if (length > maxBytes) request.destroy(new Error('图标资源过大。'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({ data: Buffer.concat(chunks), url: parsed.href }));
      response.on('error', reject);
    });
    const timer = setTimeout(() => request.destroy(new Error('图标读取超时。')), 5000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}

function iconCandidates(html, pageUrl) {
  const result = [];
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = {};
    for (const attr of tag[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4];
    }
    if (!/(?:^|\s)(?:icon|apple-touch-icon|apple-touch-icon-precomposed)(?:\s|$)/i.test(attrs.rel || '') || !attrs.href) continue;
    try {
      const url = new URL(attrs.href.replaceAll('&amp;', '&'), pageUrl);
      if (url.protocol === 'https:') result.push(url.href);
    } catch { /* Ignore malformed site metadata. */ }
  }
  result.push(new URL('/favicon.ico', pageUrl).href);
  return [...new Set(result)].slice(0, 6);
}

function createIconService({ logger = { warn() {} } } = {}) {
  const cache = new Map();
  const pending = new Map();
  return {
    async getWebsiteIcon(url, { refresh = false, candidates = null } = {}) {
      if (new URL(url).protocol !== 'https:') return '';
      if (!refresh && cache.has(url)) return cache.get(url);
      if (pending.has(url)) return pending.get(url);
      const job = (async () => {
        let urls = candidates;
        if (!urls) {
          try {
            const page = await readHttps(url, 1024 * 1024);
            urls = iconCandidates(page.data.toString('utf8'), page.url);
          } catch { urls = [new URL('/favicon.ico', url).href]; }
        }
        for (const candidate of urls.slice(0, 6)) {
          try {
            const { data } = await readHttps(candidate, MAX_IMAGE_BYTES);
            const icon = normalizeImage(data);
            cache.set(url, icon);
            return icon;
          } catch (error) { logger.warn('Website icon candidate unavailable', { url: candidate, error: error.message }); }
        }
        cache.set(url, '');
        return '';
      })();
      pending.set(url, job);
      try { return await job; } finally { pending.delete(url); }
    },
    async chooseAvatar(parent) {
      const result = await dialog.showOpenDialog(parent, {
        title: '选择游戏头像', buttonLabel: '使用这张图片', properties: ['openFile'],
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }]
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const file = result.filePaths[0];
      if ((await fs.stat(file)).size > MAX_IMAGE_BYTES) throw new Error('请选择 5 MB 以内的图片。');
      return normalizeImage(await fs.readFile(file));
    }
  };
}

module.exports = { createIconService, iconCandidates, normalizeImage };
