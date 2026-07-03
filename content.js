/**
 * Auto Refresh Pro - Content Script
 * Injected into all pages. Handles:
 * - XPath element clicking
 * - iframe detection
 * - XPath element picker (mouse selection)
 */

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
 * Execute click on element found by XPath
 */
function executeXPathClick(xpath, targetFrame) {
  let targetDoc = document;

  if (targetFrame !== 'top') {
    const frameIndex = parseInt(targetFrame, 10);
    const iframes = document.querySelectorAll('iframe');
    if (frameIndex >= 0 && frameIndex < iframes.length) {
      try {
        targetDoc = iframes[frameIndex].contentDocument || iframes[frameIndex].contentWindow.document;
      } catch (e) {
        throw new Error(`无法访问 iframe #${frameIndex + 1} (可能是跨域): ${e.message}`);
      }
    }
  }

  const element = findElementByXPath(xpath, targetDoc);
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
      view: (targetDoc.defaultView || window),
      clientX: x,
      clientY: y,
    });
    element.dispatchEvent(event);
  });

  // Also try native click if element supports it (may fail on CSP-restricted pages)
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

  // Send xpath back to popup via background with element info
  chrome.runtime.sendMessage({
    type: 'XPATH_PICKED',
    xpath: xpath,
    tagName: tagName,
    textContent: textContent,
  });
}

function onPickerKeyDown(e) {
  if (e.key === 'Escape' && pickerActive) {
    stopPicker();
    chrome.runtime.sendMessage({
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
  xpathOrError.textContent = isError ? (msg.xpath || msg.message || '') : (msg.xpath || '');
  xpathOrError.title = xpathOrError.textContent;

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

// ===== Message Handler =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'DETECT_IFRAMES': {
      if (window === window.top) {
        const iframes = detectIframes();
        sendResponse({ iframes });
      }
      break;
    }

    case 'EXECUTE_XPATH_CLICK': {
      try {
        const result = executeXPathClick(msg.xpath, msg.targetFrame);
        // Report result back to background (to show webpage notification)
        chrome.runtime.sendMessage({
          type: 'XPATH_EXEC_RESULT',
          success: true,
          xpath: msg.xpath,
          tagName: result.tag,
          textContent: result.text,
        }).catch(() => {});
        sendResponse({ success: true, element: result });
      } catch (e) {
        // Report failure back to background (to show error notification)
        chrome.runtime.sendMessage({
          type: 'XPATH_EXEC_RESULT',
          success: false,
          xpath: msg.xpath,
          error: e.message,
        }).catch(() => {});
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'START_PICKING': {
      if (window === window.top) {
        startPicker();
        sendResponse({ ok: true });
      }
      break;
    }

    case 'STOP_PICKING': {
      if (window === window.top) {
        stopPicker();
        sendResponse({ ok: true });
      }
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
  }

  return true;
});

// ===== Init =====
// Notify background that content script is ready (for full refresh mode)
if (window === window.top) {
  chrome.runtime.sendMessage({ type: 'CONTENT_READY' }).catch(() => {});
}
