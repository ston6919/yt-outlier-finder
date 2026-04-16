function setMessage(text, isError = false) {
  const msg = document.getElementById('message');
  msg.textContent = text;
  msg.style.color = isError ? '#b91c1c' : '#374151';
}

function loadSettings() {
  chrome.storage.sync.get(['notionToken', 'databaseId', 'inspirationWebhookUrl', 'newsWebhookUrl', 'geminiApiKey', 'infographicPrompt', 'nanoBananaModel', 'imageAspectRatio', 'imageQuality'], (items) => {
    document.getElementById('token').value = items.notionToken || '';
    document.getElementById('db').value = items.databaseId || '';
    document.getElementById('inspirationWebhookUrl').value = items.inspirationWebhookUrl || '';
    document.getElementById('newsWebhookUrl').value = items.newsWebhookUrl || '';
    document.getElementById('geminiKey').value = items.geminiApiKey || '';
    document.getElementById('nanoBananaModel').value = items.nanoBananaModel || 'gemini-2.5-flash-image';
    document.getElementById('imageAspectRatio').value = items.imageAspectRatio || '1:1';
    document.getElementById('imageQuality').value = items.imageQuality || '1K';
    document.getElementById('infographicPrompt').value = items.infographicPrompt || 'Create a professional news infographic about: {text}';
  });

  // Load reference image from local storage (larger storage limit)
  chrome.storage.local.get(['referenceImage', 'referenceImageMimeType'], (items) => {
    if (items.referenceImage) {
      const preview = document.getElementById('referenceImagePreview');
      const container = document.getElementById('imagePreviewContainer');
      preview.src = `data:${items.referenceImageMimeType || 'image/png'};base64,${items.referenceImage}`;
      container.style.display = 'block';
    }
  });
}

function saveSettings() {
  const notionToken = document.getElementById('token').value.trim();
  const databaseId = document.getElementById('db').value.trim();
  const inspirationWebhookUrl = document.getElementById('inspirationWebhookUrl').value.trim();
  const newsWebhookUrl = document.getElementById('newsWebhookUrl').value.trim();
  const geminiApiKey = document.getElementById('geminiKey').value.trim();
  const nanoBananaModel = document.getElementById('nanoBananaModel').value;
  const imageAspectRatio = document.getElementById('imageAspectRatio').value;
  const imageQuality = document.getElementById('imageQuality').value;
  const infographicPrompt = document.getElementById('infographicPrompt').value.trim() || 'Create a professional news infographic about: {text}';

  chrome.storage.sync.set({ notionToken, databaseId, inspirationWebhookUrl, newsWebhookUrl, geminiApiKey, nanoBananaModel, imageAspectRatio, imageQuality, infographicPrompt }, () => {
    setMessage('Saved.');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.getElementById('save').addEventListener('click', saveSettings);

  // Handle reference image upload
  document.getElementById('referenceImageInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target.result.split(',')[1]; // Remove data:image/xxx;base64, prefix
      const mimeType = file.type;

      // Save to local storage
      chrome.storage.local.set({ 
        referenceImage: base64, 
        referenceImageMimeType: mimeType 
      }, () => {
        // Show preview
        const preview = document.getElementById('referenceImagePreview');
        const container = document.getElementById('imagePreviewContainer');
        preview.src = event.target.result;
        container.style.display = 'block';
        setMessage('Reference image saved.');
      });
    };
    reader.readAsDataURL(file);
  });

  // Handle remove image button
  document.getElementById('removeImage').addEventListener('click', () => {
    chrome.storage.local.remove(['referenceImage', 'referenceImageMimeType'], () => {
      const container = document.getElementById('imagePreviewContainer');
      container.style.display = 'none';
      document.getElementById('referenceImageInput').value = '';
      setMessage('Reference image removed.');
    });
  });
});




