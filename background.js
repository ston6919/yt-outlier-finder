const YT_OEMBED = 'https://www.youtube.com/oembed';

function fetchYouTubeMeta(youtubeUrl) {
  const url = new URL(YT_OEMBED);
  url.searchParams.set('url', youtubeUrl);
  url.searchParams.set('format', 'json');
  return fetch(url.toString()).then((r) => {
    if (!r.ok) throw new Error('Failed to fetch video details');
    return r.json();
  });
}

function getNotionConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['notionToken', 'databaseId'], (items) => {
      resolve({ notionToken: items.notionToken || '', databaseId: items.databaseId || '' });
    });
  });
}

function getWebhookUrls() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['inspirationWebhookUrl', 'newsWebhookUrl'], (items) => {
      resolve({
        inspirationWebhookUrl: (items.inspirationWebhookUrl || '').trim(),
        newsWebhookUrl: (items.newsWebhookUrl || '').trim()
      });
    });
  });
}

async function callWebhook(videoUrl, outlierMultiple) {
  const { inspirationWebhookUrl } = await getWebhookUrls();
  if (!inspirationWebhookUrl) {
    throw new Error('Inspiration webhook URL missing. Set it in extension Options.');
  }
  const webhookUrl = inspirationWebhookUrl;
  const body = [
    {
      videoURL: videoUrl,
      outlierMultiple: outlierMultiple || null
    }
  ];

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Webhook error (${res.status}): ${err || res.statusText}`);
  }

  // Parse response to extract Notion URL
  try {
    const responseData = await res.json();
    // Handle various response formats:
    // - { notionUrl: "..." }
    // - { url: "..." }
    // - [{ notionUrl: "..." }] (array response)
    // - { data: { notionUrl: "..." } }
    let notionUrl = null;
    
    if (Array.isArray(responseData) && responseData.length > 0) {
      notionUrl = responseData[0].notionUrl || responseData[0].url || responseData[0].notion_url;
    } else if (responseData) {
      notionUrl = responseData.notionUrl || responseData.url || responseData.notion_url;
      if (!notionUrl && responseData.data) {
        notionUrl = responseData.data.notionUrl || responseData.data.url || responseData.data.notion_url;
      }
    }
    
    return notionUrl;
  } catch (e) {
    // If response is not JSON or parsing fails, return null
    return null;
  }
}

async function addToNotion({ title, thumbnailUrl, videoUrl, vidiqOutlier, overrideDatabaseId }) {
  const { notionToken, databaseId: configDatabaseId } = await getNotionConfig();
  const targetDatabaseId = overrideDatabaseId || configDatabaseId;
  
  if (!notionToken || !targetDatabaseId) throw new Error('Notion settings missing. Set them in Options.');

  const children = [
    { object: 'block', type: 'image', image: { type: 'external', external: { url: thumbnailUrl } } }
  ];

  const body = {
    parent: { database_id: targetDatabaseId },
    properties: {
      Title: { title: [{ text: { content: title } }] },
      image: {
        files: [
          {
            name: 'Thumbnail',
            type: 'external',
            external: { url: thumbnailUrl }
          }
        ]
      }
    },
    cover: { type: 'external', external: { url: thumbnailUrl } },
    children: children
  };

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Notion API error (${res.status}): ${err || res.statusText}`);
  }
}

