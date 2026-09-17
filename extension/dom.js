// DOM extraction helpers for WhatsApp Web.
// Selectors target web.whatsapp.com DOM. WhatsApp updates these often,
// so extraction is wrapped in try/catch and failures are reported via console.

// Returns { chatId, contactName, phone, isGroup, mentionedMe, text, ts, msgEl }
export function extractMessageContext(msgEl) {
  try {
    const text = _extractText(msgEl);
    const chatContext = _extractChatContext(msgEl);
    const sender = _extractSender(msgEl);
    const ts = _extractTimestamp(msgEl);
    return {
      chatId: chatContext.chatId,
      contactName: sender.name,
      phone: sender.phone,
      isGroup: chatContext.isGroup,
      mentionedMe: _isMentionedMe(msgEl, text),
      text,
      ts,
      msgEl,
    };
  } catch (e) {
    console.error('extractMessageContext failed', e);
    return null;
  }
}

function _extractText(msgEl) {
  // Message body: prefer [data-id] message container, fallback to any text node.
  const body =
    msgEl.querySelector('[data-id]') ||
    msgEl.querySelector('.copyable-text') ||
    msgEl.querySelector('span[dir="auto"]') ||
    msgEl;
  return (body?.textContent || '').trim();
}

function _extractChatContext(msgEl) {
  // Walk up to the chat row / panel to find the chat id and group flag.
  let row = msgEl.closest('[data-row]');
  let chatId = null;
  let isGroup = false;

  // Chat id from URL hash when on a chat panel.
  const panel = msgEl.closest('#app')?._waChatId || _chatIdFromUrl();
  if (panel) chatId = panel;

  // Group detection: group chats show a subject header and participant list.
  const groupHeader = document.querySelector('[data-testid="conversation-header"]')
    ? true : false;
  // Simpler heuristic: presence of a group icon / participant count span.
  isGroup = !!document.querySelector('[data-testid="participant-list"]')
    || !!document.querySelector('i[data-icon="group"]');

  return { chatId: chatId || 'unknown', isGroup };
}

function _chatIdFromUrl() {
  try {
    const hash = location.hash || '';
    const m = hash.match(/\/phone\/([^/]+)/) || hash.match(/\/send\?phone=([^&]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

function _extractSender(msgEl) {
  // Sender name from the message meta (author attribute on the message wrapper).
  const wrapper = msgEl.closest('[data-id]') || msgEl;
  const author = wrapper.getAttribute('data-author') || wrapper.getAttribute('author');
  if (author) {
    return { name: _nameFromPhone(author), phone: author };
  }
  // Fallback: name from the chat header when in a DM.
  const headerName = document.querySelector('[data-testid="conversation-header"] [title]');
  if (headerName) return { name: headerName.getAttribute('title'), phone: null };
  return { name: 'Unknown', phone: null };
}

function _nameFromPhone(phone) {
  // Best-effort: WhatsApp shows contact name in the chat header for DMs.
  const header = document.querySelector('[data-testid="conversation-header"] [title]');
  return header ? header.getAttribute('title') : phone;
}

function _extractTimestamp(msgEl) {
  const t = msgEl.querySelector('[data-testid="msg-meta"] span, [data-pre-plain-text]');
  if (t) {
    const attr = t.getAttribute('data-pre-plain-text');
    if (attr) {
      const m = attr.match(/\[(.*?)\]/);
      if (m) return new Date(m[1]).getTime() || Date.now();
    }
  }
  return Date.now();
}

function _isMentionedMe(msgEl, text) {
  // Mention detection: look for the owner's name or @ marker.
  const ownerName = _ownerName();
  if (!ownerName) return false;
  const re = new RegExp('(?:@|\\b)' + _escapeRe(ownerName) + '\\b', 'i');
  return re.test(text);
}

function _ownerName() {
  // WhatsApp shows the account owner's name in the profile/me panel.
  const me = document.querySelector('[data-testid="my-profile"] [title]')
    || document.querySelector('[data-testid="chat-bar"] [contenteditable="true"]');
  return me ? (me.getAttribute('title') || me.textContent || '').trim() : null;
}

function _escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }