/**
 * Auto Refresh Pro - Background Service Worker
 * Manages timers and communicates between popup and content scripts
 */

// State per tab
const tabStates = new Map();

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
        stopTimer(activeTabId);
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

    case 'UPDATE_MODE': {
      const activeTabId = getTargetTabId(msg, sender);
      if (activeTabId && tabStates.has(activeTabId)) {
        const ts = tabStates.get(activeTabId);
        ts.mode = msg.mode;
        if (msg.xpath !== undefined) ts.xpath = msg.xpath;
        if (msg.targetFrame !== undefined) ts.targetFrame = msg.targetFrame;
        // Reset countdown for new mode
        ts.nextTick = Date.now() + ts.interval * 1000;
        ts.waitingForLoad = false;
        scheduleNextTick(activeTabId);
      }
      sendResponse({ ok: true });
      break;
    }

    // Content script sends this when xpath is picked
    case 'XPATH_PICKED': {
      // Resolve origin from sender tab (no async needed)
      let origin = '';
      try {
        if (sender.tab && sender.tab.url) origin = new URL(sender.tab.url).origin;
      } catch (e) { /* ignore */ }

      // Forward to popup with element info
      chrome.runtime.sendMessage({
        type: 'XPATH_PICKED',
        xpath: msg.xpath,
        tagName: msg.tagName || '',
        textContent: msg.textContent || '',
        cancelled: msg.cancelled || false,
      }).catch(() => {});

      // Persist to storage so popup can pick it up when reopened
      if (msg.xpath && !msg.cancelled) {
        chrome.storage.local.set({
          pendingXpathPick: {
            xpath: msg.xpath,
            tagName: msg.tagName || '',
            textContent: msg.textContent || '',
            origin,
            timestamp: Date.now(),
          }
        });
      } else if (msg.cancelled) {
        chrome.storage.local.remove('pendingXpathPick');
      }

      // Show success notification on webpage (only for pick, not for auto-refresh clicks)
      if (msg.xpath && !msg.cancelled && tabId) {
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
  stopTimer(tabId, false);

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
  };

  tabStates.set(tabId, ts);
  scheduleNextTick(tabId);

  // Save running state
  syncRunningStorage();
  notifyActiveSitesChanged();
}

function stopTimer(tabId, notify = true) {
  const ts = tabStates.get(tabId);
  if (ts) {
    if (ts.timerId) {
      clearTimeout(ts.timerId);
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
      ts.waitingForLoad = true;
      await chrome.tabs.reload(tabId);
      ts.refreshCount++;

      // Don't schedule next tick yet - wait for page to finish loading
      // The tabs.onUpdated listener will schedule it when status === 'complete'

      // Notify popup immediately that refresh was triggered
      chrome.runtime.sendMessage({
        type: 'REFRESH_DONE',
        tabId,
        count: ts.refreshCount,
        mode: 'full',
        waitingForLoad: true,
      }).catch(() => {});

    } else if (ts.mode === 'xpath') {
      // XPath click mode - send message to content script
      await chrome.tabs.sendMessage(tabId, {
        type: 'EXECUTE_XPATH_CLICK',
        xpath: ts.xpath,
        targetFrame: ts.targetFrame,
      });

      ts.refreshCount++;
      ts.nextTick = Date.now() + ts.interval * 1000;
      scheduleNextTick(tabId);

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

    // Continue scheduling even on error
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
