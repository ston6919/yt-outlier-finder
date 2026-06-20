// ==========================================
// OUTLIER FILTER FUNCTIONALITY
// ==========================================

// Store current filter settings
let outlierFilterEnabled = false;
let outlierMinValue = 5;
let subFilterEnabled = false;
let subMinValue = 0;
let subMaxValue = Infinity;
let viewFilterEnabled = false;
let viewMinValue = 0;
let viewMaxValue = Infinity;

const SMALL_CHANNEL_OUTLIER_MIN = 10;
const SMALL_CHANNEL_SUB_MAX = 50000;
const SMALL_CHANNEL_HIGHLIGHT_ATTR = 'data-small-channel-outlier-highlight';

// Parse subscriber count strings like "2.13M", "500K", "1.5B", "50000"
function parseSubscriberCount(text) {
  if (!text) return null;
  
  const cleaned = text
    .trim()
    .toUpperCase()
    .replace(/SUBSCRIBERS?/g, '')
    .replace(/\+/g, '')
    .replace(/,/g, '')
    .trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/);
  
  if (!match) return null;
  
  let value = parseFloat(match[1]);
  const suffix = match[2];
  
  if (suffix === 'K') {
    value *= 1000;
  } else if (suffix === 'M') {
    value *= 1000000;
  } else if (suffix === 'B') {
    value *= 1000000000;
  }
  
  return value;
}

function parseOutlierText(text) {
  if (!text) return null;

  const cleaned = text.trim();
  const match = cleaned.match(/(>?)\s*(\d+(?:\.\d+)?)\s*x\b/i);
  if (!match) return null;

  const value = parseFloat(match[2]);
  if (Number.isNaN(value)) return null;

  // Treat ">100x" as "strictly above 100"
  return match[1] === '>' ? value + 1 : value;
}

function parseViewCount(text) {
  if (!text) return null;

  const cleaned = text
    .trim()
    .toUpperCase()
    .replace(/VIEWS?/g, '')
    .replace(/\+/g, '')
    .replace(/,/g, '')
    .trim();

  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/);
  if (!match) return null;

  let value = parseFloat(match[1]);
  const suffix = match[2];

  if (suffix === 'K') {
    value *= 1000;
  } else if (suffix === 'M') {
    value *= 1000000;
  } else if (suffix === 'B') {
    value *= 1000000000;
  }

  return value;
}

// Load filter settings from storage
function loadFilterSettings() {
  chrome.storage.sync.get([
    'outlierFilterEnabled',
    'outlierMinValue',
    'subFilterEnabled',
    'subMinValue',
    'subMaxValue',
    'viewFilterEnabled',
    'viewMinValue',
    'viewMaxValue'
  ], (items) => {
    outlierFilterEnabled = items.outlierFilterEnabled || false;
    outlierMinValue = items.outlierMinValue || 5;
    subFilterEnabled = items.subFilterEnabled || false;
    subMinValue = parseSubscriberCount(items.subMinValue || '0') || 0;
    subMaxValue = items.subMaxValue ? (parseSubscriberCount(items.subMaxValue) || Infinity) : Infinity;
    viewFilterEnabled = items.viewFilterEnabled || false;
    viewMinValue = parseViewCount(items.viewMinValue || '0') || 0;
    viewMaxValue = items.viewMaxValue ? (parseViewCount(items.viewMaxValue) || Infinity) : Infinity;
    applyOutlierFilter();
  });
}

// Listen for changes to filter settings
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    if (changes.outlierFilterEnabled !== undefined) {
      outlierFilterEnabled = changes.outlierFilterEnabled.newValue || false;
    }
    if (changes.outlierMinValue !== undefined) {
      outlierMinValue = changes.outlierMinValue.newValue || 5;
    }
    if (changes.subFilterEnabled !== undefined) {
      subFilterEnabled = changes.subFilterEnabled.newValue || false;
    }
    if (changes.subMinValue !== undefined) {
      subMinValue = parseSubscriberCount(changes.subMinValue.newValue || '0') || 0;
    }
    if (changes.subMaxValue !== undefined) {
      subMaxValue = changes.subMaxValue.newValue ? (parseSubscriberCount(changes.subMaxValue.newValue) || Infinity) : Infinity;
    }
    if (changes.viewFilterEnabled !== undefined) {
      viewFilterEnabled = changes.viewFilterEnabled.newValue || false;
    }
    if (changes.viewMinValue !== undefined) {
      viewMinValue = parseViewCount(changes.viewMinValue.newValue || '0') || 0;
    }
    if (changes.viewMaxValue !== undefined) {
      viewMaxValue = changes.viewMaxValue.newValue ? (parseViewCount(changes.viewMaxValue.newValue) || Infinity) : Infinity;
    }
    applyOutlierFilter();
  }
});

