// test-logic.mjs — validates pure-logic modules with mocked chrome.storage + fetch.
import assert from 'node:assert';

// ---- Mock chrome.storage ----
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => (key in store ? { [key]: store[key] } : {}),
      set: async (obj) => { Object.assign(store, obj); },
    },
  },
  runtime: { sendMessage: async () => ({}) },
};

const { AIProvider } = await import('./extension/shared/aiProvider.js');
const { StateStore } = await import('./extension/shared/stateStore.js');
const { CONFIG } = await import('./extension/shared/config.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}

// 1. Fallback classifier routes intents correctly
{
  const p = new AIProvider();
  const cases = [
    ['I have an AC not cooling', 'ac_inquiry'],
    ['what is the attendance today', 'attendance'],
    ['hello there', 'greeting'],
    ['how much does it cost', 'pricing'],
    ['I have a doubt about the syllabus', 'doubt'],
    ['random unrelated text xyz', 'other'],
  ];
  for (const [text, expected] of cases) {
    const r = p._fallbackClassify({ text, isGroup: false, mentionedMe: false });
    check(`fallback classify "${text.slice(0,25)}..." -> ${expected}`, r.category === expected);
  }
}

// 2. JSON parsing is robust to markdown-wrapped responses
{
  const p = new AIProvider();
  const r = p._parseJSON('Here is the result:\n```json\n{"category":"doubt","intent":"ask doubt","context":"dm","mentionedMe":false,"suggestedReply":"Sure","confidence":0.9,"meetLinks":["https://meet.google.com/abc-def1-ghi2"]}\n```');
  check('parseJSON extracts category', r.category === 'doubt');
  check('parseJSON extracts meetLinks', r.meetLinks[0] === 'https://meet.google.com/abc-def1-ghi2');
  check('parseJSON extracts suggestedReply', r.suggestedReply === 'Sure');
}

// 3. parseJSON degrades gracefully on garbage
{
  const p = new AIProvider();
  const r = p._parseJSON('totally not json');
  check('parseJSON fallback on garbage', r.category === 'other' && r.suggestedReply === null);
}

// 4. Dedupe: exact text to same contact is a dup
{
  const s = new StateStore();
  await s.recordSend('c1', 'Alice', '123', 'greeting', 'Hi there!');
  const r = await s.isDuplicate('greeting', 'c1', 'Hi there!');
  check('dedupe exact text', r.dup === true && r.reason === 'exact_text');
}

// 5. Dedupe: different text but same category+contact within window is a dup
{
  const s = new StateStore();
  await s.recordSend('c2', 'Bob', '456', 'doubt', 'answer A');
  const r = await s.isDuplicate('doubt', 'c2', 'answer B');
  check('dedupe category window', r.dup === true && r.reason === 'category_window');
}

// 6. Dedupe: different contact is NOT a dup
{
  const s = new StateStore();
  await s.recordSend('c3', 'Carol', '789', 'greeting', 'Hi');
  const r = await s.isDuplicate('greeting', 'cX', 'Hi');
  check('dedupe different contact not dup', r.dup === false);
}

// 7. Pending review: add -> resolve approve -> template stored
{
  const s = new StateStore();
  const item = await s.addPending(
    { chatId: 'c4', contactName: 'Dan', phone: '9', isGroup: false, mentionedMe: false, text: 'AC broken' },
    { category: 'ac_inquiry', suggestedReply: 'Sorry to hear' }
  );
  check('addPending returns item', !!item);
  const before = await s.getPending();
  check('getPending has 1', before.length === 1);
  await s.resolvePending(item.id, 'approve');
  const after = await s.getPending();
  check('resolved pending removed', after.length === 0);
  const cat = await s.getCategory('ac_inquiry');
  check('template stored on approve', cat && cat.template === 'Sorry to hear');
}

// 8. Pending review: edit overrides suggestedReply
{
  const s = new StateStore();
  const item = await s.addPending(
    { chatId: 'c5', contactName: 'Eve', phone: '0', isGroup: false, mentionedMe: false, text: 'x' },
    { category: 'pricing', suggestedReply: 'cheap' }
  );
  await s.resolvePending(item.id, 'approve', 'custom edited reply');
  const cat = await s.getCategory('pricing');
  check('edit overrides template', cat.template === 'custom edited reply');
}

// 9. Meet-link extraction stores all link types
{
  const s = new StateStore();
  await s.addMeetLinks(
    ['https://us.example.zoom.us/j/12345678901?pwd=abc', 'https://meet.google.com/abc-defg-hij', 'https://teams.microsoft.com/l/meetup/123:456', 'https://example.webex.com/join/abc'],
    'c6', 'Frank'
  );
  const links = await s.getMeetLinks();
  check('meetLinks count', links.length === 4);
  const types = links.map(l => l.type);
  check('meetLinks zoom detected', types.includes('zoom'));
  check('meetLinks google-meet detected', types.includes('google-meet'));
  check('meetLinks teams detected', types.includes('teams'));
  check('meetLinks webex detected', types.includes('webex'));
}

// 10. CONFIG meetLinkPatterns cover all 4 types
{
  const types = CONFIG.meetLinkPatterns.map(p => p.type);
  check('config has zoom', types.includes('zoom'));
  check('config has google-meet', types.includes('google-meet'));
  check('config has teams', types.includes('teams'));
  check('config has webex', types.includes('webex'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);