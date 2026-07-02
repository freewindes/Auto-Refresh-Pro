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

  // Also try native click if element supports it
  if (typeof element.click === 'function') {
    element.click();
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

// ===== Message Handler =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'DETECT_IFRAMES': {
      // Only respond from top frame
      if (window === window.top) {
        const iframes = detectIframes();
        sendResponse({ iframes });
      }
      break;
    }

    case 'EXECUTE_XPATH_CLICK': {
      try {
        const result = executeXPathClick(msg.xpath, msg.targetFrame);
        sendResponse({ success: true, element: result });
      } catch (e) {
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
  }

  return true;
});

// ===== Init =====
// Notify background that content script is ready (for full refresh mode)
if (window === window.top) {
  chrome.runtime.sendMessage({ type: 'CONTENT_READY' }).catch(() => {});
}
