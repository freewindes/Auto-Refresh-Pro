/**
 * Auto Refresh Pro - Content Script
 * Injected into all pages (all_frames: true). Handles:
 * - XPath element clicking (executes in target frame directly)
 * - iframe detection (top frame only)
 * - XPath element picker (mouse selection, works in any frame)
 */

// ===== Frame Index Self-Detection =====
// Each content script instance determines its own frame index
// so that picked XPath can be associated with the correct iframe.
let myFrameIndex = 'top'; // 'top' for top-level, or numeric index for iframe

function detectMyFrameIndex() {
  if (window === window.top) {
    myFrameIndex = 'top';
    return;
  }
  // Ask parent frame to identify our index
  try {
    const parentDoc = window.parent.document;
    const iframes = parentDoc.querySelectorAll('iframe');
    for (let i = 0; i < iframes.length; i++) {
      if (iframes[i].contentWindow === window) {
        myFrameIndex = String(i);
        return;
      }
    }
  } catch (e) {
    // Cross-origin: cannot access parent document.
    // Use a messaging approach instead — resolved in XPATH_PICKED handler.
    myFrameIndex = 'unknown';
  }
}
detectMyFrameIndex();

let extensionContextValid = true;

function isExtensionContextInvalid(error) {
  const message = String(error?.message || error || '');
  return message.includes('Extension context invalidated') ||
    message.includes('Extension context was invalidated');
}

function stopRuntimePolling() {
  extensionContextValid = false;
  if (floatWindowInterval) {
    clearInterval(floatWindowInterval);
    floatWindowInterval = null;
  }
}

function safeSendMessage(message) {
  if (!extensionContextValid) {
    return Promise.resolve(null);
  }

  try {
    if (!globalThis.chrome?.runtime?.id) {
      stopRuntimePolling();
      return Promise.resolve(null);
    }

    const result = chrome.runtime.sendMessage(message);
    if (result && typeof result.then === 'function') {
      return result.catch((error) => {
        if (isExtensionContextInvalid(error)) {
          stopRuntimePolling();
        }
        return null;
      });
    }
    return Promise.resolve(result);
  } catch (error) {
    if (isExtensionContextInvalid(error)) {
      stopRuntimePolling();
    }
    return Promise.resolve(null);
  }
}

// ===== iframe Detection =====
function detectIframes() {
  const iframes = [];
  const frames = document.querySelectorAll('iframe');
  frames.forEach((frame, index) => {
    let src = '';
    try {
      src = frame.src || frame.getAttribute('src') || '';
    } catch (e) {
      src = '(cross-origin)';
    }
    iframes.push({
      index,
      src: src.substring(0, 80),
      name: frame.name || frame.id || '',
    });
  });
  return iframes;
}

// ===== XPath Utilities =====

/**
 * Generate a unique XPath for a given DOM element
 */
function generateXPath(element) {
  if (!element || element === document.body) return '/html/body';
  if (element === document.documentElement) return '/html';
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  // Try to use class names for a more readable xpath
  const tag = element.tagName.toLowerCase();

  // Check if element has a unique class combination
  if (element.classList.length > 0) {
    const classSelector = Array.from(element.classList)
      .map(c => `contains(@class,'${c}')`)
      .join(' and ');
    const xpath = `//${tag}[${classSelector}]`;
    // Verify uniqueness
    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    if (result.snapshotLength === 1) {
      return xpath;
    }
  }

  // Fall back to positional xpath
  const parent = element.parentNode;
  if (!parent) return tag;

  const siblings = Array.from(parent.children).filter(
    (s) => s.tagName === element.tagName
  );

  if (siblings.length > 1) {
    const index = siblings.indexOf(element) + 1;
    return `${generateXPath(parent)}/${tag}[${index}]`;
  }

  return `${generateXPath(parent)}/${tag}`;
}

/**
 * Find element by XPath expression
 */
function findElementByXPath(xpath, context) {
  const doc = context || document;
  const result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
  return result.singleNodeValue;
}

