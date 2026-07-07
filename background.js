/**
 * Auto Refresh Pro - Background Service Worker
 * Manages timers and communicates between popup and content scripts
 */

// State per tab
const tabStates = new Map();
const floatWindowPrefs = new Map();
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
          maxCount: ts.maxCount,
          waitingForLoad: ts.waitingForLoad,
          monitorEnabled: ts.monitorEnabled,
          monitorXpath: ts.monitorXpath,
          voiceNotifyEnabled: ts.voiceNotifyEnabled,
          popupNotifyEnabled: ts.popupNotifyEnabled,
          monitorNotifyMessage: ts.monitorNotifyMessage,
          floatWindowEnabled: ts.floatWindowEnabled,
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
        if (msg.monitorNotifyMessage !== undefined) {
          ts.monitorNotifyMessage = msg.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE;
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

    case 'UPDATE_NOTIFY': {
      const activeTabId = getTargetTabId(msg, sender);
      if (activeTabId && tabStates.has(activeTabId)) {
        const ts = tabStates.get(activeTabId);
        ts.voiceNotifyEnabled = msg.voiceNotifyEnabled || false;
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
    maxCount: config.maxCount || 0, // 0 = unlimited
    nextTick: Date.now() + config.interval * 1000,
    timerId: null,
    waitingForLoad: false, // true when waiting for page to finish loading after full refresh
    monitorEnabled: config.monitorEnabled || false,
    monitorXpath: config.monitorXpath || '',
    monitorLastValue: '',
    voiceNotifyEnabled: config.voiceNotifyEnabled || false,
    popupNotifyEnabled: config.popupNotifyEnabled || false,
    monitorNotifyMessage: config.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE,
    floatWindowEnabled: config.floatWindowEnabled || floatWindowPrefs.get(tabId) || false,
  };

  floatWindowPrefs.set(tabId, ts.floatWindowEnabled);
  tabStates.set(tabId, ts);
  scheduleNextTick(tabId);

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
}

async function startTimerFromStoredConfig(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const storage = await chrome.storage.local.get([
    'interval',
    'mode',
    'xpathCache',
    'targetFrame',
    'maxCount',
    'monitorEnabled',
    'monitorXpath',
    'monitorXpathCache',
    'monitorNotifyMessageCache',
    'floatWindowCache',
    'voiceNotifyEnabled',
    'popupNotifyEnabled',
    'floatWindowEnabled',
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
  const monitorXpathCache = storage.monitorXpathCache || {};
  const monitorNotifyMessageCache = storage.monitorNotifyMessageCache || {};
  const floatWindowCache = storage.floatWindowCache || {};
  const cachedXpath = origin ? xpathCache[origin] : '';
  const mode = storage.mode || 'full';
  const xpath = cachedXpath && cachedXpath !== '__full__' ? cachedXpath : '';
  const monitorXpath = pageKey ? (monitorXpathCache[pageKey] || '') : (storage.monitorXpath || '');
  const monitorNotifyMessage = pageKey
    ? (monitorNotifyMessageCache[pageKey] || DEFAULT_MONITOR_NOTIFY_MESSAGE)
    : DEFAULT_MONITOR_NOTIFY_MESSAGE;
  const pageFloatWindowEnabled = pageKey
    ? !!floatWindowCache[pageKey]
    : !!storage.floatWindowEnabled;

  if (mode === 'xpath' && !xpath) {
    throw new Error('XPath is required before starting XPath refresh');
  }
  if (storage.monitorEnabled && !monitorXpath) {
    throw new Error('Monitor XPath is required before starting monitor refresh');
  }

  startTimer(tabId, {
    interval: storage.interval || 60,
    mode,
    xpath,
    targetFrame: storage.targetFrame || 'top',
    maxCount: storage.maxCount || 0,
    monitorEnabled: storage.monitorEnabled || false,
    monitorXpath,
    voiceNotifyEnabled: storage.voiceNotifyEnabled || false,
    popupNotifyEnabled: storage.popupNotifyEnabled || false,
    monitorNotifyMessage,
    floatWindowEnabled: pageFloatWindowEnabled || floatWindowPrefs.get(tabId) || true,
  });
}

async function getXPathText(tabId, xpath) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      func: (xpathStr) => {
        try {
          const result = document.evaluate(xpathStr, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          const element = result.singleNodeValue;
          return element ? (element.textContent || '').trim() : '';
        } catch (e) {
          return '';
        }
      },
      args: [xpath],
    });
    for (const r of results) {
      if (r.result) return r.result;
    }
    return '';
  } catch (e) {
    return '';
  }
}

