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
  presetBtns: document.querySelectorAll('.preset-btn'),
  maxCountInput: document.getElementById('maxCountInput'),
};

// State
let state = {
  running: false,
  interval: 60,
  mode: 'full', // 'full' | 'xpath'
  xpath: '',
  targetFrame: 'top',
  refreshCount: 0,
  remaining: 60,
  picking: false,
  maxCount: 0, // 0 = unlimited
};

// Constants
const RING_CIRCUMFERENCE = 2 * Math.PI * 54; // ~339.292

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
      'interval', 'mode', 'xpath', 'targetFrame', 'running', 'refreshCount', 'maxCount'
    ]);
    state.interval = result.interval || 60;
    state.mode = result.mode || 'full';
    state.xpath = result.xpath || '';
    state.targetFrame = result.targetFrame || 'top';
    state.running = result.running || false;
    state.refreshCount = result.refreshCount || 0;
    state.maxCount = result.maxCount || 0;
    state.remaining = state.interval;

    // Sync countdown from background
    const statusResult = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (statusResult && statusResult.running) {
      state.remaining = statusResult.remaining || state.interval;
      state.running = true;
    } else {
      state.running = false;
    }
  } catch (e) {
    console.error('Failed to load state:', e);
  }
}

async function saveState() {
  try {
    await chrome.storage.local.set({
      interval: state.interval,
      mode: state.mode,
      xpath: state.xpath,
      targetFrame: state.targetFrame,
      running: state.running,
      refreshCount: state.refreshCount,
      maxCount: state.maxCount,
    });
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

// ===== Event Binding =====
function bindEvents() {
  // Interval controls
  els.intervalInput.addEventListener('change', handleIntervalChange);
  els.decreaseBtn.addEventListener('click', () => adjustInterval(-1));
  els.increaseBtn.addEventListener('click', () => adjustInterval(1));

  // Presets
  els.presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.value, 10);
      state.interval = val;
      els.intervalInput.value = val;
      updatePresetHighlight(val);
      handleIntervalChange();
    });
  });

  // Max count input
  els.maxCountInput.addEventListener('change', handleMaxCountChange);

  // Mode tabs - hot switch while running
  els.modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const newMode = tab.dataset.mode;
      if (newMode === state.mode) return;

      state.mode = newMode;
      els.modeTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      els.xpathSection.classList.toggle('hidden', state.mode !== 'xpath');
      saveState();

      // Hot switch mode while running
      if (state.running) {
        if (state.mode === 'xpath' && !state.xpath) {
          addLog('切换到 XPath 模式需要先选取表达式', 'error');
          return;
        }
        chrome.runtime.sendMessage({
          type: 'UPDATE_MODE',
          mode: state.mode,
          xpath: state.xpath,
          targetFrame: state.targetFrame,
        });
        const modeLabel = state.mode === 'full' ? '全页刷新' : 'XPath 点击';
        addLog(`模式已热切换为: ${modeLabel}`, 'info');
        state.remaining = state.interval;
        updateTimerDisplay();
      }
    });
  });

  // XPath picker
  els.pickXpathBtn.addEventListener('click', startXPathPicker);
  els.xpathInput.addEventListener('change', () => {
    state.xpath = els.xpathInput.value.trim();
    saveState();
  });

  // Frame select
  els.frameSelect.addEventListener('change', () => {
    state.targetFrame = els.frameSelect.value;
    saveState();
  });

  // Start / Stop
  els.startBtn.addEventListener('click', startRefresh);
  els.stopBtn.addEventListener('click', stopRefresh);
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

  // Hot switch: update interval while running
  if (state.running) {
    chrome.runtime.sendMessage({
      type: 'UPDATE_INTERVAL',
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

  // Hot switch: update interval while running
  if (state.running) {
    chrome.runtime.sendMessage({
      type: 'UPDATE_INTERVAL',
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
    // Cancel picking
    state.picking = false;
    els.pickXpathBtn.classList.remove('picking');
    els.pickXpathBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
      </svg>选取`;
    els.xpathHint.textContent = '已取消选取';
    els.xpathHint.classList.remove('active');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { type: 'STOP_PICKING' });
    return;
  }

  state.picking = true;
  els.pickXpathBtn.classList.add('picking');
  els.pickXpathBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>取消`;
  els.xpathHint.textContent = '请在页面上点击要选取的元素...';
  els.xpathHint.classList.add('active');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'START_PICKING' });
}

// ===== Start / Stop =====
async function startRefresh() {
  // Validate
  if (state.mode === 'xpath' && !state.xpath) {
    addLog('请先输入或选取 XPath 表达式', 'error');
    return;
  }

  state.running = true;
  state.remaining = state.interval;
  state.refreshCount = 0;
  await saveState();

  chrome.runtime.sendMessage({
    type: 'START',
    interval: state.interval,
    mode: state.mode,
    xpath: state.xpath,
    targetFrame: state.targetFrame,
    maxCount: state.maxCount,
  });

  const countText = state.maxCount > 0 ? `, 上限 ${state.maxCount} 次` : ', 无限制';
  addLog(`已启动 - 间隔 ${state.interval} 秒, 模式: ${state.mode === 'full' ? '全页刷新' : 'XPath点击'}${countText}`, 'success');
  updateUI();
}

async function stopRefresh() {
  state.running = false;
  state.remaining = state.interval;
  await saveState();

  chrome.runtime.sendMessage({ type: 'STOP' });

  addLog('已停止刷新', 'info');
  updateUI();
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

      // Populate frame select
      els.frameSelect.innerHTML = '<option value="top">主页面</option>';
      response.iframes.forEach((frame, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `iframe #${i + 1}: ${frame.src || frame.name || '(unnamed)'}`;
        els.frameSelect.appendChild(opt);
      });

      // Restore selection
      if (state.targetFrame !== 'top') {
        els.frameSelect.value = state.targetFrame;
      }
    } else {
      els.iframeSection.classList.add('hidden');
    }
  } catch (e) {
    // Content script may not be injected on some pages
    els.iframeSection.classList.add('hidden');
  }
}

// ===== Countdown Sync =====
function startCountdownSync() {
  setInterval(async () => {
    if (!state.running) return;
    try {
      const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      if (status && status.running) {
        if (status.waitingForLoad) {
          // Page is still loading after full refresh
          els.timerCount.textContent = '...';
          els.ringProgress.style.strokeDashoffset = RING_CIRCUMFERENCE;
        } else {
          state.remaining = status.remaining;
          updateTimerDisplay();
        }
        state.refreshCount = status.refreshCount || state.refreshCount;
        els.refreshCount.textContent = state.refreshCount;
      }
    } catch (e) {
      // Background may not respond
    }
  }, 1000);
}

// Listen for refresh events from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'REFRESH_DONE') {
    state.refreshCount = msg.count;
    els.refreshCount.textContent = state.refreshCount;

    if (msg.waitingForLoad) {
      // Full page refresh triggered, waiting for page to load
      state.remaining = 0;
      els.timerCount.textContent = '...';
      els.ringProgress.style.strokeDashoffset = RING_CIRCUMFERENCE;
      addLog(`第 ${msg.count} 次刷新已触发，等待页面加载...`, 'info');
    } else {
      state.remaining = state.interval;
      updateTimerDisplay();
      addLog(`第 ${msg.count} 次${msg.mode === 'full' ? '刷新' : '点击'}完成`, 'success');
    }
    saveState();

    // Check if max count reached
    if (state.maxCount > 0 && state.refreshCount >= state.maxCount) {
      addLog(`已达到刷新上限 ${state.maxCount} 次，自动停止`, 'info');
      stopRefresh();
    }
  } else if (msg.type === 'PAGE_LOADED') {
    // Page finished loading after full refresh, countdown restarted
    state.remaining = state.interval;
    updateTimerDisplay();
    addLog('页面加载完成，倒计时重新开始', 'success');
  } else if (msg.type === 'REFRESH_ERROR') {
    addLog(`执行失败: ${msg.error}`, 'error');
  } else if (msg.type === 'XPATH_PICKED') {
    state.picking = false;
    els.pickXpathBtn.classList.remove('picking');
    els.pickXpathBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
      </svg>选取`;
    els.xpathHint.textContent = '已选取元素';
    els.xpathHint.classList.remove('active');
    state.xpath = msg.xpath;
    els.xpathInput.value = msg.xpath;
    saveState();
    addLog(`已选取 XPath: ${msg.xpath}`, 'info');

    // Show toast notification with element info
    if (msg.xpath && !msg.cancelled) {
      showToast(msg);
    }

    // If running, hot-switch to xpath mode and continue
    if (msg.xpath && !msg.cancelled && state.running) {
      setTimeout(() => {
        state.mode = 'xpath';
        els.modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === 'xpath'));
        els.xpathSection.classList.remove('hidden');
        chrome.runtime.sendMessage({
          type: 'UPDATE_MODE',
          mode: 'xpath',
          xpath: state.xpath,
          targetFrame: state.targetFrame,
        });
        state.remaining = state.interval;
        updateTimerDisplay();
        addLog('已自动切换到 XPath 点击模式', 'info');
        saveState();
      }, 300);
    } else if (msg.xpath && !msg.cancelled && !state.running) {
      // Not running - auto start
      setTimeout(() => {
        startRefresh();
      }, 300);
    }
  }
});

// ===== UI Updates =====
function updateUI() {
  // Status badge
  els.statusBadge.classList.toggle('running', state.running);
  els.statusText.textContent = state.running ? '运行中' : '已停止';

  // Buttons
  els.startBtn.classList.toggle('hidden', state.running);
  els.stopBtn.classList.toggle('hidden', !state.running);

  // Mode
  els.modeTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === state.mode);
  });
  els.xpathSection.classList.toggle('hidden', state.mode !== 'xpath');

  // Interval
  els.intervalInput.value = state.interval;
  updatePresetHighlight(state.interval);

  // Max count
  els.maxCountInput.value = state.maxCount;

  // XPath
  els.xpathInput.value = state.xpath;

  // Refresh count
  els.refreshCount.textContent = state.refreshCount;

  // Timer
  updateTimerDisplay();

  // Hot switch: controls remain enabled while running
  // (no disabled state - user can change interval/count at any time)
}

function updateTimerDisplay() {
  els.timerCount.textContent = state.remaining;

  // Update ring progress
  const progress = state.running
    ? (state.remaining / state.interval) * RING_CIRCUMFERENCE
    : RING_CIRCUMFERENCE;
  els.ringProgress.style.strokeDasharray = RING_CIRCUMFERENCE;
  els.ringProgress.style.strokeDashoffset = RING_CIRCUMFERENCE - progress;
}

// ===== Logging =====
function addLog(message, type = 'info') {
  // Remove empty placeholder
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

  // Keep max 50 logs
  while (els.logList.children.length > 50) {
    els.logList.lastChild.remove();
  }
}

// ===== Toast Notification =====
function showToast(msg) {
  // Remove existing toast if any
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast-notification';

  // Build element info
  const tag = msg.tagName || 'unknown';
  const text = msg.textContent ? msg.textContent.substring(0, 40) : '(empty)';
  const xpath = msg.xpath || '';

  toast.innerHTML = `
    <div class="toast-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    </div>
    <div class="toast-content">
      <div class="toast-title">XPath 元素选取成功</div>
      <div class="toast-info">
        <span class="toast-tag">&lt;${tag}&gt;</span>
        <span class="toast-text">${text}</span>
      </div>
      <div class="toast-xpath" title="${xpath}">${xpath}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;

  document.body.appendChild(toast);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('toast-dismiss');
      setTimeout(() => toast.remove(), 300);
    }
  }, 5000);
}

// ===== Init =====
init();
