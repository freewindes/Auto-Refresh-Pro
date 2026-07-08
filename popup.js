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
  maxCountToggle: document.getElementById('maxCountToggle'),
  maxCountBody: document.getElementById('maxCountBody'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  modeTabs: document.querySelectorAll('.mode-tab'),
  xpathSection: document.getElementById('xpathSection'),
  xpathInput: document.getElementById('xpathInput'),
  pickXpathBtn: document.getElementById('pickXpathBtn'),
  locateXpathBtn: document.getElementById('locateXpathBtn'),
  xpathHint: document.getElementById('xpathHint'),
  monitorToggle: document.getElementById('monitorToggle'),
  monitorContent: document.getElementById('monitorContent'),
  monitorXpathInput: document.getElementById('monitorXpathInput'),
  pickMonitorXpathBtn: document.getElementById('pickMonitorXpathBtn'),
  locateMonitorXpathBtn: document.getElementById('locateMonitorXpathBtn'),
  monitorXpathHint: document.getElementById('monitorXpathHint'),
  voiceNotifyToggle: document.getElementById('voiceNotifyToggle'),
  voiceNotifyBody: document.getElementById('voiceNotifyBody'),
  voiceNotifyMessageInput: document.getElementById('voiceNotifyMessageInput'),
  popupNotifyToggle: document.getElementById('popupNotifyToggle'),
  popupNotifyBody: document.getElementById('popupNotifyBody'),
  monitorNotifyMessageInput: document.getElementById('monitorNotifyMessageInput'),
  floatWindowToggle: document.getElementById('floatWindowToggle'),
  showTimerToggle: document.getElementById('showTimerToggle'),
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
  monitorTargetFrame: 'top',
  refreshCount: 0,
  remaining: 60,
  picking: false,
  pickingClick: false,
  pickingMonitor: false,
  pickingFor: 'click', // 'click' or 'monitor'
  maxCountEnabled: false,
  maxCount: 0,
  tabId: null,
  monitorEnabled: false,
  monitorXpath: '',
  voiceNotifyEnabled: false,
  voiceNotifyMessage: '',
  popupNotifyEnabled: false,
  monitorNotifyMessage: '',
  floatWindowEnabled: false,
  showTimerEnabled: false,
};

