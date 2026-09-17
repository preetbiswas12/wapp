// Send automation: locate the message input and click send.
// WhatsApp Web uses a contenteditable; we inject text then click the send button.

export async function sendReply(text, { delayMs = 0 } = {}) {
  if (delayMs > 0) await _sleep(delayMs);
  const input = _findInput();
  if (!input) throw new Error('message input not found');

  // Clear existing content (WhatsApp sometimes keeps draft).
  input.focus();
  _setEditableText(input, text);

  // Trigger input events so WhatsApp updates its internal state.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  const sent = await _clickSend();
  if (!sent) throw new Error('send button not found or not clickable');
  return true;
}

function _findInput() {
  return (
    document.querySelector('[data-testid="compose-input"]') ||
    document.querySelector('[contenteditable="true"][role="textbox"]') ||
    document.querySelector('div[contenteditable="true"]')
  );
}

function _setEditableText(el, text) {
  // Replace content safely for contenteditable.
  el.focus();
  document.execCommand('selectall', false, null);
  document.execCommand('insertText', false, text);
  // Fallback for browsers where execCommand is restricted.
  if (!el.textContent || el.textContent.trim() !== text) {
    el.textContent = text;
  }
}

async function _clickSend() {
  // Send button: paper-plane icon.
  const sendBtn =
    document.querySelector('[data-testid="send"]') ||
    document.querySelector('span[data-icon="send"]')?.closest('button') ||
    document.querySelector('button[data-testid="send-button"]') ||
    _findSendButtonByIcon();
  if (sendBtn && _isVisible(sendBtn)) {
    sendBtn.click();
    return true;
  }
  // Fallback: Ctrl/Cmd+Enter.
  const input = _findInput();
  if (input) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    return true;
  }
  return false;
}

function _findSendButtonByIcon() {
  const icons = document.querySelectorAll('i[data-icon="send"], i[data-icon="send-filled"]');
  for (const ic of icons) {
    const btn = ic.closest('button') || ic.closest('[role="button"]') || ic.parentElement;
    if (btn && _isVisible(btn)) return btn;
  }
  return null;
}

function _isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 &&
    style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }