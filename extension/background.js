/**
 * Sales Lead Generator — Extension Background Service Worker
 * Proxies API requests outside the tab content environment.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'capture') {
    handleCapture(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message.type === 'testConnection') {
    handleTestConnection(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function handleCapture(payload) {
  const { baseUrl, apiKey } = await chrome.storage.local.get(['baseUrl', 'apiKey']);
  if (!baseUrl || !apiKey) {
    return { ok: false, error: 'Server URL or API Key is missing. Configure settings first.' };
  }

  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const targetUrl = `${cleanBaseUrl}/api/capture`;

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data.error || `HTTP ${res.status}`,
        issues: data.issues,
      };
    }

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

async function handleTestConnection({ baseUrl, apiKey }) {
  const cleanBaseUrl = (baseUrl || '').replace(/\/+$/, '');
  if (!cleanBaseUrl || !apiKey) {
    return { ok: false, error: 'URL and API Key are required' };
  }

  try {
    const res = await fetch(`${cleanBaseUrl}/api/health`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });

    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, status: res.status, error: `Server returned HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: `Could not reach server: ${err.message}` };
  }
}