// Constants
const RING_CIRCUMFERENCE = 2 * Math.PI * 54;
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
      'interval', 'mode', 'xpathCache', 'targetFrame', 'maxCountEnabled', 'maxCount', 'maxCountCache', 'pendingXpathPick',
      'pendingClickXpathPick', 'pendingMonitorXpathPick',
      'monitorEnabled', 'monitorXpath', 'voiceNotifyEnabled', 'popupNotifyEnabled',
      'floatWindowEnabled', 'monitorXpathCache', 'voiceNotifyMessageCache', 'monitorNotifyMessageCache', 'floatWindowCache',
      'siteSettingsCache'
    ]);
    const maxCountCache = result.maxCountCache || {};

    state.interval = result.interval || 60;
    state.mode = result.mode || 'full';
    state.targetFrame = result.targetFrame || 'top';
    state.running = false;
    state.refreshCount = 0;
    state.maxCount = result.maxCount !== undefined ? Number(result.maxCount) || 10 : 10;
    state.maxCountEnabled = result.maxCountEnabled !== undefined
      ? !!result.maxCountEnabled
      : false;
    state.remaining = state.interval;
    state.monitorEnabled = result.monitorEnabled || false;
    state.monitorXpath = '';
    state.voiceNotifyEnabled = result.voiceNotifyEnabled || false;
    state.voiceNotifyMessage = DEFAULT_VOICE_NOTIFY_MESSAGE;
    state.popupNotifyEnabled = result.popupNotifyEnabled || false;
    state.monitorNotifyMessage = DEFAULT_MONITOR_NOTIFY_MESSAGE;
    state.floatWindowEnabled = false;

    // Resolve current tab's origin for per-site xpath and max count cache
    const xpathCache = result.xpathCache || {};
    const monitorXpathCache = result.monitorXpathCache || {};
    const voiceNotifyMessageCache = result.voiceNotifyMessageCache || {};
    const monitorNotifyMessageCache = result.monitorNotifyMessageCache || {};
    const floatWindowCache = result.floatWindowCache || {};
    const siteSettingsCache = result.siteSettingsCache || {};
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

    const siteSettings = pageKey ? (siteSettingsCache[pageKey] || {}) : {};
    const cachedXpath = pageKey ? (xpathCache[pageKey] || (origin ? xpathCache[origin] : '')) : '';
    const cachedMaxCount = pageKey
      ? (maxCountCache[pageKey] !== undefined ? maxCountCache[pageKey] : (origin ? maxCountCache[origin] : undefined))
      : undefined;

    if (siteSettings.interval !== undefined) state.interval = Number(siteSettings.interval) || 60;
    if (siteSettings.mode !== undefined) state.mode = siteSettings.mode || 'full';
    if (siteSettings.xpath !== undefined) state.xpath = siteSettings.xpath || '';
    if (siteSettings.targetFrame !== undefined) state.targetFrame = siteSettings.targetFrame || 'top';
    if (siteSettings.monitorEnabled !== undefined) state.monitorEnabled = !!siteSettings.monitorEnabled;
    if (siteSettings.monitorXpath !== undefined) state.monitorXpath = siteSettings.monitorXpath || '';
    if (siteSettings.monitorTargetFrame !== undefined) state.monitorTargetFrame = siteSettings.monitorTargetFrame || 'top';
    if (siteSettings.voiceNotifyEnabled !== undefined) state.voiceNotifyEnabled = !!siteSettings.voiceNotifyEnabled;
    if (siteSettings.voiceNotifyMessage !== undefined) {
      state.voiceNotifyMessage = siteSettings.voiceNotifyMessage || DEFAULT_VOICE_NOTIFY_MESSAGE;
    }
    if (siteSettings.popupNotifyEnabled !== undefined) state.popupNotifyEnabled = !!siteSettings.popupNotifyEnabled;
    if (siteSettings.monitorNotifyMessage !== undefined) {
      state.monitorNotifyMessage = siteSettings.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE;
    }
    if (siteSettings.floatWindowEnabled !== undefined) state.floatWindowEnabled = !!siteSettings.floatWindowEnabled;
    if (siteSettings.showTimerEnabled !== undefined) state.showTimerEnabled = !!siteSettings.showTimerEnabled;
    if (siteSettings.maxCountEnabled !== undefined) state.maxCountEnabled = !!siteSettings.maxCountEnabled;
    if (siteSettings.maxCount !== undefined) state.maxCount = Number(siteSettings.maxCount) || 0;

    if (siteSettings.xpath === undefined && cachedXpath) {
      state.xpath = cachedXpath !== '__full__' ? cachedXpath : '';
      if (cachedXpath === '__full__') state.mode = 'full';
    }
    if (cachedMaxCount !== undefined && !hasOwn(siteSettings, 'maxCountEnabled') && !hasOwn(siteSettings, 'maxCount')) {
      state.maxCountEnabled = !!cachedMaxCount.enabled;
      state.maxCount = Number(cachedMaxCount.count) || 0;
    }
    state.remaining = state.interval;

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
      if (statusResult.maxCountEnabled !== undefined) state.maxCountEnabled = statusResult.maxCountEnabled;
      if (statusResult.maxCount !== undefined) state.maxCount = statusResult.maxCount;
      if (statusResult.monitorEnabled !== undefined) state.monitorEnabled = statusResult.monitorEnabled;
      if (statusResult.monitorXpath !== undefined) state.monitorXpath = statusResult.monitorXpath;
      if (statusResult.voiceNotifyEnabled !== undefined) state.voiceNotifyEnabled = statusResult.voiceNotifyEnabled;
      if (statusResult.voiceNotifyMessage !== undefined) state.voiceNotifyMessage = statusResult.voiceNotifyMessage || DEFAULT_VOICE_NOTIFY_MESSAGE;
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
        const pickPageKey = pick.urlKey || pageKey;
        const pickOrigin = pick.origin || origin;
        if (pickPageKey) {
          siteSettingsCache[pickPageKey] = {
            ...(siteSettingsCache[pickPageKey] || {}),
            mode: 'xpath',
            xpath: pick.xpath,
            targetFrame: pick.frameIndex && pick.frameIndex !== 'top' ? pick.frameIndex : 'top',
          };
          xpathCache[pickPageKey] = pick.xpath;
        } else if (pickOrigin) {
          xpathCache[pickOrigin] = pick.xpath;
        }
        await chrome.storage.local.set({ siteSettingsCache, xpathCache });

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
          siteSettingsCache[pickPageKey] = {
            ...(siteSettingsCache[pickPageKey] || {}),
            monitorEnabled: true,
            monitorXpath: pick.xpath,
            monitorTargetFrame: pick.frameIndex && pick.frameIndex !== 'top' ? pick.frameIndex : 'top',
          };
          monitorXpathCache[pickPageKey] = pick.xpath;
          await chrome.storage.local.set({ siteSettingsCache, monitorXpathCache });
        }
        state.monitorXpath = pick.xpath;
        state.monitorTargetFrame = pick.frameIndex && pick.frameIndex !== 'top' ? pick.frameIndex : 'top';
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
              siteSettingsCache[pickPageKey] = {
                ...(siteSettingsCache[pickPageKey] || {}),
                monitorEnabled: true,
                monitorXpath: pick.xpath,
                monitorTargetFrame: pick.frameIndex && pick.frameIndex !== 'top' ? pick.frameIndex : 'top',
              };
              monitorXpathCache[pickPageKey] = pick.xpath;
              await chrome.storage.local.set({ siteSettingsCache, monitorXpathCache });
            }
            state.monitorXpath = pick.xpath;
            state.monitorTargetFrame = pick.frameIndex && pick.frameIndex !== 'top' ? pick.frameIndex : 'top';
            state.monitorEnabled = true;
            addLog(`已选取监控区域 XPath: ${pick.xpath}`, 'info');
          }
        } else {
          if (!state.xpath) {
            const pickPageKey = pick.urlKey || pageKey;
            const pickOrigin = pick.origin || origin;
            if (pickPageKey) {
              siteSettingsCache[pickPageKey] = {
                ...(siteSettingsCache[pickPageKey] || {}),
                mode: 'xpath',
                xpath: pick.xpath,
                targetFrame: pick.frameIndex && pick.frameIndex !== 'top' ? pick.frameIndex : 'top',
              };
              xpathCache[pickPageKey] = pick.xpath;
            } else if (pickOrigin) {
              xpathCache[pickOrigin] = pick.xpath;
            }
            await chrome.storage.local.set({ siteSettingsCache, xpathCache });

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
    } else if (!hasOwn(siteSettings, 'xpath') && (pageKey || origin) && !state.xpath) {
      const cachedXpath = pageKey ? (xpathCache[pageKey] || (origin ? xpathCache[origin] : '')) : xpathCache[origin];
      state.xpath = cachedXpath && cachedXpath !== '__full__' ? cachedXpath : '';
      if (!state.xpath && state.mode === 'xpath') {
        state.mode = 'full';
      }
    }

    if (!state.running && pageKey && !state.monitorXpath && !hasOwn(siteSettings, 'monitorXpath')) {
      state.monitorXpath = monitorXpathCache[pageKey] || '';
    }
    if (!state.running && pageKey) {
      if (!hasOwn(siteSettings, 'voiceNotifyMessage')) {
        state.voiceNotifyMessage = voiceNotifyMessageCache[pageKey] || DEFAULT_VOICE_NOTIFY_MESSAGE;
      }
      if (!hasOwn(siteSettings, 'monitorNotifyMessage')) {
        state.monitorNotifyMessage = monitorNotifyMessageCache[pageKey] || DEFAULT_MONITOR_NOTIFY_MESSAGE;
      }
    }
    if (!state.running && !hasOwn(siteSettings, 'floatWindowEnabled')) {
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

    const storageResult = await chrome.storage.local.get([
      'siteSettingsCache',
      'xpathCache',
      'monitorXpathCache',
      'voiceNotifyMessageCache',
      'monitorNotifyMessageCache',
      'floatWindowCache',
      'maxCountCache'
    ]);
    const siteSettingsCache = storageResult.siteSettingsCache || {};
    const xpathCache = storageResult.xpathCache || {};
    const monitorXpathCache = storageResult.monitorXpathCache || {};
    const voiceNotifyMessageCache = storageResult.voiceNotifyMessageCache || {};
    const monitorNotifyMessageCache = storageResult.monitorNotifyMessageCache || {};
    const floatWindowCache = storageResult.floatWindowCache || {};
    const maxCountCache = storageResult.maxCountCache || {};
    if (pageKey) {
      siteSettingsCache[pageKey] = {
        interval: state.interval,
        mode: state.mode,
        xpath: state.xpath,
        targetFrame: state.targetFrame,
        maxCountEnabled: state.maxCountEnabled,
        maxCount: state.maxCount,
        monitorEnabled: state.monitorEnabled,
        monitorXpath: state.monitorXpath,
        monitorTargetFrame: state.monitorTargetFrame,
        voiceNotifyEnabled: state.voiceNotifyEnabled,
        voiceNotifyMessage: state.voiceNotifyMessage || DEFAULT_VOICE_NOTIFY_MESSAGE,
        popupNotifyEnabled: state.popupNotifyEnabled,
        monitorNotifyMessage: state.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE,
        floatWindowEnabled: state.floatWindowEnabled,
        showTimerEnabled: state.showTimerEnabled,
      };

      if (state.mode === 'full') {
        xpathCache[pageKey] = '__full__';
      } else if (state.xpath) {
        xpathCache[pageKey] = state.xpath;
      } else {
        delete xpathCache[pageKey];
      }
      maxCountCache[pageKey] = {
        enabled: state.maxCountEnabled,
        count: state.maxCount,
      };
      if (state.monitorXpath) {
        monitorXpathCache[pageKey] = state.monitorXpath;
      } else {
        delete monitorXpathCache[pageKey];
      }
      const voiceMessage = (state.voiceNotifyMessage || '').trim();
      if (voiceMessage && voiceMessage !== DEFAULT_VOICE_NOTIFY_MESSAGE) {
        voiceNotifyMessageCache[pageKey] = voiceMessage;
      } else {
        delete voiceNotifyMessageCache[pageKey];
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
      siteSettingsCache,
      xpathCache,
      monitorXpathCache,
      voiceNotifyMessageCache,
      monitorNotifyMessageCache,
      floatWindowCache,
      maxCountCache,
    });
    await chrome.storage.local.remove([
      'interval',
      'mode',
      'targetFrame',
      'maxCountEnabled',
      'maxCount',
      'monitorEnabled',
      'monitorXpath',
      'voiceNotifyEnabled',
      'popupNotifyEnabled',
      'floatWindowEnabled',
      'showTimerEnabled',
      'alertSettingsEnabled'
    ]);
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

function getVoiceNotifyMessage() {
  const raw = els.voiceNotifyMessageInput
    ? els.voiceNotifyMessageInput.value
    : state.voiceNotifyMessage;
  return (raw || '').trim() || DEFAULT_VOICE_NOTIFY_MESSAGE;
}

function sendNotifyUpdate() {
  if (!state.running) return;
  chrome.runtime.sendMessage({
    type: 'UPDATE_NOTIFY',
    tabId: state.tabId,
    voiceNotifyEnabled: state.voiceNotifyEnabled,
    voiceNotifyMessage: state.voiceNotifyMessage || DEFAULT_VOICE_NOTIFY_MESSAGE,
    popupNotifyEnabled: state.popupNotifyEnabled,
    monitorNotifyMessage: state.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE,
  });
}

function updateMaxCountEditor() {
  els.maxCountToggle.checked = state.maxCountEnabled;
  els.maxCountBody.classList.toggle('hidden', !state.maxCountEnabled);
}

function updateMonitorModuleEditors() {
  els.voiceNotifyToggle.checked = state.voiceNotifyEnabled;
  els.popupNotifyToggle.checked = state.popupNotifyEnabled;
  els.voiceNotifyBody.classList.toggle('hidden', !state.voiceNotifyEnabled);
  els.popupNotifyBody.classList.toggle('hidden', !state.popupNotifyEnabled);
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

  els.maxCountToggle.addEventListener('change', () => {
    state.maxCountEnabled = els.maxCountToggle.checked;
    updateMaxCountEditor();
    saveState();
    if (state.running) {
      chrome.runtime.sendMessage({
        type: 'UPDATE_MAX_COUNT',
        tabId: state.tabId,
        maxCountEnabled: state.maxCountEnabled,
        maxCount: state.maxCount,
      });
      addLog(state.maxCountEnabled ? `刷新上限已开启: ${state.maxCount || 0} 次` : '刷新上限已关闭', 'info');
    }
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
  els.locateXpathBtn.addEventListener('click', () => locateCurrentXPath('click'));
  els.xpathInput.addEventListener('change', () => {
    state.xpath = els.xpathInput.value.trim();
    saveState();
  });

  els.pickMonitorXpathBtn.addEventListener('click', () => startXPathPicker('monitor'));
  els.locateMonitorXpathBtn.addEventListener('click', () => locateCurrentXPath('monitor'));
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
        voiceNotifyMessage: state.voiceNotifyMessage || DEFAULT_VOICE_NOTIFY_MESSAGE,
        monitorNotifyMessage: state.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE,
      });
      addLog(state.monitorEnabled ? '监控模式已启用' : '监控模式已关闭', 'info');
    }
  });

  els.voiceNotifyToggle.addEventListener('change', () => {
    state.voiceNotifyEnabled = els.voiceNotifyToggle.checked;
    updateMonitorModuleEditors();
    saveState();
    sendNotifyUpdate();
  });

  els.voiceNotifyMessageInput.addEventListener('input', () => {
    state.voiceNotifyMessage = getVoiceNotifyMessage();
    saveState();
    sendNotifyUpdate();
  });

  els.popupNotifyToggle.addEventListener('change', () => {
    state.popupNotifyEnabled = els.popupNotifyToggle.checked;
    updateMonitorModuleEditors();
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

  els.showTimerToggle.addEventListener('change', () => {
    state.showTimerEnabled = els.showTimerToggle.checked;
    saveState();
    if (state.running) {
      chrome.runtime.sendMessage({
        type: 'UPDATE_SHOW_TIMER',
        tabId: state.tabId,
        showTimerEnabled: state.showTimerEnabled,
      }).catch(() => {});
    }
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
      maxCountEnabled: state.maxCountEnabled,
      maxCount: state.maxCount,
    });
    addLog(state.maxCountEnabled ? `刷新次数上限设为 ${val === 0 ? '无限制' : val}` : '刷新上限已关闭', 'info');
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

async function locateCurrentXPath(forMode) {
  const isClickMode = forMode === 'click';
  const xpath = isClickMode ? state.xpath : state.monitorXpath;

  if (!xpath) {
    const title = isClickMode ? '点击 XPath 为空' : '监控 XPath 为空';
    const message = isClickMode ? '请先输入或选取点击目标 XPath' : '请先输入或选取监控区域 XPath';
    addLog(message, 'error');
    await showPageErrorNotification(title, message, xpath);
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: (xpathValue) => {
        const separator = ' >> ';
        const overlayId = '__auto_refresh_locator_overlay__';
        const blinkCount = 1;
        const durationPerBlink = 1.5;

        try {
          const splitIndex = String(xpathValue || '').indexOf(separator);
          const frameXPath = splitIndex >= 0 ? xpathValue.slice(0, splitIndex).trim() : '';
          const innerXPath = splitIndex >= 0 ? xpathValue.slice(splitIndex + separator.length).trim() : xpathValue;

          if (frameXPath) {
            if (window === window.top) return { found: false };
          }

          const result = document.evaluate(innerXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          const element = result.singleNodeValue;
          if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return { found: false };
          }

          if (window.__autoRefreshLocatorCleanup) {
            window.__autoRefreshLocatorCleanup();
          }

          // 1. 动态向页面注入呼吸灯的动画样式（只需注入一次）
          const styleId = '__auto_refresh_locator_style__';
          if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
              @keyframes armBreathe {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.05; }
              }
            `;
            document.head.appendChild(style);
          }

          // 2. 创建或重置高亮层
          let overlay = document.getElementById(overlayId);
          if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = overlayId;
            document.documentElement.appendChild(overlay);
          }

          // 3. 动态计算并应用动画属性：执行 blinkCount 次，每次持续 durationPerBlink 秒
          overlay.style.cssText = [
            'position:fixed',
            'pointer-events:none',
            'z-index:2147483646',
            'border:none !important',
            'background:rgba(96, 73, 200, 0.22)',
            'box-shadow: inset 0 0 8px 4px rgb(96, 73, 200) !important',
            'border-radius:3px',
            'display:none',
            `animation: armBreathe ${durationPerBlink}s ease-in-out ${blinkCount}` // 👈 控制核心！
          ].join(';');

          const updateOverlay = () => {
            const rect = element.getBoundingClientRect();
            overlay.style.display = 'block';
            overlay.style.left = `${rect.left}px`;
            overlay.style.top = `${rect.top}px`;
            overlay.style.width = `${Math.max(rect.width, 1)}px`;
            overlay.style.height = `${Math.max(rect.height, 1)}px`;
          };

          element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
          updateOverlay();

          // 只要动画还在播，就持续跟踪位置防止错位
          const totalAnimationTime = blinkCount * durationPerBlink * 1000;
          let ticks = 0;
          const intervalId = setInterval(() => {
            updateOverlay();
            ticks += 1;
            if (ticks >= (totalAnimationTime / 100)) {
              clearInterval(intervalId);
            }
          }, 100);

          const cleanup = () => {
            clearInterval(intervalId);
            if (overlay && overlay.parentElement) {
              overlay.remove();
            }
          };
          window.__autoRefreshLocatorCleanup = cleanup;

          // 4. 动画播完后，干净利落地自动销毁
          setTimeout(() => {
            if (window.__autoRefreshLocatorCleanup === cleanup) {
              cleanup();
              window.__autoRefreshLocatorCleanup = null;
            }
          }, totalAnimationTime); // 👈 刚好是总闪烁时间

          return { found: true };
        } catch (e) {
          return { found: false, error: e.message || String(e) };
        }
      },
      args: [xpath],
    });

    const found = Array.isArray(results) && results.some((item) => item?.result?.found);

    if (found) {
      addLog(`已定位 XPath 位置: ${xpath}`, 'info');
    } else {
      addLog(`未找到 XPath 匹配元素: ${xpath}`, 'error');
      await showPageErrorNotification('XPath 定位失败', '当前页面未找到匹配元素，请检查 XPath 是否正确', xpath);
    }
  } catch (e) {
    addLog(`定位 XPath 失败: ${e.message || e}`, 'error');
  }
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
      '监控模式已开启，请先点击「选取」按钮选择监控区域，或手动输入监控区域 XPath'
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
    maxCountEnabled: state.maxCountEnabled,
    maxCount: state.maxCount,
    monitorEnabled: state.monitorEnabled,
    monitorXpath: state.monitorXpath,
    voiceNotifyEnabled: state.voiceNotifyEnabled,
    voiceNotifyMessage: state.voiceNotifyMessage || DEFAULT_VOICE_NOTIFY_MESSAGE,
    popupNotifyEnabled: state.popupNotifyEnabled,
    monitorNotifyMessage: state.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE,
    floatWindowEnabled: state.floatWindowEnabled,
    showTimerEnabled: state.showTimerEnabled,
  });

  const countText = state.maxCountEnabled ? `, 上限 ${state.maxCount || 0} 次` : ', 无刷新上限';
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

    if (state.maxCountEnabled && state.maxCount > 0 && state.refreshCount >= state.maxCount) {
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
        const frameIndex = msg.frameIndex;
        state.monitorTargetFrame = frameIndex && frameIndex !== 'top' ? frameIndex : 'top';
        if (state.running) {
          chrome.runtime.sendMessage({
            type: 'UPDATE_MONITOR',
            tabId: state.tabId,
            monitorEnabled: state.monitorEnabled,
            monitorXpath: state.monitorXpath,
            voiceNotifyMessage: state.voiceNotifyMessage || DEFAULT_VOICE_NOTIFY_MESSAGE,
            monitorNotifyMessage: state.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE,
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
  updateMaxCountEditor();

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

  els.voiceNotifyMessageInput.value = state.voiceNotifyMessage || DEFAULT_VOICE_NOTIFY_MESSAGE;
  els.monitorNotifyMessageInput.value = state.monitorNotifyMessage || DEFAULT_MONITOR_NOTIFY_MESSAGE;
  updateMonitorModuleEditors();

  // Floating window toggle
  els.floatWindowToggle.checked = state.floatWindowEnabled;
  els.showTimerToggle.checked = state.showTimerEnabled;

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
