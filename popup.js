/**
 * Auto Refresh Pro - Popup Script
 * Controls the extension UI and communicates with background/content scripts
 */

// DOM Elements
const els = {
  statusBadge: document.getElementById('statusBadge'),
  statusText: document.querySelector('.status-text'),
  timerCount: document.getElementById('timerCount'),
  ringProgress: document.getElementById('ringProgress'),
  refreshCount: document.getElementById('refreshCount'),
  intervalInput: document.getElementById('intervalInput'),
  decreaseBtn: document.getElementById('decreaseBtn'),
  increaseBtn: document.getElementById('increaseBtn'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  modeTabs: document.querySelectorAll('.mode-tab'),
  xpathSection: document.getElementById('xpathSection'),
  xpathInput: document.getElementById('xpathInput'),
  pickXpathBtn: document.getElementById('pickXpathBtn'),
  xpathHint: document.getElementById('xpathHint'),
  monitorToggle: document.getElementById('monitorToggle'),
  monitorContent: document.getElementById('monitorContent'),
  monitorXpathInput: document.getElementById('monitorXpathInput'),
  pickMonitorXpathBtn: document.getElementById('pickMonitorXpathBtn'),
  monitorXpathHint: document.getElementById('monitorXpathHint'),
  voiceNotifyToggle: document.getElementById('voiceNotifyToggle'),
  popupNotifyToggle: document.getElementById('popupNotifyToggle'),
  monitorNotifyMessageInput: document.getElementById('monitorNotifyMessageInput'),
  floatWindowToggle: document.getElementById('floatWindowToggle'),
  logList: document.getElementById('logList'),
  sitesList: document.getElementById('sitesList'),
  sitesTab: document.getElementById('sitesTab'),
  monitorTab: document.getElementById('monitorTab'),
  sitesTabBtn: document.querySelector('[data-tab="sites"]'),
  presetBtns: document.querySelectorAll('.preset-btn'),
  maxCountInput: document.getElementById('maxCountInput'),
  tabBtns: document.querySelectorAll('.tab-btn'),
  intervalTab: document.getElementById('intervalTab'),
  logTab: document.getElementById('logTab'),
};

// State
let state = {
  running: false,
  interval: 60,
  mode: 'full',
  xpath: '',
  targetFrame: 'top',
  refreshCount: 0,
  remaining: 60,
  picking: false,
  pickingClick: false,
  pickingMonitor: false,
  pickingFor: 'click', // 'click' or 'monitor'
  maxCount: 0,
  tabId: null,
  monitorEnabled: false,
  monitorXpath: '',
  voiceNotifyEnabled: false,
  popupNotifyEnabled: false,
  monitorNotifyMessage: '',
  floatWindowEnabled: false,
};

// Constants
const RING_CIRCUMFERENCE = 2 * Math.PI * 54;
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

// ===== Initialization =====
async function init() {
  await loadState();
  bindEvents();
  updateUI();
  syncFloatWindowForCurrentTab();
  startCountdownSync();
}

async function loadState() {
  try {
    const result = await chrome.storage.local.get([
      'interval', 'mode', 'xpathCache', 'targetFrame', 'maxCount', 'pendingXpathPick',
      'pendingClickXpathPick', 'pendingMonitorXpathPick',
      'monitorEnabled', 'monitorXpath', 'voiceNotifyEnabled', 'popupNotifyEnabled',
      'floatWindowEnabled', 'monitorXpathCache', 'monitorNotifyMessageCache', 'floatWindowCache'
    ]);
    state.interval = result.interval || 60;
    state.mode = result.mode || 'full';
    state.targetFrame = result.targetFrame || 'top';
    state.running = false;
    state.refreshCount = 0;
    state.maxCount = result.maxCount || 0;
    state.remaining = state.interval;
    state.monitorEnabled = result.monitorEnabled || false;
    state.monitorXpath = '';
    state.voiceNotifyEnabled = result.voiceNotifyEnabled || false;
    state.popupNotifyEnabled = result.popupNotifyEnabled || false;
    state.monitorNotifyMessage = DEFAULT_MONITOR_NOTIFY_MESSAGE;
    state.floatWindowEnabled = false;

    // Resolve current tab's origin for per-site xpath cache
    const xpathCache = result.xpathCache || {};
    const monitorXpathCache = result.monitorXpathCache || {};
    const monitorNotifyMessageCache = result.monitorNotifyMessageCache || {};
    const floatWindowCache = result.floatWindowCache || {};
    let origin = '';
    let pageKey = '';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        state.tabId = tab.id || null;
      }
      if (tab && tab.url) {
        origin = new URL(tab.url).origin;
        pageKey = getUrlCacheKey(tab.url);
      }
    } catch (e) { /* ignore */ }

    // STEP 1: Get running status from background first
    const statusResult = await chrome.runtime.sendMessage({ type: 'GET_STATUS', tabId: state.tabId });
    if (statusResult && statusResult.running) {
      state.running = true;
      if (statusResult.remaining !== undefined) state.remaining = statusResult.remaining;
      if (statusResult.refreshCount !== undefined) state.refreshCount = statusResult.refreshCount;
      if (statusResult.interval !== undefined) state.interval = statusResult.interval;
      if (statusResult.mode !== undefined) state.mode = statusResult.mode;
      if (statusResult.xpath !== undefined) state.xpath = statusResult.xpath;
      if (statusResult.targetFrame !== undefined) state.targetFrame = statusResult.targetFrame;
      if (statusResult.maxCount !== undefined) state.maxCount = statusResult.maxCount;
      if (statusResult.monitorEnabled !== undefined) state.monitorEnabled = statusResult.monitorEnabled;
      if (statusResult.monitorXpath !== undefined) state.monitorXpath = statusResult.monitorXpath;
      if (statusResult.voiceNotifyEnabled !== undefined) state.voiceNotifyEnabled = statusResult.voiceNotifyEnabled;
      if (statusResult.popupNotifyEnabled !== undefined) state.popupNotifyEnabled = statusResult.popupNotifyEnabled;
      if (statusResult.monitorNotifyMessage !== undefined) state.monitorNotifyMessage = statusResult.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE;
      if (statusResult.floatWindowEnabled !== undefined) state.floatWindowEnabled = statusResult.floatWindowEnabled;
    } else {
      state.running = false;
      state.refreshCount = 0;
    }

    // STEP 2: Process pendingXpathPick LAST so it takes precedence over background status
    // Handle click xpath pick (new independent key)
    if (result.pendingClickXpathPick && result.pendingClickXpathPick.xpath) {
      const pick = result.pendingClickXpathPick;
      if (Date.now() - pick.timestamp < 30000) {
        const pickOrigin = pick.origin || origin;
        xpathCache[pickOrigin] = pick.xpath;
        await chrome.storage.local.set({ xpathCache });

        state.xpath = pick.xpath;
        state.mode = 'xpath';
        if (pick.frameIndex && pick.frameIndex !== 'top') {
          state.targetFrame = pick.frameIndex;
        }
        addLog(`已选取点击目标 XPath: ${pick.xpath}`, 'info');
      }
      chrome.storage.local.remove('pendingClickXpathPick').catch(() => {});
    }

    // Handle monitor xpath pick (new independent key)
    if (result.pendingMonitorXpathPick && result.pendingMonitorXpathPick.xpath) {
      const pick = result.pendingMonitorXpathPick;
      if (Date.now() - pick.timestamp < 30000) {
        const pickPageKey = pick.urlKey || pageKey;
        if (pickPageKey) {
          monitorXpathCache[pickPageKey] = pick.xpath;
          await chrome.storage.local.set({ monitorXpathCache });
        }
        state.monitorXpath = pick.xpath;
        state.monitorEnabled = true;
        addLog(`已选取监控区域 XPath: ${pick.xpath}`, 'info');
      }
      chrome.storage.local.remove('pendingMonitorXpathPick').catch(() => {});
    }

    // Handle legacy pendingXpathPick for backward compatibility
    if (result.pendingXpathPick && result.pendingXpathPick.xpath) {
      const pick = result.pendingXpathPick;
      if (Date.now() - pick.timestamp < 30000) {
        const pickFor = pick.pickingFor || 'click';
        if (pickFor === 'monitor') {
          if (!state.monitorXpath) {
            const pickPageKey = pick.urlKey || pageKey;
            if (pickPageKey) {
              monitorXpathCache[pickPageKey] = pick.xpath;
              await chrome.storage.local.set({ monitorXpathCache });
            }
            state.monitorXpath = pick.xpath;
            state.monitorEnabled = true;
            addLog(`已选取监控区域 XPath: ${pick.xpath}`, 'info');
          }
        } else {
          if (!state.xpath) {
            const pickOrigin = pick.origin || origin;
            xpathCache[pickOrigin] = pick.xpath;
            await chrome.storage.local.set({ xpathCache });

            state.xpath = pick.xpath;
            state.mode = 'xpath';
            if (pick.frameIndex && pick.frameIndex !== 'top') {
              state.targetFrame = pick.frameIndex;
            }
            addLog(`已选取点击目标 XPath: ${pick.xpath}`, 'info');
          }
        }
      }
      chrome.storage.local.remove('pendingXpathPick').catch(() => {});
    } else if (origin && !state.xpath) {
      const cachedXpath = xpathCache[origin];
      state.xpath = cachedXpath && cachedXpath !== '__full__' ? cachedXpath : '';
      if (!state.xpath && state.mode === 'xpath') {
        state.mode = 'full';
      }
    }

    if (!state.running && pageKey && !state.monitorXpath) {
      state.monitorXpath = monitorXpathCache[pageKey] || '';
    }
    if (!state.running && pageKey) {
      state.monitorNotifyMessage = monitorNotifyMessageCache[pageKey] || DEFAULT_MONITOR_NOTIFY_MESSAGE;
    }
    if (!state.running) {
      state.floatWindowEnabled = pageKey
        ? !!floatWindowCache[pageKey]
        : !!result.floatWindowEnabled;
    }
  } catch (e) {
    console.error('Failed to load state:', e);
  }
}

