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

/** 11-char YouTube video id from a watch/shorts/ytimg URL */
function extractYouTubeVideoId(rawUrl) {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl, 'https://www.youtube.com');
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const shorts = u.pathname.match(/^\/shorts\/([\w-]{11})/);
      if (shorts) return shorts[1];
      const embed = u.pathname.match(/^\/embed\/([\w-]{11})/);
      if (embed) return embed[1];
    }
    if (u.hostname.includes('ytimg.com')) {
      const m = u.pathname.match(/\/vi\/([\w-]{11})\//);
      if (m) return m[1];
    }
  } catch (e) {
    return null;
  }
  return null;
}

function sanitizeDownloadBasename(name) {
  const s = (name || 'thumbnail').replace(/[/\\?%*:|"<>]/g, '').trim();
  return s.slice(0, 120) || 'thumbnail';
}

/**
 * Prefer maxres poster; fall back to oEmbed thumbnail if missing or tiny placeholder.
 */
async function downloadYouTubeThumbnailToDisk(pageOrImageUrl) {
  const videoId = extractYouTubeVideoId(pageOrImageUrl);
  if (!videoId) {
    throw new Error('Could not find a YouTube video here.');
  }
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const meta = await fetchYouTubeMeta(watchUrl);
  const title = meta.title || videoId;
  const basename = sanitizeDownloadBasename(title);

  const maxresUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  const res = await fetch(maxresUrl);
  let downloadUrl = meta.thumbnail_url;
  let extension = 'jpg';

  if (res.ok) {
    const blob = await res.blob();
    const type = blob.type || '';
    if (type.startsWith('image') && blob.size > 2000) {
      // Use the real https URL here — MV3 service workers often lack URL.createObjectURL for blobs.
      await new Promise((resolve, reject) => {
        chrome.downloads.download(
          {
            url: maxresUrl,
            filename: `${basename}-thumbnail.jpg`,
            saveAs: false
          },
          (downloadId) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(downloadId);
            }
          }
        );
      });
      return;
    }
  }

  if (downloadUrl.includes('.png')) extension = 'png';
  await new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: downloadUrl,
        filename: `${basename}-thumbnail.${extension}`,
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}

function getTargetWebhookUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['targetWebhookUrl'], (items) => {
      resolve((items.targetWebhookUrl || '').trim());
    });
  });
}

async function callTargetWebhook(videoData) {
  const webhookUrl = await getTargetWebhookUrl();
  if (!webhookUrl) {
    throw new Error('Target webhook URL missing. Set it in extension Options.');
  }

  const body = [
    {
      videoURL: videoData.videoURL,
      title: videoData.title || null,
      thumbnailUrl: videoData.thumbnailUrl || null,
      outlierMultiple: videoData.outlierMultiple || null
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

  // Try to parse a useful URL from the response (optional, for making toast clickable)
  try {
    const responseData = await res.json();
    let responseUrl = null;

    if (Array.isArray(responseData) && responseData.length > 0) {
      responseUrl = responseData[0].url || responseData[0].notionUrl || responseData[0].notion_url;
    } else if (responseData) {
      responseUrl = responseData.url || responseData.notionUrl || responseData.notion_url;
      if (!responseUrl && responseData.data) {
        responseUrl = responseData.data.url || responseData.data.notionUrl || responseData.data.notion_url;
      }
    }

    return responseUrl;
  } catch (e) {
    return null;
  }
}

function showToast(tabId, message, isError = false) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    args: [message, isError],
    func: (message, isError) => {
      const existing = document.getElementById('yt-outlier-toast');
      if (existing) existing.remove();
      const el = document.createElement('div');
      el.id = 'yt-outlier-toast';
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
      setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 200);
      }, isError ? 2500 : 2000);
    }
  });
}

function removeToast(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      const existing = document.getElementById('yt-outlier-toast');
      if (existing) {
        existing.style.opacity = '0';
        setTimeout(() => existing.remove(), 200);
      }
    }
  });
}

function createMenus() {
  try { chrome.contextMenus.removeAll(); } catch (e) {}

  chrome.contextMenus.create({
    id: 'send-video-to-webhook-link',
    title: 'Send to Webhook',
    contexts: ['link'],
    targetUrlPatterns: [
      'https://www.youtube.com/watch*',
      'https://youtube.com/watch*'
    ]
  });

  chrome.contextMenus.create({
    id: 'send-video-to-webhook-page',
    title: 'Send to Webhook',
    contexts: ['page'],
    documentUrlPatterns: [
      'https://www.youtube.com/watch*',
      'https://youtube.com/watch*'
    ]
  });

  chrome.contextMenus.create({
    id: 'download-yt-thumb-link',
    title: 'Download thumbnail',
    contexts: ['link'],
    targetUrlPatterns: [
      'https://www.youtube.com/watch*',
      'https://youtube.com/watch*',
      'https://www.youtube.com/shorts/*',
      'https://youtube.com/shorts/*',
      'https://youtu.be/*'
    ]
  });

  chrome.contextMenus.create({
    id: 'download-yt-thumb-page',
    title: 'Download thumbnail',
    contexts: ['page'],
    documentUrlPatterns: [
      'https://www.youtube.com/watch*',
      'https://youtube.com/watch*',
      'https://m.youtube.com/watch*',
      'https://www.youtube.com/shorts/*',
      'https://youtube.com/shorts/*',
      'https://m.youtube.com/shorts/*'
    ]
  });

  chrome.contextMenus.create({
    id: 'download-yt-thumb-image',
    title: 'Download thumbnail',
    contexts: ['image'],
    documentUrlPatterns: [
      'https://www.youtube.com/*',
      'https://youtube.com/*',
      'https://m.youtube.com/*'
    ],
    targetUrlPatterns: ['*://*.ytimg.com/vi/*', '*://i.ytimg.com/*']
  });
}

chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (
      info.menuItemId === 'download-yt-thumb-link' ||
      info.menuItemId === 'download-yt-thumb-page' ||
      info.menuItemId === 'download-yt-thumb-image'
    ) {
      const rawUrl =
        info.menuItemId === 'download-yt-thumb-link'
          ? info.linkUrl
          : info.menuItemId === 'download-yt-thumb-page'
            ? info.pageUrl
            : info.srcUrl;
      if (!rawUrl || !tab || !tab.id) return;

      showToast(tab.id, 'Downloading thumbnail...');
      try {
        await downloadYouTubeThumbnailToDisk(rawUrl);
        removeToast(tab.id);
        showToast(tab.id, 'Thumbnail downloaded');
      } catch (e) {
        console.error('Download thumbnail error:', e);
        removeToast(tab.id);
        showToast(tab.id, e.message || 'Could not download thumbnail', true);
      }
      return;
    }

    const isLinkMenu = info.menuItemId === 'send-video-to-webhook-link';
    const isPageMenu = info.menuItemId === 'send-video-to-webhook-page';

    if (!isLinkMenu && !isPageMenu) return;

    const videoUrl = isLinkMenu ? info.linkUrl : info.pageUrl;
    if (!videoUrl || !tab || !tab.id) return;

    // Fetch title + thumbnail (using public oEmbed, no API key needed)
    let title = null;
    let thumbnailUrl = null;
    try {
      const meta = await fetchYouTubeMeta(videoUrl);
      title = meta.title || null;
      thumbnailUrl = meta.thumbnail_url || null;
    } catch (e) {
      console.log('Could not fetch video meta for webhook:', e);
    }

    let vidiqOutlier = null;
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [isLinkMenu ? info.linkUrl : null],
        func: (linkUrl) => {
          if (linkUrl) {
            const link = Array.from(document.querySelectorAll('a')).find(a => {
              const href = a.href;
              const videoIdMatch = linkUrl.match(/[?&]v=([^&]+)/);
              if (videoIdMatch) return href.includes(videoIdMatch[1]);
              return href === linkUrl || href.includes(linkUrl.split('?')[0]);
            });
            if (link) {
              let container = link.closest('yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer');
              if (container) {
                const outlier = container.querySelector('div[data-react-popover="OutlierPopover"] p');
                if (outlier && outlier.textContent) {
                  const text = outlier.textContent.trim();
                  const match = text.match(/^>?(\d+\.?\d*)x?$/);
                  if (match) {
                    const value = parseFloat(match[1]);
                    return text.startsWith('>') ? String(value + 1) : match[1];
                  }
                  return text;
                }
              }
            }
          }
          const outlierDiv = document.querySelector('div[data-react-popover="OutlierPopover"]');
          if (outlierDiv) {
            const pTag = outlierDiv.querySelector('p');
            if (pTag && pTag.textContent) {
              const text = pTag.textContent.trim();
              const match = text.match(/^>?(\d+\.?\d*)x?$/);
              if (match) {
                const value = parseFloat(match[1]);
                return text.startsWith('>') ? String(value + 1) : match[1];
              }
              return text;
            }
          }
          return null;
        }
      });
      if (result && result[0] && result[0].result) vidiqOutlier = result[0].result;
    } catch (e) {
      console.log('Could not extract outlier:', e);
    }

    let outlierMultiple = null;
    if (vidiqOutlier) {
      const num = parseFloat(vidiqOutlier);
      if (!isNaN(num)) outlierMultiple = num;
    }

    const responseUrl = await callTargetWebhook({
      videoURL: videoUrl,
      title,
      thumbnailUrl,
      outlierMultiple
    });

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: ['Sent to webhook', responseUrl],
      func: (message, url) => {
        const existing = document.getElementById('yt-outlier-toast');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.id = 'yt-outlier-toast';
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
        if (url) {
          el.style.cursor = 'pointer';
          el.style.textDecoration = 'underline';
          el.addEventListener('click', () => window.open(url, '_blank'));
        }
        document.body.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; });
        setTimeout(() => {
          el.style.opacity = '0';
          setTimeout(() => el.remove(), 200);
        }, 2200);
      }
    });
  } catch (e) {
    console.error('Context menu error:', e);
    if (tab && tab.id) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [e && e.message ? e.message : 'Failed to send to webhook'],
        func: (message) => {
          const existing = document.getElementById('yt-outlier-toast');
          if (existing) existing.remove();
          const el = document.createElement('div');
          el.id = 'yt-outlier-toast';
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
            setTimeout(() => el.remove(), 2500);
          }, 2500);
        }
      });
    }
  }
});
