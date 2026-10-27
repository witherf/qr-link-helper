/*
 * decoder.js —— 共用的二维码解码逻辑（content script / popup 都会加载）
 * 依赖 vendor_jsQR.js 暴露的全局 jsQR
 * 暴露全局 QRLH
 */
(function () {
  'use strict';

  const MAX_SIDE = 1500;
  const MIN_SIDE = 300;

  function sourceSize(source) {
    const w = source.naturalWidth || source.videoWidth || source.width || 0;
    const h = source.naturalHeight || source.videoHeight || source.height || 0;
    return { w, h };
  }

  function normalizeCanvas(source, maxSide, minSide) {
    const { w, h } = sourceSize(source);
    if (!w || !h) return null;
    const longest = Math.max(w, h);
    const target = Math.min(maxSide, Math.max(minSide, longest));
    const scale = target / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function invertPixels(data) {
    const out = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      out[i] = 255 - data[i];
      out[i + 1] = 255 - data[i + 1];
      out[i + 2] = 255 - data[i + 2];
      out[i + 3] = 255;
    }
    return out;
  }

  // 在单个 canvas 上尝试识别（正色 + 反色）
  function decodeCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    if (res && res.data) return res.data;
    res = jsQR(invertPixels(img.data), img.width, img.height, { inversionAttempts: 'dontInvert' });
    return res && res.data ? res.data : null;
  }

  /**
   * 解码任意图片来源（HTMLImageElement / canvas / ImageBitmap）
   * 返回 { text: string|null, error: Error|null }
   * error 非空通常意味着 canvas 被跨域污染，需要交给后台抓取
   */
  function decodeSource(source) {
    const passes = [
      [MAX_SIDE, MIN_SIDE],
      [1600, 900],
      [700, 180]
    ];
    let lastError = null;
    const tried = new Set();

    for (const [maxSide, minSide] of passes) {
      let canvas = null;
      try {
        canvas = normalizeCanvas(source, maxSide, minSide);
      } catch (e) {
        lastError = e;
        break;
      }
      if (!canvas) continue;
      const key = canvas.width + 'x' + canvas.height;
      if (tried.has(key)) continue;
      tried.add(key);

      try {
        const text = decodeCanvas(canvas);
        if (text) return { text, error: null };
      } catch (e) {
        // SecurityError：图片跨域且未带 CORS 头，像素读不出来
        lastError = e;
        break;
      }
    }
    return { text: null, error: lastError };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = src;
    });
  }

  function isUrlLike(text) {
    const t = String(text || '').trim();
    if (!t || /\s/.test(t)) return false;
    return /^(https?:\/\/|www\.)\S+$/i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t);
  }

  function toOpenableUrl(text) {
    const t = String(text || '').trim();
    if (/^https?:\/\//i.test(t)) return t;
    return 'https://' + t.replace(/^\/+/, '');
  }

  function prettyText(text) {
    return String(text || '').replace(/\u0000/g, '').trim();
  }

  window.QRLH = {
    decodeSource,
    decodeCanvas,
    normalizeCanvas,
    loadImage,
    isUrlLike,
    toOpenableUrl,
    prettyText
  };
})();