/**
 * Execute click on element found by XPath in the CURRENT frame.
 * When all_frames: true, this content script runs inside each iframe,
 * so we simply use the local document — no cross-origin access needed.
 */
function executeXPathClick(xpath) {
  const element = findElementByXPath(xpath, document);
  if (!element) {
    throw new Error(`未找到匹配的元素: ${xpath}`);
  }

  // Simulate a realistic click sequence
  const events = ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'];
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  events.forEach((eventType) => {
    const event = new MouseEvent(eventType, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    });
    element.dispatchEvent(event);
  });

  // Also try native click if element supports it
  if (typeof element.click === 'function') {
    try {
      element.click();
    } catch (e) {
      // CSP may block javascript: URLs; dispatched events above already did the job
    }
  }

  return {
    tag: element.tagName.toLowerCase(),
    text: (element.textContent || '').trim().substring(0, 50),
  };
}

// ===== XPath Picker (Mouse Selection Mode) =====
let pickerActive = false;
let highlightOverlay = null;
let lastHoveredElement = null;

function createHighlightOverlay() {
  if (highlightOverlay) return highlightOverlay;

  highlightOverlay = document.createElement('div');
  highlightOverlay.id = '__auto_refresh_picker_overlay__';
  highlightOverlay.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483646;
    border: 2px solid #818cf8;
    background: rgba(129, 140, 248, 0.15);
    border-radius: 3px;
    transition: all 0.1s ease;
    display: none;
  `;
  document.body.appendChild(highlightOverlay);

  // Add tooltip
  const tooltip = document.createElement('div');
  tooltip.id = '__auto_refresh_picker_tooltip__';
  tooltip.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483647;
    background: #1e293b;
    color: #e2e8f0;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-family: monospace;
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;
  document.body.appendChild(tooltip);

  return highlightOverlay;
}

function removeHighlightOverlay() {
  const overlay = document.getElementById('__auto_refresh_picker_overlay__');
  const tooltip = document.getElementById('__auto_refresh_picker_tooltip__');
  if (overlay) overlay.remove();
  if (tooltip) tooltip.remove();
  highlightOverlay = null;
}

function showHighlight(element) {
  if (!highlightOverlay) createHighlightOverlay();
  const overlay = document.getElementById('__auto_refresh_picker_overlay__');
  const tooltip = document.getElementById('__auto_refresh_picker_tooltip__');

  if (!overlay || !element) return;

  const rect = element.getBoundingClientRect();
  overlay.style.display = 'block';
  overlay.style.left = rect.left + 'px';
  overlay.style.top = rect.top + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';

  if (tooltip) {
    const xpath = generateXPath(element);
    tooltip.textContent = `${element.tagName.toLowerCase()} ${element.id ? '#' + element.id : ''} | ${xpath.substring(0, 60)}`;
    tooltip.style.display = 'block';
    tooltip.style.left = rect.left + 'px';
    tooltip.style.top = Math.max(0, rect.top - 24) + 'px';
  }
}

function hideHighlight() {
  const overlay = document.getElementById('__auto_refresh_picker_overlay__');
  const tooltip = document.getElementById('__auto_refresh_picker_tooltip__');
  if (overlay) overlay.style.display = 'none';
  if (tooltip) tooltip.style.display = 'none';
}

function startPicker() {
  if (pickerActive) return;
  pickerActive = true;

  createHighlightOverlay();

  // Add cursor style
  document.body.style.cursor = 'crosshair';

  document.addEventListener('mouseover', onPickerMouseMove, true);
  document.addEventListener('click', onPickerClick, true);
  document.addEventListener('keydown', onPickerKeyDown, true);
}

function stopPicker() {
  pickerActive = false;
  document.body.style.cursor = '';
  removeHighlightOverlay();

  document.removeEventListener('mouseover', onPickerMouseMove, true);
  document.removeEventListener('click', onPickerClick, true);
  document.removeEventListener('keydown', onPickerKeyDown, true);
}

function onPickerMouseMove(e) {
  if (!pickerActive) return;
  e.preventDefault();
  e.stopPropagation();

  const element = e.target;
  if (
    element.id === '__auto_refresh_picker_overlay__' ||
    element.id === '__auto_refresh_picker_tooltip__'
  ) {
    return;
  }

  lastHoveredElement = element;
  showHighlight(element);
}

function onPickerClick(e) {
  if (!pickerActive) return;
  e.preventDefault();
  e.stopPropagation();

  const element = lastHoveredElement || e.target;
  if (
    element.id === '__auto_refresh_picker_overlay__' ||
    element.id === '__auto_refresh_picker_tooltip__'
  ) {
    return;
  }

  const xpath = generateXPath(element);
  const tagName = element.tagName.toLowerCase();
  const textContent = (element.textContent || '').trim().substring(0, 50);
  stopPicker();

  // Send xpath back to popup via background with element info and frame index
  safeSendMessage({
    type: 'XPATH_PICKED',
    xpath: xpath,
    tagName: tagName,
    textContent: textContent,
    frameIndex: myFrameIndex,
  });
}

function onPickerKeyDown(e) {
  if (e.key === 'Escape' && pickerActive) {
    stopPicker();
    safeSendMessage({
      type: 'XPATH_PICKED',
      xpath: '',
      cancelled: true,
    });
  }
}

// ===== Notification (shared positioning: bottom-right) =====
function showNotification(msg, isError) {
  const existing = document.getElementById('__auto_refresh_xpath_notification__');
  if (existing) existing.remove();

  const notification = document.createElement('div');
  notification.id = '__auto_refresh_xpath_notification__';
  notification.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    background: #ffffff;
    border: 1px solid ${isError ? 'rgba(239,68,68,0.3)' : '#e2e8f0'};
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15), 0 0 0 1px ${isError ? 'rgba(239,68,68,0.08)' : 'rgba(59,130,246,0.08)'};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans SC', sans-serif;
    max-width: 380px;
    animation: arToastSlideIn 0.35s ease;
  `;

  // Icon
  const icon = document.createElement('div');
  icon.style.cssText = `
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: ${isError ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)'};
    color: ${isError ? '#ef4444' : '#10b981'};
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  if (isError) {
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  } else {
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
  }

  const content = document.createElement('div');
  content.style.cssText = 'flex: 1; min-width: 0;';

  const title = document.createElement('div');
  title.style.cssText = 'font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 4px;';
  title.textContent = isError ? (msg.title || 'XPath 执行失败') : 'XPath 元素选取成功';

  const msgLine = document.createElement('div');
  msgLine.style.cssText = 'font-size: 12px; color: #64748b; margin-bottom: 6px; word-break: break-all;';

  if (isError) {
    msgLine.textContent = msg.message || msg.error || '未知错误';
  } else {
    const tag = document.createElement('span');
    tag.style.cssText = 'display: inline-block; padding: 2px 8px; border-radius: 4px; background: rgba(99,102,241,0.08); color: #6366f1; font-size: 12px; font-weight: 600; font-family: monospace;';
    tag.textContent = `<${msg.tagName || 'unknown'}>`;
    const text = document.createElement('span');
    text.style.cssText = 'margin-left: 6px; color: #64748b; font-size: 12px;';
    text.textContent = (msg.textContent || '(empty)').substring(0, 50);
    msgLine.appendChild(tag);
    msgLine.appendChild(text);
  }

  const xpathOrError = document.createElement('div');
  xpathOrError.style.cssText = 'font-size: 11px; color: #94a3b8; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 8px; background: #f8fafc; border-radius: 6px; border: 1px solid #f1f5f9;';
  // Show xpath when available. For error cases, do NOT duplicate the message in this monospace block.
  if (isError) {
    xpathOrError.textContent = msg.xpath || '';
    if (!xpathOrError.textContent) xpathOrError.style.display = 'none';
    else xpathOrError.title = xpathOrError.textContent;
  } else {
    xpathOrError.textContent = msg.xpath || '';
    if (!xpathOrError.textContent) xpathOrError.style.display = 'none';
    else xpathOrError.title = xpathOrError.textContent;
  }

  content.appendChild(title);
  content.appendChild(msgLine);
  content.appendChild(xpathOrError);

  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'flex-shrink: 0; width: 22px; height: 22px; border: none; background: transparent; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 4px; padding: 0; transition: all 0.2s;';
  closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  closeBtn.addEventListener('click', () => notification.remove());
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = '#f1f5f9'; closeBtn.style.color = '#64748b'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = '#94a3b8'; });

  notification.appendChild(icon);
  notification.appendChild(content);
  notification.appendChild(closeBtn);

  const style = document.createElement('style');
  style.id = '__auto_refresh_notif_style__';
  style.textContent = `
    @keyframes arToastSlideIn {
      from { opacity: 0; transform: translateX(20px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes arToastSlideOut {
      from { opacity: 1; transform: translateX(0); }
      to { opacity: 0; transform: translateX(20px); }
    }
  `;
  if (!document.getElementById('__auto_refresh_notif_style__')) {
    document.head.appendChild(style);
  }

  document.body.appendChild(notification);

  setTimeout(() => {
    if (notification.parentElement) {
      notification.style.animation = 'arToastSlideOut 0.35s ease forwards';
      setTimeout(() => { if (notification.parentElement) notification.remove(); }, 350);
    }
  }, isError ? 6000 : 5000);
}

function showXPathNotification(msg) {
  showNotification(msg, false);
}

function showErrorNotification(msg) {
  showNotification(msg, true);
}

function showMonitorAlert() {
  const existing = document.getElementById('__auto_refresh_monitor_alert__');
  if (existing) existing.remove();

  const alert = document.createElement('div');
  alert.id = '__auto_refresh_monitor_alert__';
  alert.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    background: #ffffff;
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(245, 158, 11, 0.08);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans SC', sans-serif;
    max-width: 380px;
    animation: arToastSlideIn 0.35s ease;
  `;

  const icon = document.createElement('div');
  icon.style.cssText = `
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(245, 158, 11, 0.1);
    color: #f59e0b;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

  const content = document.createElement('div');
  content.style.cssText = 'flex: 1; min-width: 0;';

  const title = document.createElement('div');
  title.style.cssText = 'font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 4px;';
  title.textContent = '监控区域发生变化';

  const msgLine = document.createElement('div');
  msgLine.style.cssText = 'font-size: 12px; color: #64748b;';
  msgLine.textContent = '您监控的页面区域内容已更新，请查看。';

  content.appendChild(title);
  content.appendChild(msgLine);

  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'flex-shrink: 0; width: 22px; height: 22px; border: none; background: transparent; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 4px; padding: 0; transition: all 0.2s;';
  closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  closeBtn.addEventListener('click', () => alert.remove());

  alert.appendChild(icon);
  alert.appendChild(content);
  alert.appendChild(closeBtn);

  if (!document.getElementById('__auto_refresh_notif_style__')) {
    const style = document.createElement('style');
    style.id = '__auto_refresh_notif_style__';
    style.textContent = `
      @keyframes arToastSlideIn {
        from { opacity: 0; transform: translateX(20px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes arToastSlideOut {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(20px); }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(alert);

  setTimeout(() => {
    if (alert.parentElement) {
      alert.style.animation = 'arToastSlideOut 0.35s ease forwards';
      setTimeout(() => { if (alert.parentElement) alert.remove(); }, 350);
    }
  }, 8000);
}

// ===== Message Handler =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'DETECT_IFRAMES': {
      // Only top frame detects iframes (it owns the <iframe> elements)
      if (window === window.top) {
        const iframes = detectIframes();
        sendResponse({ iframes });
      }
      break;
    }

    case 'EXECUTE_XPATH_CLICK': {
      const targetFrame = msg.targetFrame || 'top';
      const isTarget = (targetFrame === 'top' && myFrameIndex === 'top') ||
                       (targetFrame !== 'top' && myFrameIndex === targetFrame);
      if (!isTarget) break;

      try {
        const result = executeXPathClick(msg.xpath);
        safeSendMessage({
          type: 'XPATH_EXEC_RESULT',
          success: true,
          xpath: msg.xpath,
          tagName: result.tag,
          textContent: result.text,
        }).catch(() => {});
        sendResponse({ success: true, element: result });
      } catch (e) {
        safeSendMessage({
          type: 'XPATH_EXEC_RESULT',
          success: false,
          xpath: msg.xpath,
          error: e.message,
        }).catch(() => {});
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'GET_XPATH_TEXT': {
      try {
        const element = findElementByXPath(msg.xpath, document);
        const text = element ? (element.textContent || '').trim() : '';
        sendResponse({ success: !!element, text });
      } catch (e) {
        sendResponse({ success: false, text: '', error: e.message });
      }
      break;
    }

    case 'MONITOR_NOTIFY': {
      if (window === window.top) {
        if (msg.voice) {
          try {
            const utterance = new SpeechSynthesisUtterance(msg.voiceMessage || '监控区域内容已发生变化');
            utterance.lang = 'zh-CN';
            utterance.rate = 1.0;
            window.speechSynthesis.speak(utterance);
          } catch (e) { /* ignore */ }
        }
        if (msg.popup) {
          showMonitorAlert();
        }
        sendResponse({ ok: true });
      }
      break;
    }

    case 'START_PICKING': {
      // All frames can start picking — user may click inside an iframe
      const targetFrame = msg.targetFrame;
      // If a specific frame is targeted, only that frame starts picker
      if (targetFrame !== undefined) {
        const isTarget = (targetFrame === 'top' && myFrameIndex === 'top') ||
                         (targetFrame !== 'top' && myFrameIndex === targetFrame);
        if (isTarget) {
          startPicker();
          sendResponse({ ok: true });
        }
      } else {
        // No specific frame — start picker in all frames (user picks anywhere)
        startPicker();
        sendResponse({ ok: true });
      }
      break;
    }

    case 'STOP_PICKING': {
      // Stop picker in all frames
      if (pickerActive) {
        stopPicker();
      }
      sendResponse({ ok: true });
      break;
    }

    case 'SHOW_XPATH_NOTIFICATION': {
      if (window === window.top) {
        showXPathNotification(msg);
        sendResponse({ ok: true });
      }
      break;
    }

    case 'SHOW_ERROR_NOTIFICATION': {
      if (window === window.top) {
        showErrorNotification(msg);
        sendResponse({ ok: true });
      }
      break;
    }

    case 'UPDATE_FLOAT_WINDOW': {
      if (window === window.top) {
        updateFloatWindow(msg);
        sendResponse({ ok: true });
      }
      break;
    }
  }

  return true;
});

// ===== Floating Window =====
let floatWindow = null;
let floatWindowInterval = null;
let floatWindowLastInterval = 60;

function getPagePositionKey() {
  try {
    // remove hash to match other cache keys
    return location.href.split('#')[0];
  } catch (e) {
    return location.href || 'unknown';
  }
}

function setFloatWindowStatus(msg = {}) {
  if (!floatWindow) return;
  const running = !!msg.running;
  const statusEl = floatWindow.querySelector('.arm-float-status');
  const countEl = floatWindow.querySelector('.arm-float-count');
  const toggleBtn = floatWindow.querySelector('[data-action="toggle-refresh"]');
  const resetBtn = floatWindow.querySelector('[data-action="reset-interval"]');
  if (typeof msg.interval === 'number' && msg.interval > 0) floatWindowLastInterval = msg.interval;
  if (statusEl) {
    // statusEl is now a small indicator circle; toggle color
    statusEl.style.background = running ? '#10b981' : '#ef4444';
    statusEl.title = running ? '运行中' : '已停止';
  }
  if (countEl) {
    if (running && typeof msg.remaining === 'number' && msg.remaining >= 0) countEl.textContent = msg.remaining + 's';
    else if (running && msg.remaining === -1) countEl.textContent = '加载中';
    else countEl.textContent = '--';
  }
  if (toggleBtn) {
    toggleBtn.dataset.running = running ? 'true' : 'false';
    // swap icon by replacing innerHTML
    toggleBtn.innerHTML = running
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    toggleBtn.style.background = running ? '#fee2e2' : '#dcfce7';
    toggleBtn.style.color = running ? '#b91c1c' : '#047857';
  }
  if (resetBtn) {
    resetBtn.title = 'Reset ' + floatWindowLastInterval + 's';
    resetBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 0-3.2 6.6"/><polyline points="21 12 21 6 15 6"/></svg>';
  }
}

function createFloatWindow() {
  if (floatWindow) return;
  // Build structured floatWindow with status light, countdown and icon buttons
  floatWindow = document.createElement('div');
  floatWindow.id = '__auto_refresh_float_window__';
  floatWindow.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;width:200px;padding:8px;background:rgba(255,255,255,0.96);border:1px solid rgba(15,23,42,0.08);border-radius:10px;box-shadow:0 6px 18px rgba(15,23,42,0.12);backdrop-filter:blur(6px);cursor:move;user-select:none;font-family:"Segoe UI","Noto Sans SC",sans-serif;font-size:11px;color:#0f172a;display:flex;align-items:center;gap:8px;';

  // Status indicator
  const statusIndicator = document.createElement('div');
  statusIndicator.className = 'arm-float-status';
  statusIndicator.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#ef4444;flex-shrink:0;box-shadow:0 0 0 4px rgba(0,0,0,0.02)';

  // Countdown
  const countEl = document.createElement('strong');
  countEl.className = 'arm-float-count';
  countEl.style.cssText = 'font-size:14px;color:#1d4ed8;min-width:36px;text-align:center;';
  countEl.textContent = '--';

  // Start/Stop button
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'arm-float-btn';
  toggleBtn.dataset.action = 'toggle-refresh';
  toggleBtn.dataset.running = 'false';
  toggleBtn.style.cssText = 'height:30px;width:34px;border:none;border-radius:8px;background:#dcfce7;color:#047857;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:4px;';
  toggleBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

  // Reset button (icon only)
  const resetBtn = document.createElement('button');
  resetBtn.className = 'arm-float-btn';
  resetBtn.dataset.action = 'reset-interval';
  resetBtn.style.cssText = 'height:30px;width:34px;border:none;border-radius:8px;background:#e0f2fe;color:#0369a1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:4px;';
  resetBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 0-3.2 6.6"/><polyline points="21 12 21 6 15 6"/></svg>';

  // Close button (disables float window)
  const closeBtn = document.createElement('button');
  closeBtn.className = 'arm-float-btn';
  closeBtn.dataset.action = 'close-float';
  closeBtn.style.cssText = 'height:30px;width:34px;border:none;border-radius:8px;background:#fee2e2;color:#b91c1c;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:4px;';
  closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  // Append in order: status - countdown - start - reset - close
  floatWindow.appendChild(statusIndicator);
  floatWindow.appendChild(countEl);
  floatWindow.appendChild(toggleBtn);
  floatWindow.appendChild(resetBtn);
  floatWindow.appendChild(closeBtn);

  document.body.appendChild(floatWindow);

  // Apply persisted position (if any)
  try {
    const key = getPagePositionKey();
    chrome.storage.local.get(['floatWindowPosition']).then(res => {
      const map = res.floatWindowPosition || {};
      const pos = map[key];
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        floatWindow.style.left = pos.left + 'px';
        floatWindow.style.top = pos.top + 'px';
        floatWindow.style.right = 'auto';
        floatWindow.style.bottom = 'auto';
      }
    }).catch(() => {});
  } catch (e) { /* ignore */ }

  // Dragging
  let isDragging = false;
  let startX, startY, initialLeft, initialTop;
  floatWindow.addEventListener('mousedown', (e) => {
    if (e.target.closest('.arm-float-btn')) return;
    isDragging = true; startX = e.clientX; startY = e.clientY;
    initialLeft = floatWindow.offsetLeft; initialTop = floatWindow.offsetTop;
    floatWindow.style.cursor = 'grabbing';
    floatWindow.style.boxShadow = '0 12px 30px rgba(15,23,42,0.22)';
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    floatWindow.style.left = (initialLeft + e.clientX - startX) + 'px';
    floatWindow.style.top = (initialTop + e.clientY - startY) + 'px';
    floatWindow.style.right = 'auto';
    floatWindow.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    if (!floatWindow) return;
    floatWindow.style.cursor = 'move';
    floatWindow.style.boxShadow = '0 8px 24px rgba(15,23,42,0.16)';
    // Persist position so page reloads don't reset it
    try {
      const left = parseInt(floatWindow.style.left, 10);
      const top = parseInt(floatWindow.style.top, 10);
      if (!isNaN(left) && !isNaN(top)) {
        const key = getPagePositionKey();
        chrome.storage.local.get(['floatWindowPosition']).then(res => {
          const map = res.floatWindowPosition || {};
          map[key] = { left, top };
          chrome.storage.local.set({ floatWindowPosition: map }).catch(() => {});
        }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
  });

  // Button handlers
  [toggleBtn, resetBtn, closeBtn].forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'toggle-refresh') {
        const running = btn.dataset.running === 'true';
        safeSendMessage({ type: running ? 'FLOAT_STOP_REFRESH' : 'FLOAT_START_REFRESH' });
      } else if (action === 'reset-interval') {
        safeSendMessage({ type: 'UPDATE_INTERVAL', interval: floatWindowLastInterval });
      } else if (action === 'close-float') {
        // Disable float window and remove DOM
        safeSendMessage({ type: 'UPDATE_FLOAT_WINDOW', floatWindowEnabled: false });
        // Clear persisted position for this page and persist floatWindow disabled in site settings
        try {
          const key = getPagePositionKey();
          // Clear position
          chrome.storage.local.get(['floatWindowPosition']).then(res => {
            const map = res.floatWindowPosition || {};
            if (map[key]) {
              delete map[key];
              chrome.storage.local.set({ floatWindowPosition: map }).catch(() => {});
            }
          }).catch(() => {});

          // Update siteSettingsCache and floatWindowCache to mark this page's floatWindow disabled
          chrome.storage.local.get(['siteSettingsCache', 'floatWindowCache']).then(res => {
            const siteSettingsCache = res.siteSettingsCache || {};
            const floatWindowCache = res.floatWindowCache || {};
            try {
              // Use full href without hash to match popup/getUrlCacheKey behavior
              const url = new URL(location.href);
              url.hash = '';
              const pageKey = url.href;
              siteSettingsCache[pageKey] = {
                ...(siteSettingsCache[pageKey] || {}),
                floatWindowEnabled: false,
              };
              floatWindowCache[pageKey] = false;
              chrome.storage.local.set({ siteSettingsCache, floatWindowCache }).catch(() => {});
            } catch (e) {
              // fallback: store under full href
              siteSettingsCache[key] = {
                ...(siteSettingsCache[key] || {}),
                floatWindowEnabled: false,
              };
              floatWindowCache[key] = false;
              chrome.storage.local.set({ siteSettingsCache, floatWindowCache }).catch(() => {});
            }
          }).catch(() => {});
        } catch (e) { /* ignore */ }
        removeFloatWindow();
      }
    });
  });
}

function removeFloatWindow() {
  if (floatWindow) { floatWindow.remove(); floatWindow = null; }
  if (floatWindowInterval) { clearInterval(floatWindowInterval); floatWindowInterval = null; }
}

function updateFloatWindow(msg) {
  if (msg.floatWindowEnabled) {
    createFloatWindow();
    setFloatWindowStatus(msg);
    if (floatWindowInterval) clearInterval(floatWindowInterval);
    floatWindowInterval = setInterval(() => {
      safeSendMessage({ type: 'GET_STATUS' }).then(status => {
        if (status && status.running) setFloatWindowStatus(status);
        else setFloatWindowStatus({ running: false, interval: floatWindowLastInterval });
      }).catch(() => setFloatWindowStatus({ running: false, interval: floatWindowLastInterval }));
    }, 1000);
  } else {
    removeFloatWindow();
  }
}

// ===== Init =====
// Notify background that content script is ready (for full refresh mode)
if (window === window.top) {
  safeSendMessage({ type: 'CONTENT_READY' });
}
