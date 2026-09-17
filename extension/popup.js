const statusEl = document.getElementById('status');
const pendingEl = document.getElementById('pending');
const openBtn = document.getElementById('openDashboard');
const toggleBtn = document.getElementById('toggle');

openBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
});

async function refresh() {
  try {
    const tabs = await chrome.tabs.query({ url: ['*://web.whatsapp.com/*'] });
    statusEl.textContent = tabs.length ? `Watching ${tabs.length} tab(s)` : 'No WhatsApp tab open';
    const res = await chrome.runtime.sendMessage({ type: 'GET_PENDING' });
    if (res && res.length) {
      pendingEl.innerHTML = res.map(p => `
        <div class="item">
          <div class="meta">${p.classification.category} · ${p.message.contactName || 'Unknown'}</div>
          <div>${(p.message.text || '').slice(0, 60)}</div>
          <div class="meta">suggested: ${(p.classification.suggestedReply || 'none').slice(0, 40)}</div>
        </div>`).join('');
    } else {
      pendingEl.innerHTML = '<div class="meta">No pending reviews</div>';
    }
  } catch (e) {
    statusEl.textContent = 'error';
  }
}

toggleBtn.addEventListener('click', async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    const mode = (res && res.settings && res.settings.mode) || 'auto';
    const next = mode === 'human' ? 'auto' : 'human';
    await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings: { mode: next } });
    toggleBtn.textContent = next === 'human' ? 'Human mode' : 'Auto mode';
  } catch (e) {
    toggleBtn.textContent = 'Error';
  }
});

async function refreshToggle() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    const mode = (res && res.settings && res.settings.mode) || 'auto';
    toggleBtn.textContent = mode === 'human' ? 'Human mode' : 'Auto mode';
  } catch {}
}

setInterval(refresh, 2000);
refresh();
refreshToggle();