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
  iframeSection: document.getElementById('iframeSection'),
  frameSelect: document.getElementById('frameSelect'),
  iframeHint: document.getElementById('iframeHint'),
  logList: document.getElementById('logList'),
  sitesList: document.getElementById('sitesList'),
  sitesTab: document.getElementById('sitesTab'),
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
  maxCount: 0,
  tabId: null,
};

// Constants
const RING_CIRCUMFERENCE = 2 * Math.PI * 54;

// ===== Initialization =====
async function init() {
  await loadState();
  bindEvents();
  updateUI();
  startCountdownSync();
  detectIframes();
}

async function loadState() {
  try {
    const result = await chrome.storage.local.get([
      'interval', 'mode', 'xpathCache', 'targetFrame', 'maxCount', 'pendingXpathPick'
    ]);
    state.interval = result.interval || 60;
    state.mode = result.mode || 'full';
    state.targetFrame = result.targetFrame || 'top';
    state.running = false;
    state.refreshCount = 0;
    state.maxCount = result.maxCount || 0;
    state.remaining = state.interval;

    // Resolve current tab's origin for per-site xpath cache
    const xpathCache = result.xpathCache || {};
    let origin = '';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        state.tabId = tab.id || null;
      }
      if (tab && tab.url) {
        origin = new URL(tab.url).origin;
      }
    } catch (e) { /* ignore */ }

    // Check for pending xpath pick (result of clicking while popup was closed)
    if (result.pendingXpathPick && result.pendingXpathPick.xpath) {
      const pick = result.pendingXpathPick;
      if (Date.now() - pick.timestamp < 30000) {
        const pickOrigin = pick.origin || origin;
        xpathCache[pickOrigin] = pick.xpath;
        await chrome.storage.local.set({ xpathCache });
        state.xpath = pick.xpath;
        state.mode = 'xpath';
        addLog(`已选取 XPath: ${pick.xpath}`, 'info');
      }
      chrome.storage.local.remove('pendingXpathPick').catch(() => {});
    } else if (origin) {
      // Load cached xpath for current site, or blank for new sites
      const cachedXpath = xpathCache[origin];
      state.xpath = cachedXpath && cachedXpath !== '__full__' ? cachedXpath : '';
      if (!state.xpath && state.mode === 'xpath') {
        state.mode = 'full';
      }
    }

    const statusResult = await chrome.runtime.sendMessage({ type: 'GET_STATUS', tabId: state.tabId });
    if (statusResult && statusResult.running) {
      state.remaining = statusResult.remaining || state.interval;
      state.running = true;
      state.refreshCount = statusResult.refreshCount || 0;
      state.interval = statusResult.interval || state.interval;
      state.mode = statusResult.mode || state.mode;
      state.xpath = statusResult.xpath || state.xpath;
      state.targetFrame = statusResult.targetFrame || state.targetFrame;
      state.maxCount = statusResult.maxCount || state.maxCount;
    } else {
      state.running = false;
      state.refreshCount = 0;
    }
  } catch (e) {
    console.error('Failed to load state:', e);
  }
}