async function saveState() {
  try {
    let origin = '';
    let pageKey = '';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) state.tabId = tab.id || state.tabId;
      if (tab && tab.url) {
        origin = new URL(tab.url).origin;
        pageKey = getUrlCacheKey(tab.url);
      }
    } catch (e) { /* ignore */ }

    const storageResult = await chrome.storage.local.get(['xpathCache', 'monitorXpathCache', 'monitorNotifyMessageCache', 'floatWindowCache']);
    const xpathCache = storageResult.xpathCache || {};
    const monitorXpathCache = storageResult.monitorXpathCache || {};
    const monitorNotifyMessageCache = storageResult.monitorNotifyMessageCache || {};
    const floatWindowCache = storageResult.floatWindowCache || {};
    if (origin) {
      if (state.mode === 'full') {
        xpathCache[origin] = '__full__';
      } else if (state.xpath) {
        xpathCache[origin] = state.xpath;
      }
    }
    if (pageKey) {
      if (state.monitorXpath) {
        monitorXpathCache[pageKey] = state.monitorXpath;
      } else {
        delete monitorXpathCache[pageKey];
      }
      const notifyMessage = (state.monitorNotifyMessage || '').trim();
      if (notifyMessage && notifyMessage !== DEFAULT_MONITOR_NOTIFY_MESSAGE) {
        monitorNotifyMessageCache[pageKey] = notifyMessage;
      } else {
        delete monitorNotifyMessageCache[pageKey];
      }
      floatWindowCache[pageKey] = !!state.floatWindowEnabled;
    }

    await chrome.storage.local.set({
      interval: state.interval,
      mode: state.mode,
      xpathCache,
      monitorXpathCache,
      monitorNotifyMessageCache,
      floatWindowCache,
      targetFrame: state.targetFrame,
      maxCount: state.maxCount,
      monitorEnabled: state.monitorEnabled,
      monitorXpath: state.monitorXpath,
      voiceNotifyEnabled: state.voiceNotifyEnabled,
      popupNotifyEnabled: state.popupNotifyEnabled,
      floatWindowEnabled: state.floatWindowEnabled,
    });
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

