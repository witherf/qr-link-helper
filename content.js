/*
 * content.js —— 页面内交互：悬停「识码」按钮、结果面板、自动扫描、粘贴识别
 */
(function () {
  'use strict';

  if (window.__QRLH_LOADED__) return;
  window.__QRLH_LOADED__ = true;
  if (typeof window.jsQR !== 'function' || !window.QRLH) return;

  const { decodeSource, loadImage, isUrlLike, toOpenableUrl, prettyText } = window.QRLH;

  const SETTINGS_KEY = 'qrSettings';
  const DEFAULT_SETTINGS = {
    hoverButton: true,
    autoScan: true,
    pasteDecode: true,
    autoCopy: true
  };
  let settings = Object.assign({}, DEFAULT_SETTINGS);

  const pageResults = []; // { text, src, ts }
  const scannedSrc = new Set();
  const isTopFrame = (function () {
    try {
      return window.top === window;
    } catch (e) {
      return false;
    }
  })();

  /* ------------------------------ 样式与容器 ------------------------------ */

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .qrlh-btn {
      position: fixed; z-index: 2147483647;
      display: flex; align-items: center; gap: 3px;
      padding: 3px 7px; border: 0; border-radius: 6px;
      background: #2563eb; color: #fff;
      font: 500 12px/16px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      cursor: pointer; white-space: nowrap; user-select: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, .32);
      pointer-events: auto;
    }
    .qrlh-btn:hover { background: #1d4ed8; }
    .qrlh-btn[data-busy="1"] { background: #6b7280; cursor: progress; }
    .qrlh-btn .ico { font-size: 12px; line-height: 1; }

    .qrlh-panel {
      position: fixed; z-index: 2147483647;
      width: 348px; max-width: calc(100vw - 24px);
      background: #fff; color: #111827;
      border-radius: 10px; padding: 10px 12px 12px;
      box-shadow: 0 10px 36px rgba(0, 0, 0, .3), 0 0 0 1px rgba(0, 0, 0, .06);
      font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      pointer-events: auto;
    }
    .qrlh-head {
      display: flex; align-items: center; gap: 6px;
      font-weight: 600; font-size: 13px; margin-bottom: 8px;
    }
    .qrlh-head .dot {
      width: 7px; height: 7px; border-radius: 50%; background: #16a34a; flex: none;
    }
    .qrlh-head .qrlh-title { flex: 1; }
    .qrlh-close {
      border: 0; background: transparent; color: #9ca3af; cursor: pointer;
      font-size: 18px; line-height: 1; padding: 0 2px; border-radius: 4px;
    }
    .qrlh-close:hover { color: #374151; background: #f3f4f6; }
    .qrlh-text {
      width: 100%; height: 66px; resize: vertical;
      border: 1px solid #e5e7eb; border-radius: 7px; padding: 7px 8px;
      font: 12px/1.5 ui-monospace, Consolas, monospace; color: #111827;
      background: #f9fafb; word-break: break-all;
    }
    .qrlh-text:focus { outline: 2px solid #bfdbfe; border-color: #93c5fd; }
    .qrlh-meta { color: #6b7280; font-size: 11px; margin-top: 5px; word-break: break-all; }
    .qrlh-foot { display: flex; align-items: center; gap: 8px; margin-top: 9px; }
    .qrlh-foot button {
      border: 0; border-radius: 7px; cursor: pointer;
      font: 500 12px/1 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      padding: 8px 12px;
    }
    .qrlh-primary { background: #2563eb; color: #fff; }
    .qrlh-primary:hover { background: #1d4ed8; }
    .qrlh-ghost { background: #f3f4f6; color: #374151; }
    .qrlh-ghost:hover { background: #e5e7eb; }
    .qrlh-hint { color: #16a34a; font-size: 11px; margin-left: auto; }

    .qrlh-toast {
      position: fixed; z-index: 2147483647; left: 50%; top: 24px;
      transform: translateX(-50%);
      background: rgba(17, 24, 39, .92); color: #fff;
      font: 12px/1.4 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      padding: 8px 14px; border-radius: 8px; max-width: 70vw;
      box-shadow: 0 6px 20px rgba(0, 0, 0, .3);
      pointer-events: none;
    }
  `;

  const host = document.createElement('div');
  host.id = 'qrlh-root';
  host.style.cssText = 'all: initial; position: static;';
  const shadow = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  shadow.appendChild(styleEl);

  function mount() {
    if (!document.documentElement) return;
    if (!host.isConnected) document.documentElement.appendChild(host);
  }
  mount();

  /* ------------------------------ 工具函数 ------------------------------ */

  function sendBg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          void chrome.runtime.lastError;
          resolve(res || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function fetchImageDataUrl(url) {
    if (!url) return { ok: false, error: '图片地址为空' };
    if (/^(data|blob):/i.test(url)) {
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const buf = await blob.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buf);
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        const type = blob.type || 'image/png';
        return { ok: true, dataUrl: 'data:' + type + ';base64,' + btoa(binary) };
      } catch (e) {
        return { ok: false, error: '本地图片读取失败' };
      }
    }
    const res = await sendBg({ type: 'QRLH_FETCH_IMAGE', url });
    if (!res) return { ok: false, error: '后台无响应' };
    return res;
  }

  function copyText(text) {
    // 先走同步 execCommand，保证在用户点击手势内生效
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.cssText = 'position:fixed;top:-2000px;left:-2000px;opacity:0;';
      shadow.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) return true;
    } catch (e) {
      /* ignore */
    }
    try {
      navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  let toastTimer = null;
  function toast(message) {
    let el = shadow.querySelector('.qrlh-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'qrlh-toast';
      shadow.appendChild(el);
    }
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.display = 'none';
    }, 1800);
  }

  /* ------------------------------ 解码流程 ------------------------------ */

  async function decodeImageElement(img) {
    const src = img.currentSrc || img.src || '';
    let needFetch = false;

    if (img.complete && img.naturalWidth > 0) {
      try {
        const r = decodeSource(img);
        if (r.text) return { ok: true, text: r.text, src };
        if (r.error) needFetch = true;
        else return { ok: false, error: '这张图片里没有识别到二维码', src };
      } catch (e) {
        needFetch = true;
      }
    } else {
      needFetch = true;
    }

    if (!needFetch) return { ok: false, error: '无法读取图片', src };

    const fetched = await fetchImageDataUrl(src);
    if (!fetched.ok) return { ok: false, error: fetched.error || '图片读取失败', src };
    try {
      const image = await loadImage(fetched.dataUrl);
      const r = decodeSource(image);
      if (r.text) return { ok: true, text: r.text, src };
      return { ok: false, error: '这张图片里没有识别到二维码', src };
    } catch (e) {
      return { ok: false, error: '图片解码失败', src };
    }
  }

  function addResult(text, src) {
    const clean = prettyText(text);
    if (!clean) return false;
    if (pageResults.some((item) => item.text === clean)) return false;
    pageResults.push({ text: clean, src: src || '', ts: Date.now() });
    if (isTopFrame) {
      sendBg({ type: 'QRLH_BADGE', count: pageResults.length });
    }
    try {
      chrome.runtime.sendMessage({ type: 'QRLH_RESULT_ADDED', count: pageResults.length }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      /* ignore */
    }
    return true;
  }

  function markImage(img) {
    if (!img || !img.style) return;
    if (img.dataset.qrlhFound === '1') return;
    img.dataset.qrlhFound = '1';
    try {
      img.style.setProperty('outline', '3px solid #22c55e', 'important');
      img.style.setProperty('outline-offset', '-3px', 'important');
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------ 结果面板 ------------------------------ */

  let panelEl = null;
  let panelText = '';
  let panelAnchor = null;

  function closePanel() {
    if (panelEl) {
      panelEl.remove();
      panelEl = null;
      panelText = '';
      panelAnchor = null;
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onDocKeyDown, true);
    }
  }

  function onDocMouseDown(e) {
    if (e.target !== host) closePanel();
  }
  function onDocKeyDown(e) {
    if (e.key === 'Escape') closePanel();
  }

  function placePanel(anchorRect) {
    if (!panelEl) return;
    const panelWidth = 348;
    const margin = 12;
    let left;
    let top;

    if (anchorRect && anchorRect.width) {
      left = anchorRect.right - panelWidth;
      top = anchorRect.bottom + 8;
      if (top + 210 > window.innerHeight) top = Math.max(margin, anchorRect.top - 210);
    } else {
      left = (window.innerWidth - panelWidth) / 2;
      top = 80;
    }
    left = Math.min(Math.max(margin, left), window.innerWidth - panelWidth - margin);
    top = Math.min(Math.max(margin, top), window.innerHeight - 190);
    panelEl.style.left = Math.round(left) + 'px';
    panelEl.style.top = Math.round(top) + 'px';
  }

  function showPanel(result, anchorRect, autoCopied) {
    closePanel();
    const text = prettyText(result.text);
    panelText = text;
    panelAnchor = anchorRect || null;

    const panel = document.createElement('div');
    panel.className = 'qrlh-panel';

    const head = document.createElement('div');
    head.className = 'qrlh-head';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const title = document.createElement('span');
    title.className = 'qrlh-title';
    title.textContent = isUrlLike(text) ? '识别到链接' : '识别到文本';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'qrlh-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', closePanel);
    head.append(dot, title, closeBtn);

    const ta = document.createElement('textarea');
    ta.className = 'qrlh-text';
    ta.readOnly = true;
    ta.value = text;
    ta.spellcheck = false;

    const foot = document.createElement('div');
    foot.className = 'qrlh-foot';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'qrlh-primary';
    copyBtn.textContent = isUrlLike(text) ? '复制链接' : '复制文本';
    copyBtn.addEventListener('click', () => {
      const ok = copyText(panelText);
      toast(ok ? '已复制到剪贴板' : '复制失败，请手动选中文本复制');
    });

    foot.appendChild(copyBtn);

    if (isUrlLike(text)) {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'qrlh-ghost';
      openBtn.textContent = '用浏览器打开';
      openBtn.addEventListener('click', () => {
        sendBg({ type: 'QRLH_OPEN_URL', url: toOpenableUrl(panelText) });
      });
      foot.appendChild(openBtn);
    }

    if (autoCopied) {
      const hint = document.createElement('span');
      hint.className = 'qrlh-hint';
      hint.textContent = '已自动复制';
      foot.appendChild(hint);
    }

    panel.append(head, ta, foot);

    if (result.src && result.src.length < 120 && !result.src.startsWith('data:')) {
      const meta = document.createElement('div');
      meta.className = 'qrlh-meta';
      meta.textContent = '来源：' + result.src;
      panel.appendChild(meta);
    }

    shadow.appendChild(panel);
    panelEl = panel;
    placePanel(anchorRect);

    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onDocKeyDown, true);
  }

  async function handleDecoded(result, anchorRect) {
    if (!result || !result.ok) {
      toast((result && result.error) || '未识别到二维码');
      return false;
    }
    const text = prettyText(result.text);
    addResult(text, result.src);
    let copied = false;
    if (settings.autoCopy && text) copied = copyText(text);
    showPanel({ text, src: result.src }, anchorRect, copied);
    return true;
  }

  /* ------------------------------ 悬停按钮 ------------------------------ */

  const hoverBtn = document.createElement('button');
  hoverBtn.type = 'button';
  hoverBtn.className = 'qrlh-btn';
  hoverBtn.style.display = 'none';
  hoverBtn.innerHTML = '';
  const icoSpan = document.createElement('span');
  icoSpan.className = 'ico';
  icoSpan.textContent = '▣';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = '识码';
  hoverBtn.append(icoSpan, labelSpan);
  shadow.appendChild(hoverBtn);

  let hoverImg = null;
  let btnVisible = false;

  function positionButtonFor(img) {
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (!rect.width || rect.bottom < 0 || rect.top > window.innerHeight) {
      hideButton();
      return;
    }
    const left = Math.min(rect.right - 60, window.innerWidth - 64);
    const top = rect.top + 6;
    hoverBtn.style.left = Math.max(4, Math.round(left)) + 'px';
    hoverBtn.style.top = Math.max(4, Math.round(top)) + 'px';
  }

  function showButtonFor(img) {
    hoverImg = img;
    hoverBtn.style.display = 'flex';
    btnVisible = true;
    setBusy(false);
    positionButtonFor(img);
  }

  function hideButton() {
    hoverBtn.style.display = 'none';
    btnVisible = false;
    hoverImg = null;
  }

  function setBusy(busy) {
    hoverBtn.dataset.busy = busy ? '1' : '0';
    labelSpan.textContent = busy ? '识别中…' : '识码';
  }

  hoverBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!hoverImg) return;
    const target = hoverImg;
    setBusy(true);
    const result = await decodeImageElement(target);
    setBusy(false);
    if (result.ok) markImage(target);
    await handleDecoded(result, target.getBoundingClientRect());
  });

  function findImage(node) {
    let el = node;
    let guard = 0;
    while (el && guard++ < 4) {
      if (el.tagName === 'IMG') return el;
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener(
    'mouseover',
    (e) => {
      if (!settings.hoverButton) return;
      if (e.target === host) return; // 鼠标落在自己的 UI 上
      const img = findImage(e.target);
      if (!img) {
        if (!panelEl) hideButton();
        return;
      }
      if (img === hoverImg) return;
      const rect = img.getBoundingClientRect();
      if (rect.width < 44 || rect.height < 44) return;
      showButtonFor(img);
    },
    true
  );

  window.addEventListener(
    'scroll',
    () => {
      if (btnVisible && hoverImg) positionButtonFor(hoverImg);
      if (panelEl && panelAnchor) placePanel(panelAnchor);
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    'resize',
    () => {
      if (btnVisible && hoverImg) positionButtonFor(hoverImg);
      if (panelEl && panelAnchor) placePanel(panelAnchor);
    },
    { passive: true }
  );

  /* ------------------------------ 自动扫描 ------------------------------ */

  function isLikelyQrImage(img) {
    const w = img.naturalWidth || 0;
    const h = img.naturalHeight || 0;
    if (w < 80 || h < 80) return false;
    if (w > 2400 || h > 2400) return false;
    if (Math.abs(w - h) / Math.max(w, h) > 0.12) return false; // 二维码基本是正方形
    const rect = img.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return false;
    return true;
  }

  function waitImageReady(img, timeout) {
    if (img.complete && img.naturalWidth) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeout || 2000);
      img.addEventListener('load', () => finish(true), { once: true });
      img.addEventListener('error', () => finish(false), { once: true });
    });
  }

  let autoScanStarted = false;
  async function autoScanPage() {
    if (autoScanStarted || !settings.autoScan) return;
    autoScanStarted = true;
    const candidates = Array.from(document.images)
      .filter((img) => isLikelyQrImage(img) && !scannedSrc.has(img.currentSrc || img.src))
      .slice(0, 12);

    for (const img of candidates) {
      const src = img.currentSrc || img.src || '';
      if (scannedSrc.has(src)) continue;
      scannedSrc.add(src);
      const ready = await waitImageReady(img, 2500);
      if (!ready) continue;
      try {
        const result = await decodeImageElement(img);
        if (result.ok) {
          markImage(img);
          addResult(result.text, result.src);
        }
      } catch (e) {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  function scheduleAutoScan() {
    if (!settings.autoScan) return;
    const run = () => autoScanPage();
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 1500);
  }

  async function scanAllImages() {
    const imgs = Array.from(document.images).filter((img) => {
      const rect = img.getBoundingClientRect();
      return img.naturalWidth >= 60 && img.naturalHeight >= 60 && rect.width >= 30;
    });
    for (const img of imgs.slice(0, 60)) {
      try {
        const result = await decodeImageElement(img);
        if (result.ok) {
          markImage(img);
          addResult(result.text, result.src);
        }
      } catch (e) {
        /* ignore */
      }
    }
    return { ok: true, items: pageResults.slice() };
  }

  /* ------------------------------ 粘贴识别 ------------------------------ */

  document.addEventListener(
    'paste',
    (e) => {
      if (!settings.pasteDecode) return;
      const data = e.clipboardData;
      if (!data || !data.items) return;
      for (const item of data.items) {
        if (item.kind !== 'file' || !/^image\//.test(item.type)) continue;
        const file = item.getAsFile();
        if (!file) continue;
        const url = URL.createObjectURL(file);
        loadImage(url)
          .then(async (image) => {
            const r = decodeSource(image);
            URL.revokeObjectURL(url);
            if (r.text) {
              await handleDecoded({ ok: true, text: r.text, src: '剪贴板图片' }, null);
            } else {
              toast('这张截图里没有识别到二维码');
            }
          })
          .catch(() => {
            URL.revokeObjectURL(url);
            toast('剪贴板图片读取失败');
          });
        return;
      }
    },
    true
  );

  /* ------------------------------ 消息接口 ------------------------------ */

  async function decodeByUrl(url) {
    let matched = null;
    for (const img of document.images) {
      const s = img.currentSrc || img.src;
      if (s === url) {
        matched = img;
        break;
      }
    }
    if (matched) {
      const result = await decodeImageElement(matched);
      if (result.ok) markImage(matched);
      await handleDecoded(result, matched.getBoundingClientRect());
      return result;
    }

    const fetched = await fetchImageDataUrl(url);
    if (!fetched.ok) {
      toast(fetched.error || '图片读取失败');
      return { ok: false, error: fetched.error };
    }
    try {
      const image = await loadImage(fetched.dataUrl);
      const r = decodeSource(image);
      if (!r.text) {
        toast('这张图片里没有识别到二维码');
        return { ok: false, error: '未识别到二维码' };
      }
      await handleDecoded({ ok: true, text: r.text, src: url }, null);
      return { ok: true, text: r.text, src: url };
    } catch (e) {
      toast('图片解码失败');
      return { ok: false, error: '解码失败' };
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'QRLH_DECODE_URL') {
      decodeByUrl(msg.url).then((r) => sendResponse(r)).catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (msg.type === 'QRLH_SCAN_ALL') {
      scanAllImages()
        .then((r) => sendResponse(r))
        .catch(() => sendResponse({ ok: false, items: pageResults.slice() }));
      return true;
    }

    if (msg.type === 'QRLH_GET_RESULTS') {
      sendResponse({ ok: true, items: pageResults.slice() });
      return;
    }

    if (msg.type === 'QRLH_SETTINGS_CHANGED') {
      loadSettings();
      sendResponse({ ok: true });
      return;
    }
  });

  /* ------------------------------ 设置加载 ------------------------------ */

  function loadSettings() {
    try {
      chrome.storage.local.get(SETTINGS_KEY, (res) => {
        void chrome.runtime.lastError;
        settings = Object.assign({}, DEFAULT_SETTINGS, (res && res[SETTINGS_KEY]) || {});
        if (!settings.hoverButton) hideButton();
        scheduleAutoScan();
      });
    } catch (e) {
      /* 扩展被重载时可能失效 */
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SETTINGS_KEY]) {
        settings = Object.assign({}, DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue || {});
        if (!settings.hoverButton) hideButton();
      }
    });
  } catch (e) {
    /* ignore */
  }

  loadSettings();
})();