// Get outlier value from a video container
function getOutlierValue(videoContainer) {
  const selectors = [
    '[data-react-popover="OutlierPopover"] p',
    '[data-react-popover="OutlierPopover"]',
    '[href*="outliers"][href*="outlier_score"] p',
    '[href*="outliers"][href*="outlier_score"]',
    '.inline-video-stats [data-react-popover*="Outlier"] p'
  ];

  for (const selector of selectors) {
    const nodes = videoContainer.querySelectorAll(selector);
    for (const node of nodes) {
      const value = parseOutlierText(node.textContent);
      if (value !== null) return value;
    }
  }

  // Fallback: search all inline stats text for a value like "1.1x" or ">100x"
  const inlineStats = videoContainer.querySelector('.inline-video-stats');
  if (inlineStats) {
    const value = parseOutlierText(inlineStats.textContent);
    if (value !== null) return value;
  }

  return null;
}

// Get subscriber count from a video container
function getSubscriberCount(videoContainer) {
  // Method 1: Use popover wrapper, then scan text nodes inside it.
  const popover = videoContainer.querySelector('[data-react-popover="SubscriberPopover"]');
  if (popover) {
    const candidates = popover.querySelectorAll('p, span, div');
    for (const candidate of candidates) {
      const parsed = parseSubscriberCount(candidate.textContent);
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  // Method 2: Find the visual badge and scan likely text elements.
  const subDiv = videoContainer.querySelector('[class*="bg-subscriber-count"]');
  if (subDiv) {
    const candidates = subDiv.querySelectorAll('p, span, div');
    for (const candidate of candidates) {
      const parsed = parseSubscriberCount(candidate.textContent);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  
  // Method 3: Find any subscriber-count class and parse descendants.
  const allSubElements = videoContainer.querySelectorAll('[class*="subscriber-count"]');
  for (const el of allSubElements) {
    const candidates = el.querySelectorAll('p, span, div');
    for (const candidate of candidates) {
      const parsed = parseSubscriberCount(candidate.textContent);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  
  return null;
}

function getViewCount(videoContainer) {
  const row = videoContainer.querySelector('.ytContentMetadataViewModelMetadataRow');
  if (row) {
    const parts = row.querySelectorAll('span, a');
    for (const part of parts) {
      const parsed = parseViewCount(part.textContent);
      if (parsed !== null) return parsed;
    }
  }

  const metadataNodes = videoContainer.querySelectorAll(
    '.ytContentMetadataViewModelMetadataText, #metadata-line span, span, a'
  );
  for (const node of metadataNodes) {
    const parsed = parseViewCount(node.textContent);
    if (parsed !== null) return parsed;
  }

  return null;
}

function shouldHighlightSmallChannelOutlier(videoContainer) {
  const outlierValue = getOutlierValue(videoContainer);
  if (outlierValue === null || outlierValue <= SMALL_CHANNEL_OUTLIER_MIN) {
    return false;
  }

  const subCount = getSubscriberCount(videoContainer);
  if (subCount === null || subCount >= SMALL_CHANNEL_SUB_MAX) {
    return false;
  }

  return true;
}

function applySmallChannelOutlierHighlight(videoContainer) {
  if (shouldHighlightSmallChannelOutlier(videoContainer)) {
    videoContainer.setAttribute(SMALL_CHANNEL_HIGHLIGHT_ATTR, 'true');
  } else {
    videoContainer.removeAttribute(SMALL_CHANNEL_HIGHLIGHT_ATTR);
  }
}

function injectSmallChannelHighlightStyles() {
  if (document.getElementById('small-channel-outlier-highlight-style')) return;

  const style = document.createElement('style');
  style.id = 'small-channel-outlier-highlight-style';
  style.textContent = `
    [${SMALL_CHANNEL_HIGHLIGHT_ATTR}="true"] {
      background-color: #fee2e2 !important;
      border-radius: 8px;
      box-shadow: inset 0 0 0 1px #fecaca;
    }

    html[dark] [${SMALL_CHANNEL_HIGHLIGHT_ATTR}="true"],
    html[dark="true"] [${SMALL_CHANNEL_HIGHLIGHT_ATTR}="true"] {
      background-color: rgba(220, 38, 38, 0.2) !important;
      box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.45);
    }
  `;
  document.documentElement.appendChild(style);
}

// Apply the outlier filter to all videos on the page
function applyOutlierFilter() {
  // Only run on YouTube
  if (!window.location.hostname.includes('youtube.com')) return;
  
  // Find all video containers (works for homepage, search, channel pages, shorts shelf, etc.)
  const videoContainers = document.querySelectorAll(
    'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model, ytd-reel-item-renderer'
  );
  
  videoContainers.forEach(container => {
    // Skip if this is inside a dismissed/hidden parent
    if (container.closest('[hidden]')) return;

    applySmallChannelOutlierHighlight(container);
    
    // Check if any filter is enabled
    const anyFilterEnabled = outlierFilterEnabled || subFilterEnabled || viewFilterEnabled;
    
    if (!anyFilterEnabled) {
      // All filters OFF - show all videos
      container.style.removeProperty('display');
      container.removeAttribute('data-filter-hidden');
    } else {
      let shouldHide = false;
      
      // Check outlier filter
      if (outlierFilterEnabled) {
        const outlierValue = getOutlierValue(container);
        if (outlierValue === null || outlierValue < outlierMinValue) {
          shouldHide = true;
        }
      }
      
      // Check subscriber filter (only if not already hidden)
      if (!shouldHide && subFilterEnabled) {
        const subCount = getSubscriberCount(container);
        // Only filter if we found subscriber data - don't hide videos without data
        if (subCount !== null) {
          if (subCount < subMinValue || subCount > subMaxValue) {
            // Outside the subscriber range
            shouldHide = true;
          }
        }
      }

      // Check views filter (only if not already hidden)
      if (!shouldHide && viewFilterEnabled) {
        const viewCount = getViewCount(container);
        // Only filter if we found views data - don't hide videos without data
        if (viewCount !== null) {
          if (viewCount < viewMinValue || viewCount > viewMaxValue) {
            shouldHide = true;
          }
        }
      }
      
      if (shouldHide) {
        container.style.setProperty('display', 'none', 'important');
        container.setAttribute('data-filter-hidden', 'true');
      } else {
        container.style.removeProperty('display');
        container.removeAttribute('data-filter-hidden');
      }
    }
  });
}

// Initialize outlier filter when on YouTube
function initOutlierFilter() {
  if (!window.location.hostname.includes('youtube.com')) return;

  injectSmallChannelHighlightStyles();
  
  // Load initial settings
  loadFilterSettings();
  
  // Watch for new videos being added to the page (infinite scroll)
  const filterObserver = new MutationObserver((mutations) => {
    // Check if any VidIQ elements were added
    let hasVidiqChanges = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            // Check if this is a video container or contains vidiq elements
            if (node.matches && (
              node.matches('ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model, ytd-reel-item-renderer') ||
              node.querySelector && (
                node.querySelector('[data-react-popover="OutlierPopover"]') ||
                node.querySelector('[data-react-popover="SubscriberPopover"]')
              )
            )) {
              hasVidiqChanges = true;
              break;
            }
            // Also check for vidiq class names
            if (node.className && typeof node.className === 'string' && node.className.includes('vidiq')) {
              hasVidiqChanges = true;
              break;
            }
          }
        }
      }
      if (hasVidiqChanges) break;
    }
    
    if (filterObserver.filterTimeout) {
      clearTimeout(filterObserver.filterTimeout);
    }
    // Use shorter timeout if vidiq changes detected, longer for general mutations
    const delay = hasVidiqChanges ? 100 : 300;
    filterObserver.filterTimeout = setTimeout(() => {
      applyOutlierFilter();
    }, delay);
  });
  
  // Start observing once body is available
  if (document.body) {
    filterObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      filterObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    });
  }
  
  // Also apply filter on navigation (YouTube is a SPA)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Apply filter multiple times after navigation to catch VidIQ loading its data
      setTimeout(applyOutlierFilter, 300);
      setTimeout(applyOutlierFilter, 600);
      setTimeout(applyOutlierFilter, 1000);
      setTimeout(applyOutlierFilter, 1500);
      setTimeout(applyOutlierFilter, 2500);
      setTimeout(applyOutlierFilter, 4000);
    }
  }).observe(document, { subtree: true, childList: true });
  
  // Apply filter periodically to catch any missed updates (every 2 seconds for first 10 seconds)
  let periodicCount = 0;
  const periodicInterval = setInterval(() => {
    applyOutlierFilter();
    periodicCount++;
    if (periodicCount >= 5) {
      clearInterval(periodicInterval);
    }
  }, 2000);
}

