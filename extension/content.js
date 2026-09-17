// content.js - WhatsApp Web automation core.
// Observes new incoming messages, classifies them, and either auto-sends
// an approved response or queues them for human review.

import { extractMessageContext } from './dom.js';
import { sendReply } from './sender.js';
import { AIProvider } from './shared/aiProvider.js';
import { StateStore } from './shared/stateStore.js';
import { CONFIG } from './shared/config.js';

const provider = new AIProvider();
const store = new StateStore();
let lastProcessedTs = 0;
let sending = false;
let sendQueue = [];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_PENDING') {
    store.getPending().then(sendResponse);
    return true;
  }
  if (msg.type === 'RESOLVE_PENDING') {
    store.resolvePending(msg.id, msg.action, msg.editedReply).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_STATE') {
    Promise.all([store.getCategories(), store.getSettings(), store.getMeetLinks()]).then(([c, s, m]) =>
      sendResponse({ categories: c, settings: s, meetLinks: m })
    );
    return true;
  }
    if (msg.type === 'SET_API_KEY') {
      provider.setApiKey(msg.apiKey);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'SEND_MESSAGE') {
      try {
        const sent = await sendReply(msg.text, { delayMs: 0 });
        if (sent) {
          await store.recordSend(
            msg.chatId, msg.contactName, msg.phone,
            msg.category || 'manual', msg.text
          );
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: 'send_failed' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }
  if (msg.type === 'SET_CATEGORY') {
    store.setCategory(msg.category, msg.template).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'SET_SETTINGS') {
    store.setSettings(msg.settings).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'DELETE_CATEGORY') {
    store.deleteCategory(msg.category).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// Observe the messages container for new incoming messages.
const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.addedNodes) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) _onNewNode(node);
      }
    }
  }
});

function _onNewNode(node) {
  // Look for message elements inside the added subtree.
  const msgs = node.querySelectorAll
    ? node.querySelectorAll('[data-id][data-author], [data-pre-plain-text]')
    : [];
  for (const el of msgs) _processMessage(el);
  if (node.matches && node.matches('[data-id][data-author], [data-pre-plain-text]')) {
    _processMessage(node);
  }
}

async function _processMessage(msgEl) {
  try {
    const ctx = extractMessageContext(msgEl);
    if (!ctx) return;
    // Skip our own outgoing messages.
    if (_isOutgoing(msgEl)) return;
    // Skip already processed by timestamp.
    if (ctx.ts && ctx.ts <= lastProcessedTs) return;
    lastProcessedTs = ctx.ts;

    // Extract meeting links (for the later connected project).
    await _extractMeetLinks(ctx);

    // Classify.
    const classification = await provider.classify(ctx);

    const settings = await store.getSettings();
    const mode = (settings && settings.mode) || 'auto';

    const existing = await store.getCategory(classification.category);
    // In human-decides mode, always route to review so the human chooses
    // whether to send the AI suggestion or a manual reply.
    if (mode === 'human' || !existing) {
      await store.addPending(
        { ...ctx, msgEl: undefined },
        classification
      );
      _notify('pending', { category: classification.category, contact: ctx.contactName });
      return;
    }

    // Auto mode + approved template exists -> auto-send (dedupe + anti-ban).
    await _queueSend(ctx, classification, existing.template);
  } catch (e) {
    console.error('processMessage failed', e);
  }
}

function _isOutgoing(msgEl) {
  // Outgoing messages are in a different container (often [data-id] with
  // "status-offers" or a right-aligned wrapper). Heuristic: look for the
  // "you" / "me" sender or a specific class.
  const author = msgEl.getAttribute('data-author') || '';
  const owner = _ownerPhone();
  if (owner && author === owner) return true;
  const parent = msgEl.closest('[class*="message-out"], [class*="outgoing"]');
  return !!parent;
}

function _ownerPhone() {
  try {
    const me = document.querySelector('[data-testid="my-profile"]');
    return me ? (me.getAttribute('data-phone') || me.getAttribute('title')) : null;
  } catch { return null; }
}

async function _queueSend(ctx, classification, template) {
  sendQueue.push({ ctx, classification, template });
  _pumpQueue();
}

async function _pumpQueue() {
  if (sending) return;
  sending = true;
  try {
    while (sendQueue.length) {
      const { ctx, classification, template } = sendQueue.shift();

      // Dedupe check.
      const { dup, reason } = await store.isDuplicate(
        classification.category, ctx.chatId, template
      );
      if (dup) {
        _notify('skipped', { category: classification.category, reason, contact: ctx.contactName });
        continue;
      }

      // Anti-ban min delay.
      const settings = await store.getSettings();
      const delay = (settings && settings.minSendDelayMs) || CONFIG.hitl.minSendDelayMs;
      await sendReply(template, { delayMs: delay });

      await store.recordSend(ctx.chatId, ctx.contactName, ctx.phone, classification.category, template);
      _notify('sent', { category: classification.category, contact: ctx.contactName, text: template });
    }
  } finally {
    sending = false;
  }
}

async function _extractMeetLinks(ctx) {
  if (!ctx.text) return;
  const found = [];
  for (const { regex } of CONFIG.meetLinkPatterns) {
    const re = new RegExp(regex, 'gi');
    let m;
    while ((m = re.exec(ctx.text))) found.push(m[0]);
  }
  if (found.length) {
    await store.addMeetLinks(found, ctx.chatId, ctx.contactName);
  }
}

function _notify(type, data) {
  try { chrome.runtime.sendMessage({ type: 'EVENT', event: type, data }); } catch {}
}

// Start observing once the messages container is available.
function _startWhenReady() {
  const container = document.querySelector('#app [data-tabindex="0"]') ||
    document.querySelector('#main') ||
    document.body;
  observer.observe(container, { childList: true, subtree: true });
  console.log('WA Auto-Sender observing messages');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _startWhenReady);
} else {
  _startWhenReady();
}