// dashboard.js - human review console + training store + settings.
// Communicates with the extension background (which forwards to content.js).

const $ = (sel) => document.querySelector(sel);

let state = { categories: {}, settings: {}, pending: [], sentLog: [], meetLinks: [] };

// ---- Tabs ----
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'review') renderPending();
    if (btn.dataset.tab === 'training') renderCategories();
    if (btn.dataset.tab === 'logs') renderSent();
    if (btn.dataset.tab === 'links') renderLinks();
  });
});

// ---- Messaging ----
function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => resolve(res || {}));
  });
}

async function _oneOffSend(p, text) {
  return send({
    type: 'SEND_MESSAGE',
    chatId: p.message.chatId,
    contactName: p.message.contactName,
    phone: p.message.phone,
    category: p.classification.category,
    text,
  });
}

async function loadState() {
  const res = await send({ type: 'GET_STATE' });
  if (res) state = { ...state, ...res };
  renderPending();
  renderCategories();
  renderSent();
  renderLinks();
  fillSettings();
  $('#status').textContent = 'Connected';
}

async function refreshPending() {
  const res = await send({ type: 'GET_PENDING' });
  if (res) state.pending = res;
  renderPending();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

// ---- Review ----
function renderPending() {
  const list = $('#pendingList');
  if (!state.pending.length) {
    list.innerHTML = '<div class="meta">No pending reviews</div>';
    return;
  }
  list.innerHTML = state.pending.map(p => `
    <div class="card" data-id="${p.id}">
      <div class="meta">${p.classification.category} · ${p.message.contactName || 'Unknown'} · ${p.message.isGroup ? 'GROUP' : 'DM'}</div>
      <div class="text">${esc(p.message.text || '')}</div>
      <div class="meta">suggested: ${esc(p.classification.suggestedReply || 'none')}</div>
      <div class="actions">
        <button data-act="send-ai">Send AI Reply</button>
        <button data-act="send-manual">Send Manual</button>
        <button data-act="approve">Approve & Auto-send</button>
        <button data-act="edit">Edit &amp; Approve</button>
        <button data-act="reject">Reject</button>
        <button data-act="skip">Skip</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.card').forEach(card => {
    card.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = card.dataset.id;
        const p = state.pending.find(item => item.id === id);
        if (!p) return;
        let edited = undefined;
        if (btn.dataset.act === 'edit') {
          edited = prompt('Edit reply:', p.classification.suggestedReply || '');
          if (edited === null) return;
        }
        if (btn.dataset.act === 'send-manual') {
          const manual = prompt('Your reply:', '');
          if (!manual) return;
          const res = await _oneOffSend(p, manual);
          if (res.ok) {
            await send({ type: 'RESOLVE_PENDING', id, action: 'sent' });
            toast('sent');
            await refreshPending();
          } else {
            toast(res.error || 'send failed');
          }
          return;
        }
        if (btn.dataset.act === 'send-ai') {
          const reply = p.classification.suggestedReply;
          if (!reply) { toast('no suggested reply'); return; }
          const res = await _oneOffSend(p, reply);
          if (res.ok) {
            await send({ type: 'RESOLVE_PENDING', id, action: 'sent' });
            toast('sent');
            await refreshPending();
          } else {
            toast(res.error || 'send failed');
          }
          return;
        }
        const res = await send({ type: 'RESOLVE_PENDING', id, action: btn.dataset.act, editedReply: edited });
        if (res && res.ok) {
          toast(`${btn.dataset.act}d`);
          if (btn.dataset.act === 'approve' || btn.dataset.act === 'edit') {
            await loadState();
          }
          await refreshPending();
        } else {
          toast('failed');
        }
      });
    });
  });
}

// ---- Training ----
function renderCategories() {
  const list = $('#categoryList');
  const cats = state.categories || {};
  if (!Object.keys(cats).length) {
    list.innerHTML = '<div class="meta">No approved templates yet</div>';
    return;
  }
  list.innerHTML = Object.entries(cats).map(([cat, info]) => `
    <div class="card">
      <div class="meta">${cat} · updated ${new Date(info.updatedAt).toLocaleString()}</div>
      <div class="text">${esc(info.template)}</div>
      <div class="actions">
        <button data-edit="${cat}">Edit</button>
        <button data-del="${cat}">Delete</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-edit]').forEach(b => {
    b.addEventListener('click', async () => {
      const cat = b.dataset.edit;
      const tpl = prompt('Edit template for ' + cat, state.categories[cat].template);
      if (tpl === null) return;
      await send({ type: 'SET_CATEGORY', category: cat, template: tpl });
      await loadState();
      toast('updated');
    });
  });
  list.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('Delete category ' + b.dataset.del + '?')) return;
      await send({ type: 'DELETE_CATEGORY', category: b.dataset.del });
      await loadState();
      toast('deleted');
    });
  });
}

// ---- Settings ----
function fillSettings() {
  $('#provider').value = state.settings.provider || 'kilo';
  $('#mode').value = state.settings.mode || 'auto';
  $('#apiKey').value = state.settings.apiKey || '';
  $('#dedupeWindowMs').value = state.settings.dedupeWindowMs || 86400000;
  $('#minSendDelayMs').value = state.settings.minSendDelayMs || 3000;
}

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const patch = {
    provider: $('#provider').value,
    mode: $('#mode').value,
    apiKey: $('#apiKey').value,
    dedupeWindowMs: parseInt($( '#dedupeWindowMs').value, 10) || 86400000,
    minSendDelayMs: parseInt($( '#minSendDelayMs').value, 10) || 3000,
  };
  await send({ type: 'SET_SETTINGS', settings: patch });
  // Push API key to content script.
  await send({ type: 'SET_API_KEY', apiKey: patch.apiKey });
  toast('saved');
});

// ---- Logs ----
function renderSent() {
  const list = $('#sentList');
  const logs = (state.sentLog || []).slice().reverse();
  if (!logs.length) { list.innerHTML = '<div class="meta">No sends yet</div>'; return; }
  list.innerHTML = logs.map(l => `
    <div class="card">
      <div class="meta">${new Date(l.ts).toLocaleString()} · ${l.category} · ${l.contactName || l.phone}</div>
      <div class="text">${esc(l.text)}</div>
    </div>`).join('');
}

function renderLinks() {
  const list = $('#meetList');
  const links = (state.meetLinks || []).slice().reverse();
  if (!links.length) { list.innerHTML = '<div class="meta">No links extracted yet</div>'; return; }
  list.innerHTML = links.map(l => `
    <div class="card">
      <div class="meta">${l.type} · ${new Date(l.ts).toLocaleString()} · ${l.contactName || ''}</div>
      <a href="${esc(l.url)}" target="_blank">${esc(l.url)}</a>
    </div>`).join('');
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Boot
loadState();
setInterval(refreshPending, 3000);