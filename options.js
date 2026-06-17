function setMessage(text, isError = false) {
  const msg = document.getElementById('message');
  msg.textContent = text;
  msg.style.color = isError ? '#b91c1c' : '#374151';
}

function loadSettings() {
  chrome.storage.sync.get(['targetWebhookUrl'], (items) => {
    const el = document.getElementById('targetWebhookUrl');
    if (el) el.value = items.targetWebhookUrl || '';
  });
}

function saveSettings() {
  const targetWebhookUrl = document.getElementById('targetWebhookUrl').value.trim();

  chrome.storage.sync.set({ targetWebhookUrl }, () => {
    setMessage('Saved.');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  const saveBtn = document.getElementById('save');
  if (saveBtn) saveBtn.addEventListener('click', saveSettings);
});