// Start the outlier filter
initOutlierFilter();

// ==========================================
// EXISTING FUNCTIONALITY BELOW
// ==========================================

// Helper function to show error toast
function showErrorToast(message) {
  const existing = document.getElementById('ai-news-error-toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.id = 'ai-news-error-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed !important;
    bottom: 20px !important;
    right: 20px !important;
    background: #991b1b !important;
    color: #fff !important;
    padding: 12px 16px !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 14px rgba(0,0,0,0.3) !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
    font-size: 13px !important;
    z-index: 2147483647 !important;
    max-width: 300px !important;
    opacity: 0 !important;
    transition: opacity 120ms ease-in-out !important;
    pointer-events: auto !important;
  `;
  
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

// Content script to capture the element that was right-clicked
document.addEventListener('contextmenu', (e) => {
  // Store the element that was right-clicked
  const target = e.target;
  
  // Check if it's an input, textarea, or contenteditable element
  if (target.tagName === 'INPUT' || 
      target.tagName === 'TEXTAREA' || 
      target.isContentEditable ||
      target.closest('input, textarea, [contenteditable="true"]')) {
    
    // Store the actual input/textarea element (in case we clicked on a child)
    const inputElement = target.closest('input, textarea, [contenteditable="true"]') || target;
    
    // Remove the attribute from other elements first
    document.querySelectorAll('[data-last-right-clicked]').forEach(el => {
      el.removeAttribute('data-last-right-clicked');
    });
    
    // Mark this element as the one that was right-clicked
    inputElement.setAttribute('data-last-right-clicked', 'true');
  }
}, true);

// Function to create and inject the AI News button in the modal
function createAINewsButtonInModal(modalContainer, editorElement) {
  // Check if button already exists in this modal
  if (modalContainer.querySelector('.ai-news-button')) {
    return;
  }

  // Create button element
  const button = document.createElement('button');
  button.className = 'ai-news-button';
  button.textContent = 'Write AI News';
  button.type = 'button';
  
  // Style the button - positioned near the editor area
  button.style.cssText = `
    position: absolute !important;
    bottom: 16px !important;
    right: 16px !important;
    background: #111827 !important;
    color: #fff !important;
    border: none !important;
    padding: 8px 16px !important;
    border-radius: 6px !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
    cursor: pointer !important;
    z-index: 999999 !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
    transition: background 0.2s ease !important;
    pointer-events: auto !important;
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
  `;
  
  // Hover effect
  button.addEventListener('mouseenter', () => {
    button.style.background = '#1f2937';
  });
  button.addEventListener('mouseleave', () => {
    button.style.background = '#111827';
  });
  
  // Click handler
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('[AI News Button] Button clicked!');
    console.log('[AI News Button] Editor element:', editorElement);
    
    // Mark the editor element as the target
    document.querySelectorAll('[data-last-right-clicked]').forEach(el => {
      el.removeAttribute('data-last-right-clicked');
    });
    if (editorElement) {
      editorElement.setAttribute('data-last-right-clicked', 'true');
      console.log('[AI News Button] Marked editor as target:', editorElement.className);
    } else {
      console.warn('[AI News Button] No editor element found!');
    }
    
    // Send message to background script
    try {
      // Check if extension context is still valid
      if (!chrome.runtime || !chrome.runtime.id) {
        showErrorToast('Extension context invalidated. Please reload this page and try again.');
        console.error('[AI News Button] Extension context invalidated');
        return;
      }
      
      console.log('[AI News Button] Sending message to background script...');
      chrome.runtime.sendMessage({ action: 'generate-ai-news' }, (response) => {
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message;
          console.error('[AI News Button] Error sending message:', errorMsg);
          
          if (errorMsg.includes('Extension context invalidated') || 
              errorMsg.includes('message port closed')) {
            showErrorToast('Extension was reloaded. Please refresh this page and try again.');
          } else {
            showErrorToast('Failed to connect to extension. Please try again.');
          }
        } else {
          console.log('[AI News Button] Message sent successfully, response:', response);
        }
      });
    } catch (error) {
      console.error('[AI News Button] Error sending message to background:', error);
      if (error.message && error.message.includes('Extension context invalidated')) {
        showErrorToast('Extension was reloaded. Please refresh this page and try again.');
      } else {
        showErrorToast('An error occurred. Please try again.');
      }
    }
  });
  
  // Make sure the modal container is relatively positioned
  const computedStyle = window.getComputedStyle(modalContainer);
  if (computedStyle.position === 'static' || computedStyle.position === '') {
    modalContainer.style.position = 'relative';
  }
  
  // Append button to the modal container
  modalContainer.appendChild(button);
  console.log('[AI News Button] Added button to modal container');
}

// Function to find and add buttons to modals
function addButtonsToModals() {
  // Make sure body exists
  if (!document.body) {
    return;
  }

  // Look for the Skool post creation modal
  // Based on the HTML structure: div with class containing "PostBodyWrapper"
  const postBodyWrapper = document.querySelector('[class*="PostBodyWrapper"]');
  
  if (postBodyWrapper) {
    // Check if we've already added a button to this modal
    if (postBodyWrapper.dataset.aiNewsButtonAdded) {
      return;
    }
    
    // Find the Skool editor inside this modal
    const skoolEditor = postBodyWrapper.querySelector('.skool-editor, .tiptap.ProseMirror.skool-editor, [contenteditable="true"].tiptap.ProseMirror');
    
    if (skoolEditor) {
      console.log('[AI News Button] Found Skool post modal with editor');
      postBodyWrapper.dataset.aiNewsButtonAdded = 'true';
      createAINewsButtonInModal(postBodyWrapper, skoolEditor);
      return;
    }
  }
  
  // Fallback: Look for any modal/dialog that contains a Skool editor
  const allModals = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="Dialog"]');
  
  for (const modal of allModals) {
    if (modal.dataset.aiNewsButtonAdded) {
      continue;
    }
    
    const skoolEditor = modal.querySelector('.skool-editor, .tiptap.ProseMirror.skool-editor, [contenteditable="true"].tiptap.ProseMirror');
    
    if (skoolEditor) {
      console.log('[AI News Button] Found modal with Skool editor');
      modal.dataset.aiNewsButtonAdded = 'true';
      createAINewsButtonInModal(modal, skoolEditor);
      return;
    }
  }
  
  // Last resort: Look for Skool editor anywhere and find its container
  const skoolEditor = document.querySelector('.skool-editor, .tiptap.ProseMirror.skool-editor');
  
  if (skoolEditor) {
    // Find a suitable container (look for PostBodyWrapper or similar)
    let container = skoolEditor.closest('[class*="PostBodyWrapper"]') || 
                    skoolEditor.closest('[class*="PostBody"]') ||
                    skoolEditor.closest('[role="dialog"]') ||
                    skoolEditor.closest('[class*="modal"]') ||
                    skoolEditor.parentElement;
    
    if (container && !container.dataset.aiNewsButtonAdded) {
      console.log('[AI News Button] Found Skool editor, adding button to container');
      container.dataset.aiNewsButtonAdded = 'true';
      createAINewsButtonInModal(container, skoolEditor);
    }
  }
}

// Function to initialize the observer
function initializeObserver() {
  if (!document.body) {
    // Wait for body to be available
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeObserver);
    } else {
      // Use a small delay to wait for body
      setTimeout(initializeObserver, 10);
    }
    return;
  }

  console.log('[AI News Button] Initializing observer');
  
  // Initial scan with a small delay to let page load
  setTimeout(() => {
    addButtonsToModals();
  }, 500);

  // Watch for dynamically added modals
  const observer = new MutationObserver(() => {
    // Debounce to avoid too many calls
    if (observer.timeout) {
      clearTimeout(observer.timeout);
    }
    observer.timeout = setTimeout(() => {
      addButtonsToModals();
    }, 300);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Also try again after a longer delay for slow-loading pages
  setTimeout(() => {
    console.log('[AI News Button] Delayed scan');
    addButtonsToModals();
  }, 2000);
}

// Start initialization
initializeObserver();

