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

async function getNotionConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['notionToken', 'databaseId'], (items) => {
      resolve({ notionToken: items.notionToken || '', databaseId: items.databaseId || '' });
    });
  });
}

async function addToNotion({ title, thumbnailUrl, videoUrl }) {
  const { notionToken, databaseId } = await getNotionConfig();
  if (!notionToken || !databaseId) {
    throw new Error('Notion settings missing. Set them in Options.');
  }

  const body = {
    parent: { database_id: databaseId },
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
    children: [
      {
        object: 'block',
        type: 'image',
        image: { type: 'external', external: { url: thumbnailUrl } }
      }
    ]
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
    const errText = await res.text().catch(() => '');
    throw new Error(`Notion API error (${res.status}): ${errText || res.statusText}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('urlInput');
  const previewBtn = document.getElementById('previewBtn');
  const openOptions = document.getElementById('openOptions');
  const preview = document.getElementById('preview');
  const thumb = document.getElementById('thumb');
  const titleEl = document.getElementById('title');
  const addBtn = document.getElementById('addBtn');
  
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

  addBtn.addEventListener('click', async () => {
    setMessage('Adding to Notion...');
    addBtn.disabled = true;
    try {
      await addToNotion({
        title: preview.dataset.title || '',
        thumbnailUrl: preview.dataset.thumbnailUrl || '',
        videoUrl: preview.dataset.videoUrl || ''
      });
      setMessage('Added to Notion successfully.');
    } catch (e) {
      setMessage(e.message || 'Failed to add to Notion.', true);
    } finally {
      addBtn.disabled = false;
    }
  });
});