async function saveState() {
  try {
    // Persist xpath to per-origin cache
    let origin = '';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) state.tabId = tab.id || state.tabId;
      if (tab && tab.url) origin = new URL(tab.url).origin;
    } catch (e) { /* ignore */ }

    const storageResult = await chrome.storage.local.get(['xpathCache']);
    const xpathCache = storageResult.xpathCache || {};
    if (origin) {
      xpathCache[origin] = state.xpath || '__full__'; // __full__ marker for full-page mode
    }

    await chrome.storage.local.set({
      interval: state.interval,
      mode: state.mode,
      xpathCache,
      targetFrame: state.targetFrame,
      maxCount: state.maxCount,
    });
  } catch (e) {
    console.error('Failed to save state:', e);
  }
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

  els.pickXpathBtn.addEventListener('click', startXPathPicker);
  els.xpathInput.addEventListener('change', () => {
    state.xpath = els.xpathInput.value.trim();
    saveState();
  });

  els.frameSelect.addEventListener('change', () => {
    state.targetFrame = els.frameSelect.value;
    saveState();
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
async function startXPathPicker() {
  if (state.picking) {
    state.picking = false;
    els.pickXpathBtn.classList.remove('picking');
    els.pickXpathBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
      </svg>选取`;
    els.xpathHint.textContent = '已取消选取';
    els.xpathHint.classList.remove('active');
    await saveState();

    // Tell background to cancel picking
    chrome.runtime.sendMessage({ type: 'STOP_PICKER', tabId: state.tabId });
    return;
  }

  // Double-path reliability:
  // (1) Fire-and-forget sendMessage (fast path, works when service worker is alive)
  chrome.runtime.sendMessage({ type: 'START_PICKER', tabId: state.tabId });

  // (2) Storage signal (fallback, works even if service worker is dormant)
  await chrome.storage.local.set({ pickingRequested: Date.now() });

  window.close();
}

// ===== Start / Stop =====
async function startRefresh() {
  if (state.mode === 'xpath' && !state.xpath) {
    addLog('请先输入或选取 XPath 表达式', 'error');
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
  });

  const countText = state.maxCount > 0 ? `, 上限 ${state.maxCount} 次` : ', 无限制';
  addLog(`已启动 - 间隔 ${state.interval} 秒, 模式: ${state.mode === 'full' ? '全页刷新' : 'XPath点击'}${countText}`, 'success');
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

// ===== iframe Detection =====
async function detectIframes() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'DETECT_IFRAMES' });
    if (response && response.iframes && response.iframes.length > 0) {
      els.iframeSection.classList.remove('hidden');
      els.iframeHint.classList.remove('hidden');

      els.frameSelect.innerHTML = '<option value="top">主页面</option>';
      response.iframes.forEach((frame, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `iframe #${i + 1}: ${frame.src || frame.name || '(unnamed)'}`;
        els.frameSelect.appendChild(opt);
      });

      if (state.targetFrame !== 'top') {
        els.frameSelect.value = state.targetFrame;
      }
    } else {
      els.iframeSection.classList.add('hidden');
    }
  } catch (e) {
    els.iframeSection.classList.add('hidden');
  }
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
    state.picking = false;
    els.pickXpathBtn.classList.remove('picking');
    els.pickXpathBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
      </svg>选取`;

    if (msg.cancelled) {
      els.xpathHint.textContent = '已取消选取';
      els.xpathHint.classList.remove('active');
      addLog('已取消 XPath 选取', 'info');
    } else {
      els.xpathHint.textContent = '已选取元素';
      els.xpathHint.classList.remove('active');
      state.xpath = msg.xpath;
      els.xpathInput.value = msg.xpath;
      saveState();
      addLog(`已选取 XPath: ${msg.xpath}`, 'info');

      if (state.running) {
        // Hot-switch mode if already running
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
          });
          state.remaining = state.interval;
          updateTimerDisplay();
          addLog('已自动切换到 XPath 点击模式', 'info');
          saveState();
        }, 300);
      }
      // Do NOT auto-start refresh — user must click Start explicitly
    }
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

  els.refreshCount.textContent = state.refreshCount;

  updateTimerDisplay();
}

function updateTimerDisplay() {
  els.timerCount.textContent = state.remaining;

  const progress = state.running
    ? (state.remaining / state.interval) * RING_CIRCUMFERENCE
    : RING_CIRCUMFERENCE;
  els.ringProgress.style.strokeDasharray = RING_CIRCUMFERENCE;
  els.ringProgress.style.strokeDashoffset = RING_CIRCUMFERENCE - progress;
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
      els.sitesTabBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>监控网址 <span class="sites-tab-badge">' + count + '</span>';
    }

    renderSitesList(sites);
  } catch (e) {
    console.error('Failed to load sites:', e);
    els.sitesList.innerHTML = '<div class="sites-empty">加载失败<br><span>请重试</span></div>';
  }
}

function renderSitesList(sites) {
  if (sites.length === 0) {
    els.sitesList.innerHTML = '<div class="sites-empty">暂无正在刷新的网址<br><span>启动刷新后自动显示当前网站</span></div>';
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
      els.sitesTabBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>监控网址 <span class="sites-tab-badge">' + count + '</span>';
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
  detectIframes();
}
boot();