function syncFloatWindowForCurrentTab() {
  if (!state.tabId) return;
  chrome.runtime.sendMessage({
    type: 'UPDATE_FLOAT_WINDOW',
    tabId: state.tabId,
    floatWindowEnabled: state.floatWindowEnabled,
    interval: state.interval,
  }).catch(() => {});
}

function getMonitorNotifyMessage() {
  const raw = els.monitorNotifyMessageInput
    ? els.monitorNotifyMessageInput.value
    : state.monitorNotifyMessage;
  return (raw || '').trim() || DEFAULT_MONITOR_NOTIFY_MESSAGE;
}

function sendNotifyUpdate() {
  if (!state.running) return;
  chrome.runtime.sendMessage({
    type: 'UPDATE_NOTIFY',
    tabId: state.tabId,
    voiceNotifyEnabled: state.voiceNotifyEnabled,
    popupNotifyEnabled: state.popupNotifyEnabled,
    monitorNotifyMessage: state.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE,
  });
}

function updateNotifyMessageEditor() {
  const enabled = !!state.popupNotifyEnabled;
  els.monitorNotifyMessageInput.disabled = !enabled;
  const field = els.monitorNotifyMessageInput.closest('.notify-message-field');
  if (field) field.classList.toggle('disabled', !enabled);
}