async function callNewsWebhook() {
  const { newsWebhookUrl } = await getWebhookUrls();
  if (!newsWebhookUrl) {
    throw new Error('Daily AI News webhook URL missing. Set it in extension Options.');
  }
  const webhookUrl = newsWebhookUrl;

  const res = await fetch(webhookUrl, {
    method: 'GET'
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Webhook error (${res.status}): ${err || res.statusText}`);
  }

  // Get the response as text first to see what we're dealing with
  const responseText = await res.text().catch(() => '');
  
  if (!responseText) {
    throw new Error('Webhook returned empty response');
  }

  try {
    // Try to parse as JSON
    const responseData = JSON.parse(responseText);
    
    // Validate response format - should have a "text" property
    if (responseData && typeof responseData.text === 'string') {
      return responseData.text;
    } else {
      // Log what we actually got for debugging
      console.error('[Background] Unexpected response format:', responseData);
      throw new Error(`Invalid response format. Expected object with 'text' property, got: ${JSON.stringify(responseData).substring(0, 200)}`);
    }
  } catch (e) {
    // If it's already our custom error, re-throw it
    if (e.message && (e.message.includes('Invalid response format') || e.message.includes('Webhook returned empty'))) {
      throw e;
    }
    
    // If JSON parsing failed, maybe the response is plain text?
    // Check if it looks like plain text (not JSON)
    if (responseText && !responseText.trim().startsWith('{') && !responseText.trim().startsWith('[')) {
      console.log('[Background] Response appears to be plain text, returning as-is');
      return responseText;
    }
    
    // Otherwise, log the error and response for debugging
    console.error('[Background] Failed to parse webhook response as JSON:', e);
    console.error('[Background] Response text (first 500 chars):', responseText.substring(0, 500));
    throw new Error(`Failed to parse webhook response: ${e.message}. Response preview: ${responseText.substring(0, 100)}`);
  }
}

// Get infographic settings from storage
function getInfographicConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['geminiApiKey', 'infographicPrompt', 'nanoBananaModel', 'imageAspectRatio', 'imageQuality'], (syncItems) => {
      // Also get reference image from local storage
      chrome.storage.local.get(['referenceImage', 'referenceImageMimeType'], (localItems) => {
        resolve({
          apiKey: syncItems.geminiApiKey || '',
          promptTemplate: syncItems.infographicPrompt || 'Create a professional news infographic about: {text}',
          model: syncItems.nanoBananaModel || 'gemini-2.5-flash-image',
          aspectRatio: syncItems.imageAspectRatio || '1:1',
          imageSize: syncItems.imageQuality || '1K',
          referenceImage: localItems.referenceImage || null,
          referenceImageMimeType: localItems.referenceImageMimeType || 'image/png'
        });
      });
    });
  });
}

// Generate infographic using Gemini API
async function generateInfographic(selectedText, config) {
  const { apiKey, promptTemplate, model, aspectRatio, imageSize, referenceImage, referenceImageMimeType } = config;
  
  // Combine prompt template with selected text
  const basePrompt = promptTemplate.replace('{text}', selectedText);
  
  // Add today's date
  const today = new Date();
  const dateString = today.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  // Build the final prompt
  let combinedPrompt = `${basePrompt}\n\nToday's date is ${dateString}.`;
  
  // Add reference image instructions if a reference image is provided
  if (referenceImage) {
    combinedPrompt = `CRITICAL INSTRUCTIONS - YOU MUST FOLLOW ALL OF THESE:

RULE 1 - USE ONLY THE NEWS CONTENT I PROVIDE:
- You MUST use ONLY the exact news stories and information provided below.
- DO NOT make up, invent, or fabricate any news stories or facts.
- DO NOT add any information that is not explicitly stated in the content I provide.
- The text I provide is the ONLY source of truth for the infographic content.

RULE 2 - REFERENCE IMAGE USAGE:
- I am providing a REFERENCE IMAGE below. DO NOT edit, modify, or return this reference image.
- Use the reference image ONLY as a STYLE GUIDE for the visual design, layout, colors, and aesthetic.
- Create a COMPLETELY NEW and ORIGINAL image that matches the style but contains the news content I provide.

HERE IS THE EXACT NEWS CONTENT TO USE (do not change or add to this):
---
${basePrompt}
---

Today's date is ${dateString}.

The image attached below is the STYLE REFERENCE ONLY - do not edit it or return it:`;
  } else {
    // Even without reference image, emphasize using only provided content
    combinedPrompt = `IMPORTANT: Use ONLY the following news content to create the infographic. DO NOT make up or invent any additional news stories or facts.

${basePrompt}

Today's date is ${dateString}.`;
  }
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  // Build the parts array - text first, then optional reference image
  const parts = [{ text: combinedPrompt }];
  
  // Add reference image if provided
  if (referenceImage) {
    parts.push({
      inlineData: {
        mimeType: referenceImageMimeType,
        data: referenceImage
      }
    });
  }
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: parts
      }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"]
      }
    })
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini API error (${res.status}): ${err || res.statusText}`);
  }

  const responseData = await res.json();
  
  // Extract image data from response
  if (!responseData.candidates || !responseData.candidates[0] || !responseData.candidates[0].content) {
    throw new Error('Invalid response from Gemini API');
  }

  const responseParts = responseData.candidates[0].content.parts;
  for (const part of responseParts) {
    if (part.inlineData && part.inlineData.data) {
      return {
        imageData: part.inlineData.data,
        mimeType: part.inlineData.mimeType || 'image/png'
      };
    }
  }

  throw new Error('No image data in response');
}

// Download image from base64 data
function downloadImage(imageData, mimeType) {
  return new Promise((resolve, reject) => {
    // Create data URL from base64
    const dataUrl = `data:${mimeType};base64,${imageData}`;
    
    // Generate filename with timestamp
    const extension = mimeType.includes('jpeg') ? 'jpg' : 'png';
    const filename = `infographic-${Date.now()}.${extension}`;
    
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}

function showToast(tabId, message, isError = false, isLoading = false) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    args: [message, isError, isLoading],
    func: (message, isError, isLoading) => {
      const existing = document.getElementById('ai-news-toast');
      if (existing) existing.remove();
      const el = document.createElement('div');
      el.id = 'ai-news-toast';
      el.textContent = message;
      el.style.position = 'fixed';
      el.style.bottom = '20px';
      el.style.right = '20px';
      el.style.background = isError ? '#991b1b' : '#111827';
      el.style.color = '#fff';
      el.style.padding = '10px 12px';
      el.style.borderRadius = '8px';
      el.style.boxShadow = '0 4px 14px rgba(0,0,0,0.3)';
      el.style.fontFamily = '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
      el.style.fontSize = '12px';
      el.style.zIndex = '2147483647';
      el.style.opacity = '0';
      el.style.transition = 'opacity 120ms ease-in-out';
      document.body.appendChild(el);
      requestAnimationFrame(() => { el.style.opacity = '1'; });
      
      // Only auto-remove if not loading
      if (!isLoading) {
        setTimeout(() => {
          el.style.opacity = '0';
          setTimeout(() => el.remove(), 200);
        }, isError ? 2500 : 2000);
      }
    }
  });
}

function removeToast(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      const existing = document.getElementById('ai-news-toast');
      if (existing) {
        existing.style.opacity = '0';
        setTimeout(() => existing.remove(), 200);
      }
    }
  });
}

// Shared function to insert news text into an input field
function insertNewsText(tabId, newsText) {
  return chrome.scripting.executeScript({
    target: { tabId: tabId },
    args: [newsText],
    func: (text) => {
      // Debug: Comprehensive logging for line break debugging
      console.log('=== AI NEWS DEBUG START ===');
      console.log('1. Raw text received:', JSON.stringify(text));
      console.log('2. Text length:', text.length);
      console.log('3. Contains \\n:', text.includes('\n'));
      console.log('4. Contains \\r:', text.includes('\r'));
      console.log('5. Contains \\r\\n:', text.includes('\r\n'));
      
      // Show character codes for first 200 chars to see what's actually there
      const sample = text.substring(0, 200);
      const charCodes = Array.from(sample).map((char, idx) => {
        const code = char.charCodeAt(0);
        if (code === 10) return `[\\n at ${idx}]`;
        if (code === 13) return `[\\r at ${idx}]`;
        return char;
      }).join('');
      console.log('6. First 200 chars with newline markers:', charCodes);
      
      // Find the input element that was right-clicked (marked by content script)
      let targetInput = document.querySelector('[data-last-right-clicked]');
      
      // Fallback: try active element or find any input/textarea
      if (!targetInput) {
        if (document.activeElement && 
            (document.activeElement.tagName === 'INPUT' || 
             document.activeElement.tagName === 'TEXTAREA' ||
             document.activeElement.isContentEditable)) {
          targetInput = document.activeElement;
        } else {
          // Last resort: find the first visible input/textarea
          const allInputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
          targetInput = allInputs.find(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        }
      }
      
      if (targetInput) {
        // Remove the data attribute if it exists
        targetInput.removeAttribute('data-last-right-clicked');
        
        // Debug: log the element type
        console.log('7. Target element type:', targetInput.tagName, 'ContentEditable:', targetInput.isContentEditable);
        console.log('8. Element ID:', targetInput.id, 'Element class:', targetInput.className);
        
        if (targetInput.isContentEditable) {
          // Handle contenteditable divs - check if it's TipTap/ProseMirror
          const isTipTap = targetInput.classList.contains('ProseMirror') || 
                           targetInput.classList.contains('tiptap') ||
                           targetInput.closest('.ProseMirror') ||
                           targetInput.closest('.tiptap');
          
          // Normalize line breaks (handle \r\n, \r, and \n)
          const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          console.log('9. Normalized text:', JSON.stringify(normalizedText));
          console.log('10. Is TipTap/ProseMirror:', isTipTap);
          
          if (isTipTap) {
            // For TipTap/ProseMirror editors, insert text line by line
            targetInput.focus();
            
            // Move cursor to end
            try {
              const selection = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(targetInput);
              range.collapse(false); // Move to end
              selection.removeAllRanges();
              selection.addRange(range);
            } catch (e) {
              console.log('Could not set cursor position, continuing...');
            }
            
            const lines = normalizedText.split('\n');
            console.log('11. Number of lines:', lines.length);
            
            // Insert text line by line using insertText command
            for (let i = 0; i < lines.length; i++) {
              if (lines[i]) {
                // Insert the line text
                document.execCommand('insertText', false, lines[i]);
              }
              // If not the last line, insert a newline using insertParagraph
              if (i < lines.length - 1) {
                // Use insertParagraph to create a new line (works better with TipTap)
                document.execCommand('insertParagraph', false);
              }
            }
            
            console.log('12. Final innerHTML after insertion:', targetInput.innerHTML.substring(0, 200));
          } else {
            // For regular contenteditable, use the original method
            const lines = normalizedText.split('\n');
            console.log('11. Number of lines after split:', lines.length);
            const selection = window.getSelection();
            
            if (selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              range.deleteContents();
              
              // Insert text with line breaks
              for (let i = 0; i < lines.length; i++) {
                if (lines[i]) {
                  range.insertNode(document.createTextNode(lines[i]));
                }
                if (i < lines.length - 1) {
                  const br = document.createElement('br');
                  range.insertNode(br);
                }
              }
              
              // Move cursor to end
              range.collapse(false);
              selection.removeAllRanges();
              selection.addRange(range);
            } else {
              // Fallback: append to end
              const fragment = document.createDocumentFragment();
              for (let i = 0; i < lines.length; i++) {
                if (lines[i]) {
                  fragment.appendChild(document.createTextNode(lines[i]));
                }
                if (i < lines.length - 1) {
                  fragment.appendChild(document.createElement('br'));
                }
              }
              targetInput.appendChild(fragment);
            }
            console.log('12. Final innerHTML after insertion:', targetInput.innerHTML.substring(0, 200));
          }
          
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
          targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (targetInput.tagName === 'TEXTAREA') {
          // Handle textarea - newlines work natively
          // Normalize line breaks to ensure they're proper \n characters
          const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          console.log('9. Normalized text:', JSON.stringify(normalizedText));
          console.log('10. Number of \\n in normalized text:', (normalizedText.match(/\n/g) || []).length);
          const start = targetInput.selectionStart || 0;
          const end = targetInput.selectionEnd || 0;
          const currentValue = targetInput.value || '';
          
          // Insert text at cursor position (newlines preserved)
          const newValue = currentValue.slice(0, start) + normalizedText + currentValue.slice(end);
          targetInput.value = newValue;
          console.log('11. Final value after insertion (first 200 chars):', JSON.stringify(newValue.substring(0, 200)));
          console.log('12. Number of \\n in final value:', (newValue.match(/\n/g) || []).length);
          
          // Trigger input event to notify any listeners
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
          targetInput.dispatchEvent(new Event('change', { bubbles: true }));
          
          // Set cursor position after inserted text
          const newPosition = start + normalizedText.length;
          targetInput.setSelectionRange(newPosition, newPosition);
        } else {
          // Handle regular input - newlines won't display but we preserve them
          // Normalize line breaks
          const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          console.log('9. Normalized text:', JSON.stringify(normalizedText));
          console.log('10. Number of \\n in normalized text:', (normalizedText.match(/\n/g) || []).length);
          const start = targetInput.selectionStart || 0;
          const end = targetInput.selectionEnd || 0;
          const currentValue = targetInput.value || '';
          
          // Insert text at cursor position (newlines preserved in value)
          const newValue = currentValue.slice(0, start) + normalizedText + currentValue.slice(end);
          targetInput.value = newValue;
          console.log('11. Final value after insertion (first 200 chars):', JSON.stringify(newValue.substring(0, 200)));
          console.log('12. Number of \\n in final value:', (newValue.match(/\n/g) || []).length);
          console.log('13. NOTE: Regular INPUT elements do not display line breaks visually!');
          
          // Trigger input event to notify any listeners
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
          targetInput.dispatchEvent(new Event('change', { bubbles: true }));
          
          // Set cursor position after inserted text
          const newPosition = start + normalizedText.length;
          targetInput.setSelectionRange(newPosition, newPosition);
        }
        targetInput.focus();
        console.log('=== AI NEWS DEBUG END ===');
      } else {
        console.log('ERROR: No target input element found!');
        console.log('=== AI NEWS DEBUG END ===');
      }
    }
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message);
  
  if (message.action === 'generate-ai-news') {
    console.log('[Background] Processing generate-ai-news request');
    
    // Get the sender's tab
    if (!sender.tab || !sender.tab.id) {
      console.error('[Background] No sender tab found');
      sendResponse({ success: false, error: 'No sender tab found' });
      return false;
    }
    
    const tabId = sender.tab.id;
    console.log('[Background] Tab ID:', tabId);
    
    // Show loading toast
    showToast(tabId, 'Generating Daily AI News...', false, true);
    console.log('[Background] Showed loading toast');
    
    // Call webhook and insert text
    callNewsWebhook()
      .then(newsText => {
        console.log('[Background] Received news text, length:', newsText.length);
        removeToast(tabId);
        return insertNewsText(tabId, newsText);
      })
      .then(() => {
        console.log('[Background] Successfully inserted news text');
        sendResponse({ success: true });
      })
      .catch(e => {
        console.error('[Background] AI News generation error:', e);
        console.error('[Background] Error stack:', e.stack);
        removeToast(tabId);
        showToast(tabId, 'There is an error', true);
        sendResponse({ success: false, error: e.message });
      });
    
    return true; // Indicates we will send a response asynchronously
  }
});

function createMenus() {
  try { chrome.contextMenus.removeAll(); } catch (e) {}

  // Right-click on any YouTube link
  chrome.contextMenus.create({
    id: 'yt-link-to-notion',
    title: 'Add To Notion As Inspiration',
    contexts: ['link'],
    targetUrlPatterns: [
      'https://www.youtube.com/watch*',
      'https://youtube.com/watch*'
    ]
  });

  // Save thumbnail for YouTube links
  chrome.contextMenus.create({
    id: 'save-thumb-to-notion',
    title: 'Save thumbnail',
    contexts: ['link'],
    targetUrlPatterns: [
      'https://www.youtube.com/watch*',
      'https://youtube.com/watch*'
    ]
  });

  // Right-click on a YouTube watch page background
  chrome.contextMenus.create({
    id: 'yt-current-to-notion',
    title: 'Add To Notion As Inspiration',
    contexts: ['page'],
    documentUrlPatterns: [
      'https://www.youtube.com/watch*',
      'https://youtube.com/watch*'
    ]
  });

  // Save thumbnail for current YouTube page
  chrome.contextMenus.create({
    id: 'save-thumb-current-to-notion',
    title: 'Save thumbnail',
    contexts: ['page'],
    documentUrlPatterns: [
      'https://www.youtube.com/watch*',
      'https://youtube.com/watch*'
    ]
  });

  // Right-click on text input elements
  chrome.contextMenus.create({
    id: 'generate-ai-news',
    title: 'Generate Daily AI News',
    contexts: ['editable']
  });

  // Right-click on selected text to create infographic
  chrome.contextMenus.create({
    id: 'create-news-infographic',
    title: 'Create News Infographic',
    contexts: ['selection']
  });
}

chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    // Handle "Save thumbnail" feature with hardcoded database ID
    if (info.menuItemId === 'save-thumb-to-notion' || info.menuItemId === 'save-thumb-current-to-notion') {
      const videoUrl = info.menuItemId === 'save-thumb-to-notion' ? info.linkUrl : info.pageUrl;
      if (!videoUrl || !tab || !tab.id) return;

      const HARDCODED_DB_ID = '246e6dd2d52980d0acb1ebc43eeaabe1';
      showToast(tab.id, 'Saving thumbnail...', false, true);

      try {
        const meta = await fetchYouTubeMeta(videoUrl);
        await addToNotion({
          title: meta.title || 'Untitled Video',
          thumbnailUrl: meta.thumbnail_url,
          videoUrl: videoUrl,
          overrideDatabaseId: HARDCODED_DB_ID
        });
        removeToast(tab.id);
        showToast(tab.id, 'Thumbnail saved to Notion!');
      } catch (e) {
        console.error('Save thumbnail error:', e);
        removeToast(tab.id);
        showToast(tab.id, e.message || 'Failed to save thumbnail', true);
      }
      return;
    }

    // Handle Create News Infographic
    if (info.menuItemId === 'create-news-infographic') {
      if (!tab || !tab.id) return;
      
      const selectedText = info.selectionText;
      if (!selectedText || !selectedText.trim()) {
        showToast(tab.id, 'No text selected', true);
        return;
      }

      // Get settings
      const config = await getInfographicConfig();
      
      if (!config.apiKey) {
        showToast(tab.id, 'Please set your API key in extension settings', true);
        return;
      }

      // Show loading toast
      showToast(tab.id, 'Generating infographic...', false, true);

      try {
        // Generate image
        const { imageData, mimeType } = await generateInfographic(selectedText, config);
        
        // Download the image
        await downloadImage(imageData, mimeType);
        
        // Remove loading toast and show success
        removeToast(tab.id);
        showToast(tab.id, 'Infographic downloaded!');
      } catch (e) {
        console.error('Infographic generation error:', e);
        removeToast(tab.id);
        showToast(tab.id, e.message || 'Failed to generate infographic', true);
      }
      return;
    }

    // Handle AI News generation
    if (info.menuItemId === 'generate-ai-news') {
      if (!tab || !tab.id) return;
      
      // Show loading toast
      showToast(tab.id, 'Generating Daily AI News...', false, true);
      
      try {
        const newsText = await callNewsWebhook();
        
        // Remove loading toast
        removeToast(tab.id);
        
        // Use shared function to insert text
        await insertNewsText(tab.id, newsText);
      } catch (e) {
        console.error('AI News generation error:', e);
        
        // Remove loading toast first
        removeToast(tab.id);
        
        // Log error details to the page console for debugging
        const errorMessage = e && e.message ? e.message : String(e);
        const errorStack = e && e.stack ? e.stack : '';
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          args: [errorMessage, errorStack],
          func: (message, stack) => {
            console.error('AI News Generation Error:', message);
            if (stack) {
              console.error('Error stack:', stack);
            }
          }
        });
        
        showToast(tab.id, 'There is an error', true);
      }
      return;
    }
    
    const videoUrl = info.menuItemId === 'yt-link-to-notion' ? info.linkUrl : info.pageUrl;
    if (!videoUrl) return;
    
    // Extract VidIQ outlier value from the page DOM
    let vidiqOutlier = null;
    if (tab && tab.id) {
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          args: [info.menuItemId === 'yt-link-to-notion' ? info.linkUrl : null],
          func: (linkUrl) => {
            // If clicking on a link, find the outlier near that specific link
            if (linkUrl) {
              const link = Array.from(document.querySelectorAll('a')).find(a => {
                const href = a.href;
                // Match the video ID from the URL
                const videoIdMatch = linkUrl.match(/[?&]v=([^&]+)/);
                if (videoIdMatch) {
                  return href.includes(videoIdMatch[1]);
                }
                return href === linkUrl || href.includes(linkUrl.split('?')[0]);
              });
              
              if (link) {
                // Traverse up to find the video container
                let container = link.closest('yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer');
                if (container) {
                  // Look for OutlierPopover within this specific container
                  const outlier = container.querySelector('div[data-react-popover="OutlierPopover"] p');
                  if (outlier && outlier.textContent) {
                    const text = outlier.textContent.trim();
                    // Match patterns like "57x", "9.7x", ">100x", ">1000x", etc.
                    const match = text.match(/^>?(\d+\.?\d*)x?$/);
                    if (match) {
                      // If starts with ">", add 1 to the value to indicate it's "greater than"
                      const value = parseFloat(match[1]);
                      if (text.startsWith('>')) {
                        return String(value + 1);
                      }
                      return match[1]; // Return just the number part
                    }
                    return text;
                  }
                }
              }
            }
            
            // Fallback: if on a watch page, try to find any outlier
            const outlierDiv = document.querySelector('div[data-react-popover="OutlierPopover"]');
            if (outlierDiv) {
              const pTag = outlierDiv.querySelector('p');
              if (pTag && pTag.textContent) {
                const text = pTag.textContent.trim();
                // Match patterns like "57x", "9.7x", ">100x", ">1000x", etc.
                const match = text.match(/^>?(\d+\.?\d*)x?$/);
                if (match) {
                  // If starts with ">", add 1 to the value
                  const value = parseFloat(match[1]);
                  if (text.startsWith('>')) {
                    return String(value + 1);
                  }
                  return match[1]; // Return just the number part
                }
                return text;
              }
            }
            
            return null;
          }
        });
        if (result && result[0] && result[0].result) {
          vidiqOutlier = result[0].result;
        }
      } catch (e) {
        console.log('Could not extract VidIQ value:', e);
        // Continue without VidIQ value
      }
    }
    
    // Extract numeric value from outlier (e.g., "9.7" or "57" -> 9.7 or 57)
    let outlierMultiple = null;
    if (vidiqOutlier) {
      // The function now returns just the number part, so parse it directly
      const numValue = parseFloat(vidiqOutlier);
      if (!isNaN(numValue)) {
        outlierMultiple = numValue;
      }
    }
    
    // Call webhook with video URL and outlier multiple
    const notionUrl = await callWebhook(videoUrl, outlierMultiple);
    
    if (tab && tab.id) {
      // Inject a lightweight toast into the page
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: ['Added to Inspiration', notionUrl],
        func: (message, url) => {
          const existing = document.getElementById('yt2notion-toast');
          if (existing) existing.remove();
          const el = document.createElement('div');
          el.id = 'yt2notion-toast';
          el.textContent = message;
          el.style.position = 'fixed';
          el.style.bottom = '20px';
          el.style.right = '20px';
          el.style.background = '#111827';
          el.style.color = '#fff';
          el.style.padding = '10px 12px';
          el.style.borderRadius = '8px';
          el.style.boxShadow = '0 4px 14px rgba(0,0,0,0.3)';
          el.style.fontFamily = '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
          el.style.fontSize = '12px';
          el.style.zIndex = '2147483647';
          el.style.opacity = '0';
          el.style.transition = 'opacity 120ms ease-in-out';
          
          // Make it clickable if we have a Notion URL
          if (url) {
            el.style.cursor = 'pointer';
            el.style.textDecoration = 'underline';
            el.addEventListener('click', () => {
              window.open(url, '_blank');
            });
            el.addEventListener('mouseenter', () => {
              el.style.background = '#1f2937';
            });
            el.addEventListener('mouseleave', () => {
              el.style.background = '#111827';
            });
          }
          
          document.body.appendChild(el);
          requestAnimationFrame(() => { el.style.opacity = '1'; });
          setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 200);
          }, 2000);
        }
      });
    }
  } catch (e) {
    console.error('Context menu handler error:', e);
    if (tab && tab.id) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [e && e.message ? e.message : 'Failed to send to webhook'],
        func: (message) => {
          const existing = document.getElementById('yt2notion-toast');
          if (existing) existing.remove();
          const el = document.createElement('div');
          el.id = 'yt2notion-toast';
          el.textContent = message;
          el.style.position = 'fixed';
          el.style.bottom = '20px';
          el.style.right = '20px';
          el.style.background = '#991b1b';
          el.style.color = '#fff';
          el.style.padding = '10px 12px';
          el.style.borderRadius = '8px';
          el.style.boxShadow = '0 4px 14px rgba(0,0,0,0.3)';
          el.style.fontFamily = '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
          el.style.fontSize = '12px';
          el.style.zIndex = '2147483647';
          el.style.opacity = '0';
          el.style.transition = 'opacity 120ms ease-in-out';
          document.body.appendChild(el);
          requestAnimationFrame(() => { el.style.opacity = '1'; });
          setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 200);
          }, 2500);
        }
      });
    }
  }
});


