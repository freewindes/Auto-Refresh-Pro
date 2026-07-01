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
      const activeTabId = getActiveTabId();
      if (!activeTabId) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      startTimer(activeTabId, msg);
      sendResponse({ ok: true });
      break;
    }

    case 'STOP': {
      const activeTabId = getActiveTabId();
      if (activeTabId) {
        stopTimer(activeTabId);
      }
      sendResponse({ ok: true });
      break;
    }

    case 'GET_STATUS': {
      const activeTabId = getActiveTabId();
      if (activeTabId && tabStates.has(activeTabId)) {
        const ts = tabStates.get(activeTabId);
        sendResponse({
          running: true,
          remaining: Math.ceil((ts.nextTick - Date.now()) / 1000),
          refreshCount: ts.refreshCount,
          interval: ts.interval,
          mode: ts.mode,
        });
      } else {
        sendResponse({ running: false });
      }
      break;
    }

    case 'UPDATE_INTERVAL': {
      const activeTabId = getActiveTabId();
      if (activeTabId && tabStates.has(activeTabId)) {
        const ts = tabStates.get(activeTabId);
        ts.interval = msg.interval;
        ts.nextTick = Date.now() + msg.interval * 1000;
        restartInterval(activeTabId);
      }
      sendResponse({ ok: true });
      break;
    }

    // Content script sends this when xpath is picked
    case 'XPATH_PICKED': {
      // Forward to popup
      chrome.runtime.sendMessage({
        type: 'XPATH_PICKED',
        xpath: msg.xpath,
      }).catch(() => {});
      break;
    }
  }

  return true; // Keep message channel open for async sendResponse
});

// ===== Timer Management =====
function startTimer(tabId, config) {
  // Stop existing timer if any
  stopTimer(tabId);

  const ts = {
    tabId,
    interval: config.interval,
    mode: config.mode,
    xpath: config.xpath || '',
    targetFrame: config.targetFrame || 'top',
    refreshCount: 0,
    nextTick: Date.now() + config.interval * 1000,
    timerId: null,
  };

  tabStates.set(tabId, ts);
  scheduleNextTick(tabId);

  // Save running state
  chrome.storage.local.set({ running: true });
}

function stopTimer(tabId) {
  const ts = tabStates.get(tabId);
  if (ts) {
    if (ts.timerId) {
      clearTimeout(ts.timerId);
    }
    tabStates.delete(tabId);
  }
  chrome.storage.local.set({ running: false });
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

  try {
    if (ts.mode === 'full') {
      // Full page refresh
      await chrome.tabs.reload(tabId);
      ts.refreshCount++;

      // After reload, we need to re-schedule since content script will be re-injected
      // We store state and let the content script notify us when page is ready
      // For now, schedule next tick
      ts.nextTick = Date.now() + ts.interval * 1000;
      scheduleNextTick(tabId);

      // Notify popup
      chrome.runtime.sendMessage({
        type: 'REFRESH_DONE',
        count: ts.refreshCount,
        mode: 'full',
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
}

// ===== Tab Lifecycle =====
chrome.tabs.onRemoved.addListener((tabId) => {
  stopTimer(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && tabStates.has(tabId)) {
    // Page reloaded - reschedule timer
    const ts = tabStates.get(tabId);
    if (ts && ts.mode === 'full') {
      ts.nextTick = Date.now() + ts.interval * 1000;
      scheduleNextTick(tabId);
    }
  }
});

// ===== Helpers =====
function getActiveTabId() {
  // We use a synchronous approach - the popup sends the active tab context
  // For simplicity, we track the most recently active tab
  return currentActiveTabId;
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