// ===== Event Binding =====
function bindEvents() {
  els.intervalInput.addEventListener('change', handleIntervalChange);
  els.decreaseBtn.addEventListener('click', () => adjustInterval(-1));
  els.increaseBtn.addEventListener('click', () => adjustInterval(1));

  els.presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.value, 10);
      state.interval = val;
      els.intervalInput.value = val;
      updatePresetHighlight(val);
      handleIntervalChange();
    });
  });

  els.maxCountInput.addEventListener('change', handleMaxCountChange);

  els.modeTabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      const newMode = tab.dataset.mode;
      if (newMode === state.mode) return;

      state.mode = newMode;
      els.modeTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      els.xpathSection.classList.toggle('hidden', state.mode !== 'xpath');
      saveState();

      if (state.running) {
        if (state.mode === 'xpath' && !state.xpath) {
          addLog('切换到 XPath 模式需要先选取表达式', 'error');
          return;
        }
        chrome.runtime.sendMessage({
          type: 'UPDATE_MODE',
          tabId: state.tabId,
          mode: state.mode,
          xpath: state.xpath,
          targetFrame: state.targetFrame,
          monitorXpath: state.monitorXpath,
        });
        const modeLabel = state.mode === 'full' ? '全页刷新' : 'XPath 点击';
        addLog(`模式已热切换为: ${modeLabel}`, 'info');
        state.remaining = state.interval;
        updateTimerDisplay();
      }

      // Show hint notification when switching to XPath mode with empty expression
      if (state.mode === 'xpath' && !state.xpath) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'SHOW_ERROR_NOTIFICATION',
              title: 'XPath 表达式为空',
              xpath: '',
              message: '请先点击「选取」按钮选择页面元素，或手动输入 XPath 表达式',
            }).catch(() => {});
          }
        } catch (e) { /* ignore */ }
      }
    });
  });

  els.pickXpathBtn.addEventListener('click', () => startXPathPicker('click'));
  els.xpathInput.addEventListener('change', () => {
    state.xpath = els.xpathInput.value.trim();
    saveState();
  });

  els.pickMonitorXpathBtn.addEventListener('click', () => startXPathPicker('monitor'));
  els.monitorXpathInput.addEventListener('change', () => {
    state.monitorXpath = els.monitorXpathInput.value.trim();
    saveState();
  });

  els.monitorToggle.addEventListener('change', () => {
    state.monitorEnabled = els.monitorToggle.checked;
    els.monitorContent.classList.toggle('hidden', !state.monitorEnabled);
    saveState();
    if (state.running) {
      chrome.runtime.sendMessage({
        type: 'UPDATE_MONITOR',
        tabId: state.tabId,
        monitorEnabled: state.monitorEnabled,
        monitorXpath: state.monitorXpath,
        monitorNotifyMessage: state.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE,
      });
      addLog(state.monitorEnabled ? '监控模式已启用' : '监控模式已关闭', 'info');
    }
  });

  els.voiceNotifyToggle.addEventListener('change', () => {
    state.voiceNotifyEnabled = els.voiceNotifyToggle.checked;
    saveState();
    sendNotifyUpdate();
  });

  els.popupNotifyToggle.addEventListener('change', () => {
    state.popupNotifyEnabled = els.popupNotifyToggle.checked;
    updateNotifyMessageEditor();
    saveState();
    sendNotifyUpdate();
  });

  els.monitorNotifyMessageInput.addEventListener('input', () => {
    state.monitorNotifyMessage = getMonitorNotifyMessage();
    saveState();
    sendNotifyUpdate();
  });

  els.floatWindowToggle.addEventListener('change', () => {
    state.floatWindowEnabled = els.floatWindowToggle.checked;
    saveState();
    syncFloatWindowForCurrentTab();
    addLog(state.floatWindowEnabled ? '悬浮窗已启用' : '悬浮窗已关闭', 'info');
  });

  els.startBtn.addEventListener('click', startRefresh);
  els.stopBtn.addEventListener('click', stopRefresh);

  els.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });
}

// ===== Tab Switching =====
function switchTab(tabName) {
  els.tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  els.intervalTab.classList.toggle('hidden', tabName !== 'interval');
  els.monitorTab.classList.toggle('hidden', tabName !== 'monitor');
  els.sitesTab.classList.toggle('hidden', tabName !== 'sites');
  els.logTab.classList.toggle('hidden', tabName !== 'log');

  if (tabName === 'sites') loadSites();
}

