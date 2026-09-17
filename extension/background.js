// background.js - MV3 service worker.
// Holds the API key, relays messages between content script and dashboard.

chrome.runtime.onInstalled.addListener(() => {
  console.log('WA Auto-Sender installed');
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    for (const [key, change] of Object.entries(changes)) {
      if (key === 'waApiKey' && change.newValue) {
        chrome.runtime.sendMessage({ type: 'API_KEY_UPDATE', apiKey: change.newValue });
      }
    }
  }
});

// Forward dashboard commands to the active WhatsApp tab's content script.
async function _sendToWhatsAppTab(message) {
  const tabs = await chrome.tabs.query({ url: ['*://web.whatsapp.com/*'] });
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, message);
      return true;
    } catch {}
  }
  return false;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'GET_API_KEY') {
      const r = await chrome.storage.local.get('waApiKey');
      sendResponse({ apiKey: r.waApiKey || null });
      return;
    }
    if (msg.type === 'SET_API_KEY') {
      await chrome.storage.local.set({ waApiKey: msg.apiKey });
      // Push to content script if a WhatsApp tab is open.
      const tabs = await chrome.tabs.query({ url: ['*://web.whatsapp.com/*'] });
      for (const tab of tabs) {
        try { chrome.tabs.sendMessage(tab.id, { type: 'SET_API_KEY', apiKey: msg.apiKey }); } catch {}
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'SET_SETTINGS') {
      const r = await chrome.storage.local.get('waState');
      const st = r.waState || { categories: {}, sentLog: [], pending: [], dedupe: [], meetLinks: [], settings: {} };
      st.settings = { ...(st.settings || {}), ...msg.settings };
      await chrome.storage.local.set({ waState: st });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'GET_STATE') {
      const r = await chrome.storage.local.get('waState');
      const st = r.waState || { categories: {}, sentLog: [], pending: [], dedupe: [], meetLinks: [], settings: {} };
      sendResponse({ categories: st.categories, settings: st.settings, meetLinks: st.meetLinks, sentLog: st.sentLog });
      return;
    }
    if (msg.type === 'GET_PENDING') {
      const r = await chrome.storage.local.get('waState');
      const st = r.waState || {};
      sendResponse((st.pending || []).filter(p => p.status === 'pending'));
      return;
    }
    if (msg.type === 'RESOLVE_PENDING') {
      const r = await chrome.storage.local.get('waState');
      const st = r.waState || { categories: {}, sentLog: [], pending: [], dedupe: [], meetLinks: [], settings: {} };
      const item = (st.pending || []).find(p => p.id === msg.id);
      if (item) {
        item.status = msg.action;
        item.resolvedAt = Date.now();
        if (msg.action === 'approve') {
          const tpl = (msg.editedReply !== undefined && msg.editedReply !== null && msg.editedReply !== '')
            ? msg.editedReply
            : item.classification.suggestedReply;
          if (tpl) {
            st.categories = st.categories || {};
            st.categories[item.classification.category] = {
              template: tpl,
              createdAt: st.categories[item.classification.category]?.createdAt || Date.now(),
              updatedAt: Date.now(),
              approvedBy: 'human',
            };
          }
        }
        await chrome.storage.local.set({ waState: st });
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'SET_CATEGORY') {
      const r = await chrome.storage.local.get('waState');
      const st = r.waState || { categories: {}, sentLog: [], pending: [], dedupe: [], meetLinks: [], settings: {} };
      st.categories = st.categories || {};
      st.categories[msg.category] = {
        template: msg.template,
        createdAt: st.categories[msg.category]?.createdAt || Date.now(),
        updatedAt: Date.now(),
        approvedBy: 'human',
      };
      await chrome.storage.local.set({ waState: st });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'DELETE_CATEGORY') {
      const r = await chrome.storage.local.get('waState');
      const st = r.waState || {};
      delete (st.categories || {})[msg.category];
      await chrome.storage.local.set({ waState: st });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'OPEN_DASHBOARD') {
      const url = chrome.runtime.getURL('dashboard/index.html');
      chrome.tabs.create({ url });
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: 'unknown' });
  })();
  return true;
});