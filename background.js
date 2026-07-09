/**
 * Auto Refresh Pro - Background Service Worker
 * Manages timers and communicates between popup and content scripts
 */

// State per tab
const tabStates = new Map();
const floatWindowPrefs = new Map();
const badgeTimers = new Map();
const monitorNotificationTargets = new Map();
const IFRAME_XPATH_SEPARATOR = ' >> ';
const DEFAULT_VOICE_NOTIFY_MESSAGE = '监控区域内容已发生变化';
const DEFAULT_MONITOR_NOTIFY_MESSAGE = '监控区域发生变化，请及时查看。';

function getUrlCacheKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch (e) {
    return url || '';
  }
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function splitFrameXPath(xpath) {
  const value = String(xpath || '');
  const index = value.indexOf(IFRAME_XPATH_SEPARATOR);
  if (index === -1) {
    return { frameXPath: '', innerXPath: value };
  }
  return {
    frameXPath: value.slice(0, index).trim(),
    innerXPath: value.slice(index + IFRAME_XPATH_SEPARATOR.length).trim(),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMonitorValue(value) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || 'xx00';
}

function hashMonitorValue(value) {
  const normalized = normalizeMonitorValue(value);
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${hash >>> 0}`;
}

// ===== Message Handler =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (msg.type) {
    case 'START': {
      const activeTabId = getTargetTabId(msg, sender);
      if (!activeTabId) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      startTimer(activeTabId, msg);
      sendResponse({ ok: true });
      break;
    }

    case 'STOP': {
      const activeTabId = getTargetTabId(msg, sender);
      if (activeTabId) {
        stopTimer(activeTabId, true, true);
      }
      sendResponse({ ok: true });
      break;
    }

    case 'GET_STATUS': {
      const activeTabId = getTargetTabId(msg, sender);
      if (activeTabId && tabStates.has(activeTabId)) {
        const ts = tabStates.get(activeTabId);
        sendResponse({
          running: true,
          remaining: ts.waitingForLoad ? -1 : Math.ceil((ts.nextTick - Date.now()) / 1000),
          refreshCount: ts.refreshCount,
          interval: ts.interval,
          mode: ts.mode,
          xpath: ts.xpath,
          targetFrame: ts.targetFrame,
          maxCountEnabled: ts.maxCountEnabled,
          maxCount: ts.maxCount,
          waitingForLoad: ts.waitingForLoad,
          monitorEnabled: ts.monitorEnabled,
          monitorXpath: ts.monitorXpath,
          monitorTargetFrame: ts.monitorTargetFrame,
          voiceNotifyEnabled: ts.voiceNotifyEnabled,
          voiceNotifyMessage: ts.voiceNotifyMessage,
          popupNotifyEnabled: ts.popupNotifyEnabled,
          monitorNotifyMessage: ts.monitorNotifyMessage,
          floatWindowEnabled: ts.floatWindowEnabled,
          showTimerEnabled: ts.showTimerEnabled,
        });
      } else {
        sendResponse({ running: false });
      }
      break;
    }

    case 'UPDATE_INTERVAL': {
      const activeTabId = getTargetTabId(msg, sender);
      if (activeTabId && tabStates.has(activeTabId)) {
        const ts = tabStates.get(activeTabId);
        ts.interval = msg.interval;
        ts.nextTick = Date.now() + msg.interval * 1000;
        restartInterval(activeTabId);
      }
      sendResponse({ ok: true });
      break;
    }

    case 'UPDATE_MAX_COUNT': {
      const activeTabId = getTargetTabId(msg, sender);
      if (activeTabId && tabStates.has(activeTabId)) {
        const ts = tabStates.get(activeTabId);
        ts.maxCountEnabled = msg.maxCountEnabled || false;
        ts.maxCount = msg.maxCount || 0;
      }
      sendResponse({ ok: true });
      break;
    }

    case 'UPDATE_MONITOR': {
      const activeTabId = getTargetTabId(msg, sender);
      if (activeTabId && tabStates.has(activeTabId)) {
        const ts = tabStates.get(activeTabId);
        ts.monitorEnabled = msg.monitorEnabled || false;
        ts.monitorXpath = msg.monitorXpath || '';
        if (msg.monitorTargetFrame !== undefined) ts.monitorTargetFrame = msg.monitorTargetFrame || 'top';
        if (msg.voiceNotifyEnabled !== undefined) ts.voiceNotifyEnabled = !!msg.voiceNotifyEnabled;
        if (msg.voiceNotifyMessage !== undefined) ts.voiceNotifyMessage = msg.voiceNotifyMessage || DEFAULT_VOICE_NOTIFY_MESSAGE;
        if (msg.popupNotifyEnabled !== undefined) ts.popupNotifyEnabled = !!msg.popupNotifyEnabled;
        if (msg.monitorNotifyMessage !== undefined) {
          ts.monitorNotifyMessage = msg.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE;
        }
        if (ts.monitorEnabled && ts.monitorXpath) {
          ts.monitorLastHash = '';
          captureMonitorHash(activeTabId, ts, 10000).catch(() => {});
        } else {
          ts.monitorLastHash = '';
        }
      }
      sendResponse({ ok: true });
      break;
    }

    case 'UPDATE_FLOAT_WINDOW': {
      const activeTabId = getTargetTabId(msg, sender);
      if (activeTabId) {
        const enabled = msg.floatWindowEnabled || false;
        floatWindowPrefs.set(activeTabId, enabled);
        if (tabStates.has(activeTabId)) {
          const ts = tabStates.get(activeTabId);
          ts.floatWindowEnabled = enabled;
        }
        const ts = tabStates.get(activeTabId);
        chrome.tabs.sendMessage(activeTabId, {
          type: 'UPDATE_FLOAT_WINDOW',
          floatWindowEnabled: enabled,
          interval: ts ? ts.interval : msg.interval,
          remaining: ts ? Math.ceil((ts.nextTick - Date.now()) / 1000) : null,
          running: !!ts,
        }).catch(() => {});
      }
      sendResponse({ ok: true });
      break;
    }

    case 'FLOAT_START_REFRESH': {
      const activeTabId = getTargetTabId(msg, sender);
      if (!activeTabId) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      startTimerFromStoredConfig(activeTabId).then(() => {
        sendResponse({ ok: true });
      }).catch((e) => {
        sendResponse({ error: e.message || 'Failed to start refresh' });
      });
      return true;
    }

    case 'FLOAT_STOP_REFRESH': {
      const activeTabId = getTargetTabId(msg, sender);
      if (activeTabId) {
        stopTimer(activeTabId, true, true);
      }
      sendResponse({ ok: true });
      break;
    }

    case 'UPDATE_SHOW_TIMER': {
      const activeTabId = getTargetTabId(msg, sender);
      if (activeTabId && tabStates.has(activeTabId)) {
        const ts = tabStates.get(activeTabId);
        ts.showTimerEnabled = !!msg.showTimerEnabled;
        startBadgeTimer(activeTabId);
      } else if (activeTabId) {
        clearBadgeTimer(activeTabId);
      }
      sendResponse({ ok: true });
      break;
    }

    case 'UPDATE_NOTIFY': {
      const activeTabId = getTargetTabId(msg, sender);
      if (activeTabId && tabStates.has(activeTabId)) {
        const ts = tabStates.get(activeTabId);
        ts.voiceNotifyEnabled = msg.voiceNotifyEnabled || false;
        ts.voiceNotifyMessage = msg.voiceNotifyMessage || DEFAULT_VOICE_NOTIFY_MESSAGE;
        ts.popupNotifyEnabled = msg.popupNotifyEnabled || false;
        ts.monitorNotifyMessage = msg.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE;
      }
      sendResponse({ ok: true });
      break;
    }

    case 'UPDATE_MODE': {
      const activeTabId = getTargetTabId(msg, sender);
      if (activeTabId && tabStates.has(activeTabId)) {
        const ts = tabStates.get(activeTabId);
        if (msg.mode !== undefined) ts.mode = msg.mode;
        if (msg.xpath !== undefined) ts.xpath = msg.xpath;
        if (msg.targetFrame !== undefined) ts.targetFrame = msg.targetFrame;
        if (msg.monitorXpath !== undefined) ts.monitorXpath = msg.monitorXpath;
        ts.nextTick = Date.now() + ts.interval * 1000;
        ts.waitingForLoad = false;
        scheduleNextTick(activeTabId);
      }
      sendResponse({ ok: true });
      break;
    }

    // Content script sends this when xpath is picked
    case 'XPATH_PICKED': {
      // Resolve origin from sender tab
      let origin = '';
      let urlKey = '';
      try {
        if (sender.tab && sender.tab.url) {
          origin = new URL(sender.tab.url).origin;
          urlKey = getUrlCacheKey(sender.tab.url);
        }
      } catch (e) { /* ignore */ }

      const frameIndex = msg.frameIndex || 'top';

      // Read pickingFor from storage to determine which field this pick is for
      chrome.storage.local.get(['pickingFor']).then((storage) => {
        const pickingFor = storage.pickingFor || 'click';

        // Forward to popup with element info and frame index
        chrome.runtime.sendMessage({
          type: 'XPATH_PICKED',
          xpath: msg.xpath,
          tagName: msg.tagName || '',
          textContent: msg.textContent || '',
          cancelled: msg.cancelled || false,
          frameIndex: frameIndex,
          pickingFor: pickingFor,
        }).catch(() => {});

        // Persist to storage so popup can pick it up when reopened
        // Use independent keys for click and monitor xpath to prevent overwrite
        if (msg.xpath && !msg.cancelled) {
          const pendingKey = pickingFor === 'monitor' ? 'pendingMonitorXpathPick' : 'pendingClickXpathPick';
          chrome.storage.local.set({
            [pendingKey]: {
              xpath: msg.xpath,
              tagName: msg.tagName || '',
              textContent: msg.textContent || '',
              origin,
              urlKey,
              frameIndex: frameIndex,
              pickingFor: pickingFor,
              timestamp: Date.now(),
            }
          });
          // Also remove the other pending pick to avoid conflicts
          const otherKey = pickingFor === 'monitor' ? 'pendingClickXpathPick' : 'pendingMonitorXpathPick';
          chrome.storage.local.remove(otherKey).catch(() => {});
        } else if (msg.cancelled) {
          chrome.storage.local.remove(['pendingXpathPick', 'pendingClickXpathPick', 'pendingMonitorXpathPick']);
        }
      });

      // Show success notification on webpage (only for pick, not for auto-refresh clicks)
      if (msg.xpath && !msg.cancelled && tabId) {
        // Stop pickers in ALL frames of the tab (the picking frame stopped itself,
        // but other frames' pickers are still active)
        chrome.tabs.sendMessage(tabId, { type: 'STOP_PICKING' }).catch(() => {});

        chrome.tabs.sendMessage(tabId, {
          type: 'SHOW_XPATH_NOTIFICATION',
          xpath: msg.xpath,
          tagName: msg.tagName || '',
          textContent: msg.textContent || '',
        }).catch(() => {});
      }
      break;
    }

    // Content script sends result from xpath click execution (during auto-refresh)
    case 'XPATH_EXEC_RESULT': {
      // No webpage notification — errors are logged to popup only
      break;
    }

    // Popup asks background to start picker on active tab (popup will close itself)
    case 'START_PICKER': {
      const tabIdToUse = getTargetTabId(msg, sender);
      if (tabIdToUse) {
        // Broadcast to all frames — content script in each frame decides
        // whether to activate based on its own myFrameIndex
        chrome.tabs.sendMessage(tabIdToUse, { type: 'START_PICKING' }).catch(() => {});
      }
      sendResponse({ ok: true });
      break;
    }

    case 'CONTENT_READY': {
      // Content script reloaded (page navigation/load). Re-sync float window state.
      const activeTabId = getTargetTabId(msg, sender);
      if (activeTabId) {
        const ts = tabStates.get(activeTabId);
        const enabled = ts ? !!ts.floatWindowEnabled : !!floatWindowPrefs.get(activeTabId);
        const interval = ts ? ts.interval : (msg.interval || 60);
        const remaining = ts ? Math.ceil((ts.nextTick - Date.now()) / 1000) : null;
        chrome.tabs.sendMessage(activeTabId, {
          type: 'UPDATE_FLOAT_WINDOW',
          floatWindowEnabled: enabled,
          interval,
          remaining,
          running: !!ts,
        }).catch(() => {});
      }
      sendResponse({ ok: true });
      break;
    }

    // Popup asks to cancel picking
    case 'STOP_PICKER': {
      const tabIdToUse = getTargetTabId(msg, sender);
      if (tabIdToUse) {
        chrome.tabs.sendMessage(tabIdToUse, { type: 'STOP_PICKING' }).catch(() => {});
      }
      break;
    }

    // Popup asks for all currently active refresh sessions
    case 'GET_ACTIVE_SITES': {
      getActiveSites().then((sites) => sendResponse({ sites }));
      return true; // async sendResponse
    }
  }

  return true; // Keep message channel open for async sendResponse
});

// ===== Timer Management =====
function startTimer(tabId, config) {
  // Stop existing timer if any
  stopTimer(tabId, false, false);

  const ts = {
    tabId,
    interval: config.interval,
    mode: config.mode,
    xpath: config.xpath || '',
    targetFrame: config.targetFrame || 'top',
    refreshCount: 0,
    maxCountEnabled: config.maxCountEnabled || false,
    maxCount: config.maxCount || 0, // 0 = unlimited
    nextTick: Date.now() + config.interval * 1000,
    timerId: null,
    waitingForLoad: false, // true when waiting for page to finish loading after full refresh
    monitorEnabled: config.monitorEnabled || false,
    monitorXpath: config.monitorXpath || '',
    monitorTargetFrame: config.monitorTargetFrame || 'top',
    monitorLastHash: '',
    voiceNotifyEnabled: config.voiceNotifyEnabled || false,
    voiceNotifyMessage: config.voiceNotifyMessage || DEFAULT_VOICE_NOTIFY_MESSAGE,
    popupNotifyEnabled: config.popupNotifyEnabled || false,
    monitorNotifyMessage: config.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE,
    floatWindowEnabled: config.floatWindowEnabled || floatWindowPrefs.get(tabId) || false,
    showTimerEnabled: config.showTimerEnabled || false,
  };

  floatWindowPrefs.set(tabId, ts.floatWindowEnabled);
  tabStates.set(tabId, ts);
  scheduleNextTick(tabId);
  startBadgeTimer(tabId);

  if (ts.monitorEnabled && ts.monitorXpath) {
    captureMonitorHash(tabId, ts, 10000).catch(() => {});
  }

  // Create float window if enabled
  if (ts.floatWindowEnabled) {
    chrome.tabs.sendMessage(tabId, {
      type: 'UPDATE_FLOAT_WINDOW',
      floatWindowEnabled: true,
      interval: ts.interval,
      remaining: ts.interval,
      running: true,
    }).catch(() => {});
  }

  // Save running state
  syncRunningStorage();
  notifyActiveSitesChanged();
}
function stopTimer(tabId, notify = true, keepFloatWindow = true) {
  const ts = tabStates.get(tabId);
  if (ts) {
    const floatWindowEnabled = keepFloatWindow
      ? (ts.floatWindowEnabled || floatWindowPrefs.get(tabId) || false)
      : false;
    floatWindowPrefs.set(tabId, floatWindowEnabled);

    chrome.tabs.sendMessage(tabId, {
      type: 'UPDATE_FLOAT_WINDOW',
      floatWindowEnabled,
      interval: ts.interval,
      remaining: null,
      running: false,
    }).catch(() => {});

    if (ts.timerId) {
      clearTimeout(ts.timerId);
      ts.timerId = null;
    }
    tabStates.delete(tabId);
  }
  clearBadgeTimer(tabId);
  chrome.alarms.clear(`refresh-tick-${tabId}`).catch(() => {});
  syncRunningStorage();
  if (notify) notifyActiveSitesChanged();
}

function scheduleNextTick(tabId) {
  const ts = tabStates.get(tabId);
  if (!ts) return;

  if (ts.timerId) {
    clearTimeout(ts.timerId);
  }

  const delay = Math.max(0, ts.nextTick - Date.now());
  ts.timerId = setTimeout(() => executeTick(tabId), delay);

  // Also create alarm as backup (service worker may be killed by Chrome)
  chrome.alarms.create(`refresh-tick-${tabId}`, {
    when: ts.nextTick,
  });
}

function restartInterval(tabId) {
  const ts = tabStates.get(tabId);
  if (!ts) return;
  ts.nextTick = Date.now() + ts.interval * 1000;
  scheduleNextTick(tabId);
  updateBadgeForTab(tabId);
}

async function startTimerFromStoredConfig(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const storage = await chrome.storage.local.get([
    'siteSettingsCache',
    'interval',
    'mode',
    'xpathCache',
    'targetFrame',
    'maxCountEnabled',
    'maxCount',
    'maxCountCache',
    'monitorEnabled',
    'monitorXpath',
    'monitorXpathCache',
    'monitorTargetFrame',
    'voiceNotifyEnabled',
    'voiceNotifyMessageCache',
    'popupNotifyEnabled',
    'monitorNotifyMessageCache',
    'floatWindowEnabled',
    'floatWindowCache',
    'showTimerEnabled',
  ]);

  let origin = '';
  let pageKey = '';
  try {
    if (tab && tab.url) {
      origin = new URL(tab.url).origin;
      pageKey = getUrlCacheKey(tab.url);
    }
  } catch (e) { /* ignore */ }

  const xpathCache = storage.xpathCache || {};
  const maxCountCache = storage.maxCountCache || {};
  const monitorXpathCache = storage.monitorXpathCache || {};
  const voiceNotifyMessageCache = storage.voiceNotifyMessageCache || {};
  const monitorNotifyMessageCache = storage.monitorNotifyMessageCache || {};
  const floatWindowCache = storage.floatWindowCache || {};
  const siteSettingsCache = storage.siteSettingsCache || {};
  const siteSettings = pageKey ? (siteSettingsCache[pageKey] || {}) : {};
  const cachedXpath = pageKey ? (xpathCache[pageKey] || (origin ? xpathCache[origin] : '')) : '';
  const cachedMaxCount = pageKey
    ? (maxCountCache[pageKey] !== undefined ? maxCountCache[pageKey] : (origin ? maxCountCache[origin] : undefined))
    : undefined;
  const mode = hasOwn(siteSettings, 'mode') ? (siteSettings.mode || 'full') : (storage.mode || 'full');
  const xpath = cachedXpath && cachedXpath !== '__full__' ? cachedXpath : '';
  const pageXpath = hasOwn(siteSettings, 'xpath') ? (siteSettings.xpath || '') : xpath;
  const targetFrame = hasOwn(siteSettings, 'targetFrame') ? (siteSettings.targetFrame || 'top') : (storage.targetFrame || 'top');
  const monitorEnabled = hasOwn(siteSettings, 'monitorEnabled') ? !!siteSettings.monitorEnabled : !!storage.monitorEnabled;
  const monitorXpath = hasOwn(siteSettings, 'monitorXpath')
    ? (siteSettings.monitorXpath || '')
    : (pageKey ? (monitorXpathCache[pageKey] || '') : (storage.monitorXpath || ''));
  const monitorTargetFrame = hasOwn(siteSettings, 'monitorTargetFrame')
    ? (siteSettings.monitorTargetFrame || 'top')
    : (storage.monitorTargetFrame || 'top');
  const monitorNotifyMessage = hasOwn(siteSettings, 'monitorNotifyMessage')
    ? (siteSettings.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE)
    : (pageKey ? (monitorNotifyMessageCache[pageKey] || DEFAULT_MONITOR_NOTIFY_MESSAGE) : DEFAULT_MONITOR_NOTIFY_MESSAGE);
  const voiceNotifyMessage = hasOwn(siteSettings, 'voiceNotifyMessage')
    ? (siteSettings.voiceNotifyMessage || DEFAULT_VOICE_NOTIFY_MESSAGE)
    : (pageKey ? (voiceNotifyMessageCache[pageKey] || DEFAULT_VOICE_NOTIFY_MESSAGE) : DEFAULT_VOICE_NOTIFY_MESSAGE);
  const pageFloatWindowEnabled = hasOwn(siteSettings, 'floatWindowEnabled')
    ? !!siteSettings.floatWindowEnabled
    : (pageKey ? !!floatWindowCache[pageKey] : !!storage.floatWindowEnabled);
  const maxCountEnabled = hasOwn(siteSettings, 'maxCountEnabled')
    ? !!siteSettings.maxCountEnabled
    : (cachedMaxCount !== undefined
    ? !!cachedMaxCount.enabled
    : (storage.maxCountEnabled !== undefined ? !!storage.maxCountEnabled : (storage.maxCount || 0) > 0));
  const maxCount = hasOwn(siteSettings, 'maxCount')
    ? (Number(siteSettings.maxCount) || 0)
    : (cachedMaxCount !== undefined
    ? Number(cachedMaxCount.count) || 0
    : (storage.maxCount || 0));
  const interval = hasOwn(siteSettings, 'interval') ? (Number(siteSettings.interval) || 60) : (storage.interval || 60);
  const voiceNotifyEnabled = hasOwn(siteSettings, 'voiceNotifyEnabled')
    ? !!siteSettings.voiceNotifyEnabled
    : !!storage.voiceNotifyEnabled;
  const popupNotifyEnabled = hasOwn(siteSettings, 'popupNotifyEnabled')
    ? !!siteSettings.popupNotifyEnabled
    : !!storage.popupNotifyEnabled;
  const showTimerEnabled = hasOwn(siteSettings, 'showTimerEnabled')
    ? !!siteSettings.showTimerEnabled
    : !!storage.showTimerEnabled;

  if (mode === 'xpath' && !pageXpath) {
    throw new Error('XPath is required before starting XPath refresh');
  }
  if (monitorEnabled && !monitorXpath) {
    throw new Error('Monitor XPath is required before starting monitor refresh');
  }

  startTimer(tabId, {
    interval,
    mode,
    xpath: pageXpath,
    targetFrame,
    maxCountEnabled,
    maxCount,
    monitorEnabled,
    monitorXpath,
    monitorTargetFrame,
    // alertSettingsEnabled legacy flag removed; rely on individual notify flags
    voiceNotifyEnabled,
    voiceNotifyMessage,
    popupNotifyEnabled,
    monitorNotifyMessage,
    floatWindowEnabled: pageFloatWindowEnabled || floatWindowPrefs.get(tabId) || true,
    showTimerEnabled,
  });
}

function formatBadgeRemaining(remaining) {
  if (remaining < 0) return '...';
  if (remaining <= 999) return String(remaining);
  const minutes = Math.ceil(remaining / 60);
  return minutes > 99 ? '99m' : String(minutes) + 'm';
}

function updateBadgeForTab(tabId) {
  const ts = tabStates.get(tabId);
  if (!ts || !ts.showTimerEnabled) {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    return;
  }

  const remaining = ts.waitingForLoad ? -1 : Math.max(0, Math.ceil((ts.nextTick - Date.now()) / 1000));
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: formatBadgeRemaining(remaining) }).catch(() => {});
}

function clearBadgeTimer(tabId) {
  const badgeTimerId = badgeTimers.get(tabId);
  if (badgeTimerId) clearInterval(badgeTimerId);
  badgeTimers.delete(tabId);
  chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
}

function startBadgeTimer(tabId) {
  const existing = badgeTimers.get(tabId);
  if (existing) clearInterval(existing);
  badgeTimers.delete(tabId);

  const ts = tabStates.get(tabId);
  if (!ts || !ts.showTimerEnabled) {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    return;
  }

  updateBadgeForTab(tabId);
  badgeTimers.set(tabId, setInterval(() => updateBadgeForTab(tabId), 1000));
}

async function getXPathText(tabId, xpath, fallbackFrame = 'top') {
  const parsed = splitFrameXPath(xpath);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      func: (frameXPath, innerXPath, separator) => {
        const getMonitorValue = (element) => {
          const text = (element.textContent || '').trim();
          const inputValue = 'value' in element ? String(element.value || '') : '';
          const checkedValue = 'checked' in element ? String(element.checked) : '';
          const selectedValue = 'selectedIndex' in element ? String(element.selectedIndex) : '';
          const attrs = ['class', 'style', 'title', 'aria-label', 'aria-pressed', 'aria-selected', 'data-value']
            .map((name) => element.getAttribute(name) || '')
            .filter(Boolean)
            .join('|');
          const html = (element.innerHTML || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
          return [text, inputValue, checkedValue, selectedValue, attrs, html].filter(Boolean).join('||');
        };

        try {
          if (frameXPath) {
            if (window === window.top) {
              const frameResult = document.evaluate(frameXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              const iframe = frameResult.singleNodeValue;
              const index = Array.from(document.querySelectorAll('iframe')).indexOf(iframe);
              return index >= 0 ? `${separator}${index}` : '';
            }
            return null;
          }

          const result = document.evaluate(innerXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          const element = result.singleNodeValue;
          return element ? getMonitorValue(element) : null;
        } catch (e) {
          return null;
        }
      },
      args: [parsed.frameXPath, parsed.innerXPath, IFRAME_XPATH_SEPARATOR],
    });
    if (parsed.frameXPath) {
      const marker = results.find((r) => typeof r.result === 'string' && r.result.startsWith(IFRAME_XPATH_SEPARATOR))?.result;
      let targetFrame = marker ? marker.slice(IFRAME_XPATH_SEPARATOR.length) : '';
      if (!targetFrame && fallbackFrame && fallbackFrame !== 'top') {
        targetFrame = String(fallbackFrame);
      }
      if (!targetFrame) return null;
      await syncFrameIndexes(tabId);
      await sleep(60);

      const frameResults = await chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: true },
        func: (innerXPath, frameIndex) => {
          const getMonitorValue = (element) => {
            const text = (element.textContent || '').trim();
            const inputValue = 'value' in element ? String(element.value || '') : '';
            const checkedValue = 'checked' in element ? String(element.checked) : '';
            const selectedValue = 'selectedIndex' in element ? String(element.selectedIndex) : '';
            const attrs = ['class', 'style', 'title', 'aria-label', 'aria-pressed', 'aria-selected', 'data-value']
              .map((name) => element.getAttribute(name) || '')
              .filter(Boolean)
              .join('|');
            const html = (element.innerHTML || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
            return [text, inputValue, checkedValue, selectedValue, attrs, html].filter(Boolean).join('||');
          };

          try {
            if (window === window.top) return null;
            if (String(window.__autoRefreshFrameIndex || '') !== String(frameIndex)) return null;
            const result = document.evaluate(innerXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            const element = result.singleNodeValue;
            return element ? getMonitorValue(element) : null;
          } catch (e) {
            return null;
          }
        },
        args: [parsed.innerXPath, targetFrame],
      });
      for (const r of frameResults) {
        if (r.result !== null && r.result !== undefined) return r.result;
      }
      return null;
    }
    for (const r of results) {
      if (r.result !== null && r.result !== undefined) return r.result;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function resolveFrameTarget(tabId, xpath, fallbackFrame) {
  const parsed = splitFrameXPath(xpath);
  if (!parsed.frameXPath) return fallbackFrame || 'top';

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (frameXPath) => {
        try {
          const result = document.evaluate(frameXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          const iframe = result.singleNodeValue;
          const index = Array.from(document.querySelectorAll('iframe')).indexOf(iframe);
          return index >= 0 ? String(index) : '';
        } catch (e) {
          return '';
        }
      },
      args: [parsed.frameXPath],
    });
    return results?.[0]?.result || fallbackFrame || 'top';
  } catch (e) {
    return fallbackFrame || 'top';
  }
}

async function syncFrameIndexes(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        document.querySelectorAll('iframe').forEach((iframe, index) => {
          try {
            iframe.contentWindow?.postMessage({
              source: 'AUTO_REFRESH_PRO',
              type: 'SET_FRAME_INDEX',
              frameIndex: String(index),
            }, '*');
          } catch (e) { /* ignore */ }
        });
      },
    });
  } catch (e) { /* ignore */ }
}

async function waitForXPathText(tabId, xpath, timeoutMs = 10000, fallbackFrame = 'top') {
  const startTime = Date.now();
  const intervalMs = 500;
  let lastText = null;
  while (Date.now() - startTime < timeoutMs) {
    const text = await getXPathText(tabId, xpath, fallbackFrame);
    if (text !== null && text !== undefined) return text;
    lastText = text;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return lastText;
}

async function captureMonitorHash(tabId, ts, timeoutMs = 10000) {
  if (!ts.monitorEnabled || !ts.monitorXpath) return false;

  const value = await waitForXPathText(tabId, ts.monitorXpath, timeoutMs, ts.monitorTargetFrame);
  if (value === null || value === undefined) return false;

  ts.monitorLastHash = hashMonitorValue(value);
  return true;
}

async function ensureMonitorBaseline(tabId, ts, timeoutMs = 2000) {
  if (!ts.monitorLastHash) {
    await captureMonitorHash(tabId, ts, timeoutMs);
  }
}

async function checkMonitorChange(tabId, ts, timeoutMs = 10000) {
  if (!ts.monitorEnabled || !ts.monitorXpath) return;

  const value = await waitForXPathText(tabId, ts.monitorXpath, timeoutMs, ts.monitorTargetFrame);
  if (value === null || value === undefined) return;

  const newHash = hashMonitorValue(value);
  if (!ts.monitorLastHash) {
    ts.monitorLastHash = newHash;
    return;
  }

  if (newHash !== ts.monitorLastHash) {
    ts.monitorLastHash = newHash;
    await triggerMonitorNotify(tabId, ts);
  }
}

async function triggerMonitorNotify(tabId, ts) {
  if (!ts.voiceNotifyEnabled && !ts.popupNotifyEnabled) return;

  let notified = false;
  if (ts.popupNotifyEnabled) {
    notified = await createMonitorSystemNotification(tabId, ts);
  }

  if (ts.voiceNotifyEnabled) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (message) => {
          try {
            const utterance = new SpeechSynthesisUtterance(message);
            utterance.lang = 'zh-CN';
            utterance.rate = 1.0;
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utterance);
            return true;
          } catch (e) {
            return false;
          }
        },
        args: [ts.voiceNotifyMessage || DEFAULT_VOICE_NOTIFY_MESSAGE],
      });
      if (results?.some((item) => item.result)) notified = true;
    } catch (e) {
      // System popup notification has already been attempted above.
    }
  }

  chrome.runtime.sendMessage({
    type: 'MONITOR_CHANGED',
    tabId,
    voice: ts.voiceNotifyEnabled,
    popup: ts.popupNotifyEnabled,
    notified,
  }).catch(() => {});
}

async function createMonitorSystemNotification(tabId, ts) {
  try {
    let title = '';
    try {
      const tab = await chrome.tabs.get(tabId);
      title = tab?.title || '';
    } catch (e) { /* ignore */ }

    const notificationId = `monitor-${tabId}-${Date.now()}`;
    monitorNotificationTargets.set(notificationId, tabId);
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title || '监控页面',
      message: ts.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE,
      priority: 2,
    });
    setTimeout(() => {
      monitorNotificationTargets.delete(notificationId);
      chrome.notifications.clear(notificationId).catch(() => {});
    }, 5000);
    return true;
  } catch (e) {
    return false;
  }
}

chrome.notifications.onClicked.addListener((notificationId) => {
  const tabId = monitorNotificationTargets.get(notificationId);
  if (!tabId) return;

  monitorNotificationTargets.delete(notificationId);
  chrome.notifications.clear(notificationId).catch(() => {});
  chrome.tabs.get(tabId).then((tab) => {
    if (!tab?.id) return;
    if (tab.windowId !== undefined) {
      chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  }).catch(() => {});
});

chrome.notifications.onClosed.addListener((notificationId) => {
  monitorNotificationTargets.delete(notificationId);
});

async function executeTick(tabId) {
  const ts = tabStates.get(tabId);
  if (!ts) return;

  // Prevent re-entrant calls (setTimeout + alarm race)
  if (ts.ticking) return;
  ts.ticking = true;

  // Check max count limit
  if (ts.maxCountEnabled && ts.maxCount > 0 && ts.refreshCount >= ts.maxCount) {
    stopTimer(tabId);
    chrome.runtime.sendMessage({
      type: 'REFRESH_DONE',
      tabId,
      count: ts.refreshCount,
      mode: ts.mode,
      limitReached: true,
    }).catch(() => {});
    return;
  }

  try {
    if (ts.mode === 'full') {
      // Full page refresh. Monitor comparison runs after the reloaded page is ready.
      await ensureMonitorBaseline(tabId, ts, 2000);
      ts.waitingForLoad = true;
      updateBadgeForTab(tabId);
      await chrome.tabs.reload(tabId);
      ts.refreshCount++;

      // Notify popup immediately that refresh was triggered
      chrome.runtime.sendMessage({
        type: 'REFRESH_DONE',
        tabId,
        count: ts.refreshCount,
        mode: 'full',
        waitingForLoad: true,
      }).catch(() => {});

    } else if (ts.mode === 'xpath') {
      // XPath click mode - send message to content script in target frame.
      await ensureMonitorBaseline(tabId, ts, 2000);
      const resolvedTargetFrame = await resolveFrameTarget(tabId, ts.xpath, ts.targetFrame);
      await syncFrameIndexes(tabId);
      await sleep(60);
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'EXECUTE_XPATH_CLICK',
          xpath: ts.xpath,
          targetFrame: resolvedTargetFrame,
        });
      } catch (e) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js'],
          });
          await chrome.tabs.sendMessage(tabId, {
            type: 'EXECUTE_XPATH_CLICK',
            xpath: ts.xpath,
            targetFrame: resolvedTargetFrame,
          });
        } catch (e2) {
          throw new Error(`XPath 点击执行失败: ${e2.message}`);
        }
      }

      ts.refreshCount++;
      ts.nextTick = Date.now() + ts.interval * 1000;
      scheduleNextTick(tabId);
      updateBadgeForTab(tabId);

      // For xpath mode, check monitor change after click with retry
      if (ts.monitorEnabled && ts.monitorXpath) {
        setTimeout(async () => {
          await checkMonitorChange(tabId, ts, 10000);
        }, 500);
      }

      chrome.runtime.sendMessage({
        type: 'REFRESH_DONE',
        tabId,
        count: ts.refreshCount,
        mode: 'xpath',
      }).catch(() => {});
    }
  } catch (e) {
    chrome.runtime.sendMessage({
      type: 'REFRESH_ERROR',
      error: e.message || 'Unknown error',
    }).catch(() => {});

    ts.nextTick = Date.now() + ts.interval * 1000;
    scheduleNextTick(tabId);
    updateBadgeForTab(tabId);
  }
  ts.ticking = false;
}

// ===== Tab Lifecycle =====
chrome.tabs.onRemoved.addListener((tabId) => {
  stopTimer(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && tabStates.has(tabId)) {
    const ts = tabStates.get(tabId);
    if (ts && ts.waitingForLoad) {
      // Page has finished loading after a full refresh
      ts.waitingForLoad = false;
      // Now start the countdown for the next refresh
      ts.nextTick = Date.now() + ts.interval * 1000;
      scheduleNextTick(tabId);
      // Check monitor change after page loaded with retry (up to 10s)
      if (ts.monitorEnabled && ts.monitorXpath) {
        setTimeout(async () => {
          await checkMonitorChange(tabId, ts, 10000);
        }, 500);
      }

      updateBadgeForTab(tabId);

      // Notify popup that page load is complete and countdown restarted
      chrome.runtime.sendMessage({
        type: 'PAGE_LOADED',
        tabId,
        count: ts.refreshCount,
      }).catch(() => {});
    }
  }
});

// ===== Helpers =====
function getActiveTabId() {
  // We use a synchronous approach - the popup sends the active tab context
  // For simplicity, we track the most recently active tab
  return currentActiveTabId;
}

function getTargetTabId(msg, sender) {
  return msg.tabId || sender.tab?.id || currentActiveTabId;
}

async function getActiveSites() {
  const sites = [];
  const entries = Array.from(tabStates.entries());

  for (const [tabId, ts] of entries) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab) {
        stopTimer(tabId);
        continue;
      }

      sites.push({
        tabId,
        url: tab.url || '',
        title: tab.title || '',
        mode: ts.mode,
        xpath: ts.xpath,
        interval: ts.interval,
        refreshCount: ts.refreshCount,
      });
    } catch (e) {
      stopTimer(tabId);
    }
  }

  return sites;
}

function syncRunningStorage() {
  chrome.storage.local.set({ running: tabStates.size > 0 });
}

function notifyActiveSitesChanged() {
  chrome.runtime.sendMessage({
    type: 'ACTIVE_SITES_CHANGED',
    count: tabStates.size,
  }).catch(() => {});
}
let currentActiveTabId = null;

// Track active tab
chrome.tabs.onActivated.addListener((activeInfo) => {
  currentActiveTabId = activeInfo.tabId;
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      if (tabs.length > 0) {
        currentActiveTabId = tabs[0].id;
      }
    });
  }
});

// Initialize active tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs.length > 0) {
    currentActiveTabId = tabs[0].id;
  }
});

// ===== Alarm-based fallback for service worker survival =====
// Chrome may terminate service workers; use alarms as backup
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('refresh-tick-')) {
    const tabId = parseInt(alarm.name.replace('refresh-tick-', ''), 10);
    const ts = tabStates.get(tabId);
    if (ts && Date.now() >= ts.nextTick) {
      executeTick(tabId);
    }
  }
});

// ===== Storage watch — popup writes pickingRequested then closes =====
// Double-path insurance: message handler above handles START_PICKER, this handles dormant-SW case
chrome.storage.onChanged.addListener((changes) => {
  if (changes.pickingRequested && changes.pickingRequested.newValue) {
    const tabId = getActiveTabId();
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'START_PICKING' }).catch(() => {});
    } else {
      // Fallback: query the active tab directly
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'START_PICKING' }).catch(() => {});
        }
      });
    }
    chrome.storage.local.remove('pickingRequested').catch(() => {});
  }
});