// ===== Interval Controls =====
function handleIntervalChange() {
  let val = parseInt(els.intervalInput.value, 10);
  if (isNaN(val) || val < 1) val = 1;
  if (val > 86400) val = 86400;
  state.interval = val;
  els.intervalInput.value = val;
  state.remaining = val;
  updatePresetHighlight(val);
  updateTimerDisplay();
  saveState();

  if (state.running) {
    chrome.runtime.sendMessage({
      type: 'UPDATE_INTERVAL',
      tabId: state.tabId,
      interval: state.interval,
    });
    addLog(`间隔已热切换为 ${val} 秒`, 'info');
  }
}

function adjustInterval(delta) {
  let val = parseInt(els.intervalInput.value, 10) || 60;
  val += delta;
  if (val < 1) val = 1;
  if (val > 86400) val = 86400;
  state.interval = val;
  els.intervalInput.value = val;
  state.remaining = val;
  updatePresetHighlight(val);
  updateTimerDisplay();
  saveState();

  if (state.running) {
    chrome.runtime.sendMessage({
      type: 'UPDATE_INTERVAL',
      tabId: state.tabId,
      interval: state.interval,
    });
    addLog(`间隔已热切换为 ${val} 秒`, 'info');
  }
}

// ===== Max Count Controls =====
function handleMaxCountChange() {
  let val = parseInt(els.maxCountInput.value, 10);
  if (isNaN(val) || val < 0) val = 0;
  if (val > 99999) val = 99999;
  state.maxCount = val;
  els.maxCountInput.value = val;
  saveState();

  if (state.running) {
    chrome.runtime.sendMessage({
      type: 'UPDATE_MAX_COUNT',
      tabId: state.tabId,
      maxCount: state.maxCount,
    });
    addLog(`刷新次数上限设为 ${val === 0 ? '无限制' : val}`, 'info');
  }
}

function updatePresetHighlight(val) {
  els.presetBtns.forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.value, 10) === val);
  });
}

// ===== XPath Picker =====
async function startXPathPicker(forMode) {
  const isClickMode = forMode === 'click';
  const btnEl = isClickMode ? els.pickXpathBtn : els.pickMonitorXpathBtn;
  const hintEl = isClickMode ? els.xpathHint : els.monitorXpathHint;

  if (isClickMode ? state.pickingClick : state.pickingMonitor) {
    if (isClickMode) {
      state.pickingClick = false;
    } else {
      state.pickingMonitor = false;
    }
    btnEl.classList.remove('picking');
    btnEl.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
      </svg>选取`;
    hintEl.textContent = '已取消选取';
    hintEl.classList.remove('active');
    await saveState();

    chrome.runtime.sendMessage({ type: 'STOP_PICKER', tabId: state.tabId });
    return;
  }

  if (isClickMode) {
    state.pickingClick = true;
  } else {
    state.pickingMonitor = true;
  }
  state.pickingFor = forMode;

  btnEl.classList.add('picking');
  btnEl.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>取消`;
  hintEl.textContent = isClickMode ? '点击页面上的元素作为点击目标...' : '点击页面上的元素作为监控区域...';
  hintEl.classList.add('active');
  await saveState();

  await chrome.storage.local.remove(['pendingXpathPick', 'pendingClickXpathPick', 'pendingMonitorXpathPick']);
  chrome.runtime.sendMessage({ type: 'START_PICKER', tabId: state.tabId, pickingFor: forMode });
  await chrome.storage.local.set({ pickingRequested: Date.now(), pickingFor: forMode });
  window.close();
}

// ===== Start / Stop =====
async function showPageErrorNotification(title, message, xpath = '') {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_ERROR_NOTIFICATION',
        title,
        xpath,
        message,
      }).catch(() => {});
    }
  } catch (e) { /* ignore */ }
}

async function startRefresh() {
  if (state.mode === 'xpath' && !state.xpath) {
    addLog('请先输入或选取 XPath 表达式', 'error');
    await showPageErrorNotification(
      'XPath 表达式为空',
      '请先点击「选取」按钮选择页面元素，或手动输入 XPath 表达式'
    );
    return;
  }

  if (state.monitorEnabled && !state.monitorXpath) {
    addLog('监控模式已启用但未设置监控区域 XPath', 'error');
    await showPageErrorNotification(
      '监控 XPath 为空',
      '监控变化已开启，请先点击「选取」按钮选择监控区域，或手动输入监控区域 XPath'
    );
    return;
  }

  state.running = true;
  state.remaining = state.interval;
  state.refreshCount = 0;
  await saveState();

  await chrome.runtime.sendMessage({
    type: 'START',
    tabId: state.tabId,
    interval: state.interval,
    mode: state.mode,
    xpath: state.xpath,
    targetFrame: state.targetFrame,
    maxCount: state.maxCount,
    monitorEnabled: state.monitorEnabled,
    monitorXpath: state.monitorXpath,
    voiceNotifyEnabled: state.voiceNotifyEnabled,
    popupNotifyEnabled: state.popupNotifyEnabled,
    monitorNotifyMessage: state.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE,
    floatWindowEnabled: state.floatWindowEnabled,
  });

  const countText = state.maxCount > 0 ? `, 上限 ${state.maxCount} 次` : ', 无限制';
  const monitorText = state.monitorEnabled ? ', 监控模式已开启' : '';
  addLog(`已启动 - 间隔 ${state.interval} 秒, 模式: ${state.mode === 'full' ? '全页刷新' : 'XPath点击'}${countText}${monitorText}`, 'success');
  updateUI();
  loadSites();
}

