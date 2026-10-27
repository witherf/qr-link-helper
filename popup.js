/*
 * popup.js —— 弹窗逻辑：图片识别、本页结果列表、设置
 */
'use strict';

const SETTINGS_KEY = 'qrSettings';
const DEFAULT_SETTINGS = {
  hoverButton: true,
  autoScan: true,
  pasteDecode: true,
  autoCopy: true
};

const $ = (id) => document.getElementById(id);
const dropzone = $('dropzone');
const fileInput = $('fileInput');
const statusEl = $('status');
const resultBox = $('resultBox');
const resultTitle = $('resultTitle');
const resultText = $('resultText');
const pageList = $('pageList');
const pageEmpty = $('pageEmpty');
const pageTitle = $('pageTitle');

let settings = Object.assign({}, DEFAULT_SETTINGS);
let currentText = '';

/* ------------------------------ 设置 ------------------------------ */

function loadSettings() {
  chrome.storage.local.get(SETTINGS_KEY, (res) => {
    settings = Object.assign({}, DEFAULT_SETTINGS, (res && res[SETTINGS_KEY]) || {});
    $('setHover').checked = !!settings.hoverButton;
    $('setAuto').checked = !!settings.autoScan;
    $('setPaste').checked = !!settings.pasteDecode;
    $('setAutoCopy').checked = !!settings.autoCopy;
  });
}

function bindSetting(id, key) {
  $(id).addEventListener('change', (e) => {
    settings[key] = e.target.checked;
    const payload = {};
    payload[SETTINGS_KEY] = settings;
    chrome.storage.local.set(payload, () => {
      void chrome.runtime.lastError;
      notifyActiveTab({ type: 'QRLH_SETTINGS_CHANGED' });
    });
  });
}

function notifyActiveTab(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) return;
    chrome.tabs.sendMessage(tab.id, msg, () => void chrome.runtime.lastError);
  });
}

/* ------------------------------ 通用 ------------------------------ */

function setStatus(text, isError) {
  statusEl.textContent = text || '';
  statusEl.classList.toggle('error', !!isError);
}

function copyToClipboard(text) {
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => {
      try {
        resultText.select();
        return document.execCommand('copy');
      } catch (e) {
        return false;
      }
    });
}

function showResult(text, src) {
  currentText = text;
  const urlLike = window.QRLH.isUrlLike(text);
  resultTitle.textContent = urlLike ? '识别到链接' : '识别到文本';
  resultText.value = text;
  $('copyBtn').textContent = urlLike ? '复制链接' : '复制文本';
  $('openBtn').style.display = urlLike ? '' : 'none';
  resultBox.classList.remove('hidden');
}

/* ------------------------------ 图片识别 ------------------------------ */

async function decodeFile(file) {
  if (!file || !/^image\//.test(file.type)) {
    setStatus('请选择图片文件', true);
    return;
  }
  setStatus('正在识别…');
  const url = URL.createObjectURL(file);
  try {
    const image = await window.QRLH.loadImage(url);
    const r = window.QRLH.decodeSource(image);
    if (r.text) {
      const text = window.QRLH.prettyText(r.text);
      showResult(text, file.name);
      if (settings.autoCopy) await copyToClipboard(text);
      setStatus((settings.autoCopy ? '已识别并复制：' : '已识别：') + text.slice(0, 60) + (text.length > 60 ? '…' : ''));
    } else {
      setStatus('这张图片里没有识别到二维码（已尝试反色与多倍放大）', true);
    }
  } catch (e) {
    setStatus('图片读取失败：' + (e && e.message ? e.message : e), true);
  } finally {
    URL.revokeObjectURL(url);
  }
}

$('pickBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) decodeFile(file);
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((type) => {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragging');
  });
});
['dragleave', 'drop'].forEach((type) => {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragging');
  });
});
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) decodeFile(file);
});

document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind === 'file' && /^image\//.test(item.type)) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        decodeFile(file);
      }
      return;
    }
  }
});

/* ------------------------------ 本页结果 ------------------------------ */

function renderPageResults(items) {
  pageList.textContent = '';
  const list = Array.isArray(items) ? items : [];
  pageEmpty.style.display = list.length ? 'none' : '';
  pageTitle.textContent = '本页识别到的二维码' + (list.length ? '（' + list.length + '）' : '');

  list.forEach((item) => {
    const li = document.createElement('li');
    const txt = document.createElement('div');
    txt.className = 'txt';
    txt.textContent = item.text;
    const btn = document.createElement('button');
    btn.className = 'copy';
    btn.type = 'button';
    btn.textContent = '复制';
    btn.addEventListener('click', async () => {
      const ok = await copyToClipboard(item.text);
      btn.textContent = ok ? '已复制' : '失败';
      setTimeout(() => {
        btn.textContent = '复制';
      }, 1200);
    });
    li.append(txt, btn);
    pageList.appendChild(li);
  });
}

function loadPageResults() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null || /^(chrome|edge|about|devtools):/i.test(tab.url || '')) {
      renderPageResults([]);
      pageEmpty.textContent = '当前页面不允许扩展访问（浏览器内置页面），可以改用上面的图片识别。';
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'QRLH_GET_RESULTS' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        renderPageResults([]);
        return;
      }
      renderPageResults(res.items || []);
    });
  });
}

$('scanBtn').addEventListener('click', () => {
  const btn = $('scanBtn');
  btn.textContent = '扫描中…';
  btn.disabled = true;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) {
      btn.textContent = '扫描本页';
      btn.disabled = false;
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'QRLH_SCAN_ALL' }, (res) => {
      btn.textContent = '扫描本页';
      btn.disabled = false;
      if (chrome.runtime.lastError || !res) {
        renderPageResults([]);
        return;
      }
      renderPageResults(res.items || []);
    });
  });
});

/* ------------------------------ 按钮 ------------------------------ */

$('copyBtn').addEventListener('click', async () => {
  if (!currentText) return;
  const ok = await copyToClipboard(currentText);
  $('copyBtn').textContent = ok ? '已复制 ✓' : '复制失败';
  setTimeout(() => {
    $('copyBtn').textContent = window.QRLH.isUrlLike(currentText) ? '复制链接' : '复制文本';
  }, 1200);
});

$('openBtn').addEventListener('click', () => {
  if (!currentText) return;
  chrome.tabs.create({ url: window.QRLH.toOpenableUrl(currentText) });
});

/* ------------------------------ 初始化 ------------------------------ */

loadSettings();
bindSetting('setHover', 'hoverButton');
bindSetting('setAuto', 'autoScan');
bindSetting('setPaste', 'pasteDecode');
bindSetting('setAutoCopy', 'autoCopy');
loadPageResults();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'QRLH_RESULT_ADDED') loadPageResults();
});
