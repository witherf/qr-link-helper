/*
 * background.js —— 右键菜单、跨域图片抓取、角标、打开链接
 */
'use strict';

const MENU_ID = 'qrlh-decode-image';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '识别图片中的二维码',
      contexts: ['image']
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || tab.id == null) return;
  const url = info.srcUrl || '';
  if (!url) return;
  chrome.tabs.sendMessage(
    tab.id,
    { type: 'QRLH_DECODE_URL', url, fromContextMenu: true },
    { frameId: info.frameId || 0 },
    () => void chrome.runtime.lastError
  );
});

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchImage(url) {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return { ok: false, error: '图片请求失败（HTTP ' + res.status + '）' };
    const blob = await res.blob();
    if (blob.size > 12 * 1024 * 1024) return { ok: false, error: '图片过大（超过 12MB）' };
    const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png';
    const buf = await blob.arrayBuffer();
    return { ok: true, dataUrl: 'data:' + type + ';base64,' + arrayBufferToBase64(buf) };
  } catch (e) {
    return { ok: false, error: '图片抓取失败：' + (e && e.message ? e.message : e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'QRLH_FETCH_IMAGE') {
    fetchImage(msg.url).then(sendResponse);
    return true;
  }

  if (msg.type === 'QRLH_OPEN_URL' && msg.url) {
    chrome.tabs.create({ url: msg.url }, () => void chrome.runtime.lastError);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'QRLH_BADGE' && sender.tab && sender.tab.id != null) {
    const count = Number(msg.count) || 0;
    chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: count ? String(count) : '' });
    sendResponse({ ok: true });
    return;
  }
});

// 页面导航或 tab 关闭时清空角标
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ tabId, text: '' }, () => void chrome.runtime.lastError);
  }
});