async function stopRefresh() {
  state.running = false;
  state.remaining = state.interval;
  await saveState();

  await chrome.runtime.sendMessage({ type: 'STOP', tabId: state.tabId });

  addLog('已停止刷新', 'info');
  updateUI();
  loadSites();
}

// ===== Countdown Sync (popup-side, no background dependency) =====
function startCountdownSync() {
  const localTick = () => {
    if (!state.running) return;
    if (state.remaining === -1) {
      // Waiting for page load — don't tick
      return;
    }
    state.remaining = Math.max(0, state.remaining - 1);
    updateTimerDisplay();
  };

  // Local countdown tick every second
  setInterval(localTick, 1000);

  // Periodically sync refreshCount + sites badge from background (every 3s)
  setInterval(async () => {
    if (state.running) {
      try {
        const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS', tabId: state.tabId });
        if (status && status.running) {
          state.refreshCount = status.refreshCount || state.refreshCount;
          els.refreshCount.textContent = state.refreshCount;
        }
      } catch (e) {
        // Background may be asleep — local countdown still works
      }
    }
    // Always refresh sites badge (even when stopped, to catch tab closures)
    refreshSitesBadge().catch(() => {});
  }, 3000);
}

// Listen for refresh events from background
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === 'ACTIVE_SITES_CHANGED') {
    await loadSites();
    return;
  }

  // Filter: only handle events for the current active tab
  if (msg.type === 'REFRESH_DONE' || msg.type === 'PAGE_LOADED' || msg.type === 'REFRESH_ERROR') {
    let currentTabId = null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) currentTabId = tab.id;
    } catch (e) { /* ignore */ }
    if (msg.tabId && currentTabId && msg.tabId !== currentTabId) {
      // Event from a different tab — ignore
      return;
    }
  }
  if (msg.type === 'REFRESH_DONE') {
    state.refreshCount = msg.count;
    els.refreshCount.textContent = state.refreshCount;

    if (msg.waitingForLoad) {
      state.remaining = -1;
      els.timerCount.textContent = '...';
      els.ringProgress.style.strokeDashoffset = RING_CIRCUMFERENCE;
    } else {
      state.remaining = state.interval;
      updateTimerDisplay();
    }
    saveState();

    if (state.maxCount > 0 && state.refreshCount >= state.maxCount) {
      addLog(`已达到刷新上限 ${state.maxCount} 次，自动停止`, 'info');
      stopRefresh();
    }
    // Always refresh sites list when refresh events fire (may come from other tabs too)
    loadSites();
  } else if (msg.type === 'PAGE_LOADED') {
    // Only log first page load completion
    if (msg.count === 1) {
      addLog('页面加载完成，倒计时重新开始', 'success');
    }
    state.remaining = state.interval;
    updateTimerDisplay();
    loadSites();
  } else if (msg.type === 'REFRESH_ERROR') {
    addLog(`执行失败: ${msg.error}`, 'error');
  } else if (msg.type === 'XPATH_PICKED') {
    const pickFor = msg.pickingFor || state.pickingFor || 'click';
    const isClickMode = pickFor === 'click';

    if (isClickMode) {
      state.pickingClick = false;
    } else {
      state.pickingMonitor = false;
    }

    const btnEl = isClickMode ? els.pickXpathBtn : els.pickMonitorXpathBtn;
    const hintEl = isClickMode ? els.xpathHint : els.monitorXpathHint;

    btnEl.classList.remove('picking');
    btnEl.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
      </svg>选取`;

    if (msg.cancelled) {
      hintEl.textContent = '已取消选取';
      hintEl.classList.remove('active');
      addLog('已取消 XPath 选取', 'info');
    } else {
      hintEl.textContent = isClickMode ? '已选取元素' : '已选取监控区域';
      hintEl.classList.remove('active');

      if (isClickMode) {
        state.xpath = msg.xpath;
        els.xpathInput.value = msg.xpath;

        const frameIndex = msg.frameIndex;
        if (frameIndex && frameIndex !== 'top') {
          state.targetFrame = frameIndex;
          addLog(`已自动选择 iframe #${parseInt(frameIndex, 10) + 1} 作为目标框架`, 'info');
        } else {
          state.targetFrame = 'top';
        }

        if (state.running) {
          setTimeout(() => {
            state.mode = 'xpath';
            els.modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === 'xpath'));
            els.xpathSection.classList.remove('hidden');
            chrome.runtime.sendMessage({
              type: 'UPDATE_MODE',
              tabId: state.tabId,
              mode: 'xpath',
              xpath: state.xpath,
              targetFrame: state.targetFrame,
              monitorXpath: state.monitorXpath,
            });
            state.remaining = state.interval;
            updateTimerDisplay();
            addLog('已自动切换到 XPath 点击模式', 'info');
            saveState();
          }, 300);
        }
      } else {
        state.monitorXpath = msg.xpath;
        els.monitorXpathInput.value = msg.xpath;
        if (state.running) {
          chrome.runtime.sendMessage({
            type: 'UPDATE_MONITOR',
            tabId: state.tabId,
            monitorEnabled: state.monitorEnabled,
            monitorXpath: state.monitorXpath,
          });
        }
      }

      saveState();
      addLog(`已选取 XPath: ${msg.xpath}`, 'info');
    }
  } else if (msg.type === 'MONITOR_CHANGED') {
    const notifyTypes = [];
    if (msg.voice) notifyTypes.push('语音');
    if (msg.popup) notifyTypes.push('弹窗');
    const notifyText = notifyTypes.length > 0 ? ` (${notifyTypes.join('+')}通告)` : '';
    addLog(`监控区域发生变化${notifyText}`, 'success');
  }
});