async function waitForXPathText(tabId, xpath, timeoutMs = 10000) {
  const startTime = Date.now();
  const intervalMs = 500;
  let lastText = '';
  while (Date.now() - startTime < timeoutMs) {
    const text = await getXPathText(tabId, xpath);
    if (text) return text;
    lastText = text;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return lastText;
}

async function triggerMonitorNotify(tabId, ts) {
  if (!ts.voiceNotifyEnabled && !ts.popupNotifyEnabled) return;

  let notified = false;
  if (ts.popupNotifyEnabled) {
    notified = await createMonitorSystemNotification(tabId, ts);
  }

  if (ts.voiceNotifyEnabled) {
    // Voice playback still needs the target page, but popup notification is handled globally above.
    try {
      const resp = await chrome.tabs.sendMessage(tabId, {
        type: 'MONITOR_NOTIFY',
        voice: true,
        popup: false,
      });
      if (resp && resp.ok) notified = true;
    } catch (e) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: false },
          files: ['content.js'],
        });
        await chrome.tabs.sendMessage(tabId, {
          type: 'MONITOR_NOTIFY',
          voice: true,
          popup: false,
        });
        notified = true;
      } catch (e2) {
        // System popup notification has already been attempted above.
      }
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
      title = tab?.url || '';
    } catch (e) { /* ignore */ }

    const notificationId = `monitor-${tabId}-${Date.now()}`;
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title || '监控页面',
      message: ts.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE,
      priority: 2,
    });
    setTimeout(() => {
      chrome.notifications.clear(notificationId).catch(() => {});
    }, 3000);
    return true;
  } catch (e) {
    return false;
  }
}

async function executeTick(tabId) {
  const ts = tabStates.get(tabId);
  if (!ts) return;

  // Prevent re-entrant calls (setTimeout + alarm race)
  if (ts.ticking) return;
  ts.ticking = true;

  // Check max count limit
  if (ts.maxCount > 0 && ts.refreshCount >= ts.maxCount) {
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
      // Full page refresh
      // If monitor enabled, save current value before reload
      if (ts.monitorEnabled && ts.monitorXpath) {
        ts.monitorLastValue = await getXPathText(tabId, ts.monitorXpath);
      }

      ts.waitingForLoad = true;
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
      // If monitor enabled, save current value before click
      if (ts.monitorEnabled && ts.monitorXpath) {
        ts.monitorLastValue = await getXPathText(tabId, ts.monitorXpath);
      }

      // XPath click mode - send message to content script in target frame.
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'EXECUTE_XPATH_CLICK',
          xpath: ts.xpath,
          targetFrame: ts.targetFrame,
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
            targetFrame: ts.targetFrame,
          });
        } catch (e2) {
          throw new Error(`XPath 点击执行失败: ${e2.message}`);
        }
      }

      ts.refreshCount++;
      ts.nextTick = Date.now() + ts.interval * 1000;
      scheduleNextTick(tabId);

      // For xpath mode, check monitor change after click with retry
      if (ts.monitorEnabled && ts.monitorXpath) {
        setTimeout(async () => {
          const newValue = await waitForXPathText(tabId, ts.monitorXpath, 10000);
          if (newValue && newValue !== ts.monitorLastValue) {
            await triggerMonitorNotify(tabId, ts);
          }
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
          const newValue = await waitForXPathText(tabId, ts.monitorXpath, 10000);
          if (newValue && newValue !== ts.monitorLastValue) {
            await triggerMonitorNotify(tabId, ts);
          }
        }, 500);
      }

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
