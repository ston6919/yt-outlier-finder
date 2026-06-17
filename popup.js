const YT_OEMBED = 'https://www.youtube.com/oembed';

function extractYouTubeUrlCandidate(raw) {
  if (!raw) return '';
  return raw.trim();
}

async function fetchYouTubeMeta(youtubeUrl) {
  const url = new URL(YT_OEMBED);
  url.searchParams.set('url', youtubeUrl);
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Failed to fetch video details');
  return res.json();
}

function setMessage(text, isError = false) {
  const msg = document.getElementById('message');
  msg.textContent = text;
  msg.style.color = isError ? '#b91c1c' : '#374151';
}

async function sendToTargetWebhook(videoData) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['targetWebhookUrl'], async (items) => {
      const webhookUrl = (items.targetWebhookUrl || '').trim();
      if (!webhookUrl) {
        reject(new Error('Target webhook URL missing. Set it in Options.'));
        return;
      }

      const body = [
        {
          videoURL: videoData.videoURL,
          title: videoData.title || null,
          thumbnailUrl: videoData.thumbnailUrl || null,
          outlierMultiple: null
        }
      ];

      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          const err = await res.text().catch(() => '');
          reject(new Error(`Webhook error (${res.status}): ${err || res.statusText}`));
          return;
        }

        // Try to extract a useful URL from response for clickable toast
        let responseUrl = null;
        try {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            responseUrl = data[0].url || data[0].notionUrl || data[0].notion_url;
          } else if (data) {
            responseUrl = data.url || data.notionUrl || data.notion_url || (data.data && (data.data.url || data.data.notionUrl));
          }
        } catch (e) {
          // non-JSON or no url is fine
        }

        resolve(responseUrl);
      } catch (e) {
        reject(e);
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('urlInput');
  const previewBtn = document.getElementById('previewBtn');
  const openOptions = document.getElementById('openOptions');
  const preview = document.getElementById('preview');
  const thumb = document.getElementById('thumb');
  const titleEl = document.getElementById('title');
  const sendBtn = document.getElementById('sendBtn');
  
  // Outlier filter elements
  const outlierToggle = document.getElementById('outlierToggle');
  const sliderContainer = document.getElementById('sliderContainer');
  const outlierSlider = document.getElementById('outlierSlider');
  const sliderValue = document.getElementById('sliderValue');
  
  // Subscriber filter elements
  const subToggle = document.getElementById('subToggle');
  const subContainer = document.getElementById('subContainer');
  const subMin = document.getElementById('subMin');
  const subMax = document.getElementById('subMax');

  // Views filter elements
  const viewToggle = document.getElementById('viewToggle');
  const viewContainer = document.getElementById('viewContainer');
  const viewMin = document.getElementById('viewMin');
  const viewMax = document.getElementById('viewMax');

  // Load saved filter settings
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
    // Outlier settings
    const outlierEnabled = items.outlierFilterEnabled || false;
    const outlierMinVal = items.outlierMinValue || 5;
    
    outlierToggle.checked = outlierEnabled;
    outlierSlider.value = outlierMinVal;
    sliderValue.textContent = outlierMinVal + 'x';
    
    if (outlierEnabled) {
      sliderContainer.classList.remove('hidden');
    }
    
    // Subscriber settings
    const subEnabled = items.subFilterEnabled || false;
    const subMinVal = items.subMinValue || '0';
    const subMaxVal = items.subMaxValue || '';
    
    subToggle.checked = subEnabled;
    subMin.value = subMinVal;
    subMax.value = subMaxVal;
    
    if (subEnabled) {
      subContainer.classList.remove('hidden');
    }

    // Views settings
    const viewEnabled = items.viewFilterEnabled || false;
    const viewMinVal = items.viewMinValue || '0';
    const viewMaxVal = items.viewMaxValue || '';

    viewToggle.checked = viewEnabled;
    viewMin.value = viewMinVal;
    viewMax.value = viewMaxVal;

    if (viewEnabled) {
      viewContainer.classList.remove('hidden');
    }
  });

  // Toggle outlier filter on/off
  outlierToggle.addEventListener('change', () => {
    const enabled = outlierToggle.checked;
    
    if (enabled) {
      sliderContainer.classList.remove('hidden');
    } else {
      sliderContainer.classList.add('hidden');
    }
    
    // Save setting
    chrome.storage.sync.set({ outlierFilterEnabled: enabled });
  });

  // Update slider value display and save
  outlierSlider.addEventListener('input', () => {
    const value = outlierSlider.value;
    sliderValue.textContent = value + 'x';
    
    // Save setting
    chrome.storage.sync.set({ outlierMinValue: parseInt(value) });
  });
  
  // Toggle subscriber filter on/off
  subToggle.addEventListener('change', () => {
    const enabled = subToggle.checked;
    
    if (enabled) {
      subContainer.classList.remove('hidden');
    } else {
      subContainer.classList.add('hidden');
    }
    
    // Save setting
    chrome.storage.sync.set({ subFilterEnabled: enabled });
  });
  
  // Save subscriber min/max values on change
  subMin.addEventListener('change', () => {
    chrome.storage.sync.set({ subMinValue: subMin.value });
  });
  
  subMax.addEventListener('change', () => {
    chrome.storage.sync.set({ subMaxValue: subMax.value });
  });

  // Toggle views filter on/off
  viewToggle.addEventListener('change', () => {
    const enabled = viewToggle.checked;

    if (enabled) {
      viewContainer.classList.remove('hidden');
    } else {
      viewContainer.classList.add('hidden');
    }

    // Save setting
    chrome.storage.sync.set({ viewFilterEnabled: enabled });
  });

  // Save views min/max values on change
  viewMin.addEventListener('change', () => {
    chrome.storage.sync.set({ viewMinValue: viewMin.value });
  });

  viewMax.addEventListener('change', () => {
    chrome.storage.sync.set({ viewMaxValue: viewMax.value });
  });

  openOptions.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  previewBtn.addEventListener('click', async () => {
    setMessage('');
    preview.classList.add('hidden');
    titleEl.textContent = '';
    thumb.src = '';

    const input = extractYouTubeUrlCandidate(urlInput.value);
    if (!input) {
      setMessage('Please enter a YouTube URL.', true);
      return;
    }

    previewBtn.disabled = true;
    try {
      const meta = await fetchYouTubeMeta(input);
      titleEl.textContent = meta.title || 'Untitled video';
      thumb.src = meta.thumbnail_url;
      preview.dataset.videoUrl = input;
      preview.dataset.title = meta.title || '';
      preview.dataset.thumbnailUrl = meta.thumbnail_url || '';
      preview.classList.remove('hidden');
    } catch (e) {
      setMessage(e.message || 'Unable to fetch video details.', true);
    } finally {
      previewBtn.disabled = false;
    }
  });

  sendBtn.addEventListener('click', async () => {
    setMessage('Sending to webhook...');
    sendBtn.disabled = true;
    try {
      const responseUrl = await sendToTargetWebhook({
        videoURL: preview.dataset.videoUrl || '',
        title: preview.dataset.title || null,
        thumbnailUrl: preview.dataset.thumbnailUrl || null
      });
      if (responseUrl) {
        setMessage('Sent! Click to open response.');
        // Make the message area clickable
        const msgEl = document.getElementById('message');
        msgEl.style.cursor = 'pointer';
        msgEl.style.textDecoration = 'underline';
        const openHandler = () => {
          window.open(responseUrl, '_blank');
          msgEl.removeEventListener('click', openHandler);
          msgEl.style.cursor = '';
          msgEl.style.textDecoration = '';
        };
        msgEl.addEventListener('click', openHandler, { once: true });
      } else {
        setMessage('Sent to webhook.');
      }
    } catch (e) {
      setMessage(e.message || 'Failed to send to webhook.', true);
    } finally {
      sendBtn.disabled = false;
    }
  });
});