// ===== UI Updates =====
function updateUI() {
  els.statusBadge.classList.toggle('running', state.running);
  els.statusText.textContent = state.running ? '运行中' : '已停止';

  els.startBtn.classList.toggle('hidden', state.running);
  els.stopBtn.classList.toggle('hidden', !state.running);

  els.modeTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === state.mode);
  });
  els.xpathSection.classList.toggle('hidden', state.mode !== 'xpath');

  els.intervalInput.value = state.interval;
  updatePresetHighlight(state.interval);

  els.maxCountInput.value = state.maxCount;

  els.xpathInput.value = state.xpath;
  // Fix: update xpathHint based on whether xpath is set
  if (state.xpath && !state.pickingClick) {
    els.xpathHint.textContent = '已选取元素';
    els.xpathHint.classList.remove('active');
  } else if (!state.pickingClick) {
    els.xpathHint.textContent = '点击"选取"后在页面上点击目标元素';
  }
  // Fix: restore pick button state for click xpath (only if not currently picking)
  if (!state.pickingClick) {
    els.pickXpathBtn.classList.remove('picking');
    els.pickXpathBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
      </svg>选取`;
  }

  els.refreshCount.textContent = state.refreshCount;

  // Monitor section
  els.monitorToggle.checked = state.monitorEnabled;
  els.monitorContent.classList.toggle('hidden', !state.monitorEnabled);
  els.monitorXpathInput.value = state.monitorXpath;
  if (state.monitorXpath && !state.pickingMonitor) {
    els.monitorXpathHint.textContent = '已选取监控区域';
    els.monitorXpathHint.classList.remove('active');
  } else if (!state.pickingMonitor) {
    els.monitorXpathHint.textContent = '点击"选取"后在页面上选择监控区域';
  }
  // Fix: restore pick button state for monitor xpath (only if not currently picking)
  if (!state.pickingMonitor) {
    els.pickMonitorXpathBtn.classList.remove('picking');
    els.pickMonitorXpathBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
      </svg>选取`;
  }

  els.voiceNotifyToggle.checked = state.voiceNotifyEnabled;
  els.popupNotifyToggle.checked = state.popupNotifyEnabled;
  els.monitorNotifyMessageInput.value = state.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE;
  updateNotifyMessageEditor();

  // Floating window toggle
  els.floatWindowToggle.checked = state.floatWindowEnabled;

  updateTimerDisplay();
  updateLogTimer();
}

function updateTimerDisplay() {
  const displayText = state.remaining === -1 ? '...' : state.remaining;
  els.timerCount.textContent = displayText;

  const safeRemaining = state.remaining === -1 ? state.interval : Math.max(0, state.remaining);
  const progress = state.running
    ? (safeRemaining / state.interval) * RING_CIRCUMFERENCE
    : RING_CIRCUMFERENCE;
  els.ringProgress.style.strokeDasharray = RING_CIRCUMFERENCE;
  els.ringProgress.style.strokeDashoffset = RING_CIRCUMFERENCE - progress;
  updateLogTimer();
}

function updateLogTimer() {
  const timerEl = document.getElementById('logTimer');
  if (!timerEl) return;

  timerEl.classList.toggle('hidden', !state.running);
  const countEl = timerEl.querySelector('.log-timer-count');
  if (countEl) {
    countEl.textContent = state.running
      ? (state.remaining === -1 ? '...' : state.remaining)
      : '--';
  }
}

// ===== Logging =====
function addLog(message, type = 'info') {
  const empty = els.logList.querySelector('.log-empty');
  if (empty) empty.remove();

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const item = document.createElement('div');
  item.className = `log-item ${type}`;
  item.innerHTML = `
    <span class="log-time">${timeStr}</span>
    <span class="log-msg">${message}</span>
  `;

  els.logList.prepend(item);

  while (els.logList.children.length > 50) {
    els.logList.lastChild.remove();
  }
}

// ===== Sites Management =====
// Now shows ACTIVE refresh sessions (from background tabStates), not persistent xpathCache
async function loadSites() {
  try {
    // Fetch currently ACTIVE refresh sessions from background
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_SITES' });
    const sites = response?.sites || [];
    const count = sites.length;

    // Update badge on tab button
    if (els.sitesTabBtn) {
      els.sitesTabBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>标签 <span class="sites-tab-badge">' + count + '</span>';
    }

    renderSitesList(sites);
  } catch (e) {
    console.error('Failed to load sites:', e);
    els.sitesList.innerHTML = '<div class="sites-empty">加载失败<br><span>请重试</span></div>';
  }
}

function renderSitesList(sites) {
  if (sites.length === 0) {
    els.sitesList.innerHTML = '<div class="sites-empty">暂无正在刷新的标签<br><span>启动刷新后自动显示当前网站</span></div>';
    return;
  }

  els.sitesList.innerHTML = '';
  sites.forEach((site) => {
    const modeLabel = site.mode === 'full' ? '全页刷新' : 'XPath 点击';
    const modeTagClass = site.mode === 'full' ? 'site-mode-tag full' : 'site-mode-tag xpath';
    const urlDisplay = site.url || '(标签已关闭)';
    const titleDisplay = site.title || '';

    const item = document.createElement('div');
    item.className = 'site-item';
    item.innerHTML = `
      <div class="site-body">
        <div class="site-field">
          <span class="site-field-label">网址</span>
          <span class="site-field-value" title="${escapeHtml(urlDisplay)}">${escapeHtml(truncateUrl(urlDisplay, 30))}</span>
        </div>
        <div class="site-field-row">
          <span class="site-field-label">标题</span>
          <span class="site-field-value site-title" title="${escapeHtml(titleDisplay)}">${escapeHtml(truncateText(titleDisplay, 18))}</span>
        </div>
        <div class="site-field-row site-stats-row">
          <span class="${modeTagClass}">${modeLabel}</span>
          <span class="site-stat">间隔 ${site.interval}s</span>
          <span class="site-stat">已刷新 <span class="site-refresh-count">${site.refreshCount}</span> 次</span>
        </div>
      </div>
      <div class="site-actions">
        <button class="site-action-btn goto-btn" title="跳转到此标签" data-tabid="${site.tabId}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
      </div>
    `;

    item.querySelector('.goto-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.update(parseInt(e.currentTarget.dataset.tabid, 10), { active: true });
      window.close();
    });

    els.sitesList.appendChild(item);
  });
}

function truncateUrl(url, maxLen) {
  if (!url || url.length <= maxLen) return url;
  return url.substring(0, maxLen) + '...';
}

function truncateText(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
}

async function refreshSitesBadge() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_SITES' });
    const count = response?.sites?.length || 0;
    if (els.sitesTabBtn) {
      els.sitesTabBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>标签 <span class="sites-tab-badge">' + count + '</span>';
    }
    // Also refresh the list content if sites tab is currently visible
    if (!els.sitesTab.classList.contains('hidden')) {
      renderSitesList(response?.sites || []);
    }
  } catch (e) { /* ignore */ }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== Init =====
async function boot() {
  await loadState();
  await loadSites();
  bindEvents();
  updateUI();
  startCountdownSync();
}
boot();
