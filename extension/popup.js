const PROFILE_REGEX = /^https:\/\/([a-z-]+\.)?linkedin\.com\/(in\/|sales\/(lead|people)\/)/i;

const $ = (id) => document.getElementById(id);
const msg = (text, cls = 'info') => {
  $('msg').textContent = text;
  $('msg').className = `msg ${cls}`;
};

// Initialize settings
(async () => {
  const { baseUrl, apiKey, brand } = await chrome.storage.local.get(['baseUrl', 'apiKey', 'brand']);
  if (baseUrl) $('baseUrl').value = baseUrl;
  if (apiKey) $('apiKey').value = apiKey;
  if (brand) $('brand').value = brand;

  if (baseUrl && apiKey) {
    $('status-badge').textContent = 'Connected';
    $('status-badge').className = 'status-badge connected';
  } else {
    $('status-badge').textContent = 'Unconfigured';
    $('status-badge').className = 'status-badge unconfigured';
    $('settings-details').open = true;
    msg('Please enter your Sales Lead Generator URL and API Key below.', 'info');
  }
})();

// Save Settings
$('save-btn').addEventListener('click', async () => {
  const baseUrl = $('baseUrl').value.trim();
  const apiKey = $('apiKey').value.trim();
  const brand = $('brand').value;

  if (!baseUrl || !apiKey) {
    msg('Both CRM Server URL and API Key are required.', 'err');
    return;
  }

  $('save-btn').disabled = true;
  msg('Testing connection...', 'info');

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'testConnection',
      payload: { baseUrl, apiKey },
    });

    if (res?.ok) {
      await chrome.storage.local.set({ baseUrl, apiKey, brand });
      $('status-badge').textContent = 'Connected';
      $('status-badge').className = 'status-badge connected';
      msg('Connection verified and saved!', 'ok');
      $('settings-details').open = false;
    } else {
      msg(`Connection failed: ${res?.error || 'Unknown error'}`, 'err');
    }
  } catch (err) {
    msg(`Failed to test connection: ${err.message}`, 'err');
  } finally {
    $('save-btn').disabled = false;
  }
});

// Capture LinkedIn Profile
$('capture-btn').addEventListener('click', async () => {
  $('capture-btn').disabled = true;
  msg('Reading profile page...', 'info');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !PROFILE_REGEX.test(tab.url)) {
      msg('Please open a LinkedIn profile (/in/...) before clicking Capture.', 'err');
      return;
    }

    // Execute reader content script in tab
    const [executionResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    const profileData = executionResult?.result;
    if (!profileData || !profileData.url) {
      msg('Failed to extract profile information from this page.', 'err');
      return;
    }

    const brand = $('brand').value;
    await chrome.storage.local.set({ brand });

    const payload = {
      ...profileData,
      brand,
    };

    msg(`Sending ${profileData.name || 'prospect'} to ${brand.toUpperCase()}...`, 'info');

    const response = await chrome.runtime.sendMessage({
      type: 'capture',
      payload,
    });

    if (response?.ok) {
      const data = response.data;
      const statusText = data.created ? 'Created new lead' : 'Updated existing lead';
      msg(`Success! ${statusText}: "${data.name}" in ${data.brand.toUpperCase()}`, 'ok');
    } else {
      msg(`Capture failed: ${response?.error || 'Server error'}`, 'err');
    }
  } catch (err) {
    msg(`Capture error: ${err.message}`, 'err');
  } finally {
    $('capture-btn').disabled = false;
  }
});
