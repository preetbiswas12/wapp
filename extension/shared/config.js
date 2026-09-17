// Shared configuration constants for the WhatsApp Auto-Sender extension.
// Keep in sync with dashboard's config defaults.

export const CONFIG = {
  // AI provider: 'kilo' | 'openai' | 'local'
  provider: 'kilo',

  // kilo.ai provider settings (option A)
  kilo: {
    endpoint: 'https://api.kilo.ai/v1/chat/completions',
    model: 'kilo-auto/free',
  },

  // OpenAI-compatible fallback (configurable)
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  },

  // Local model fallback (Ollama)
  local: {
    endpoint: 'http://localhost:11434/api/generate',
    model: 'llama3.1:8b',
  },

  // Human-in-the-loop behavior
  hitl: {
    // Rolling window (ms) during which the same category-template
    // must NOT be re-sent to the same contact.
    dedupeWindowMs: 24 * 60 * 60 * 1000,
    // Minimum delay between any two outbound sends (anti-ban).
    minSendDelayMs: 3000,
    // Max pending review items held in memory before pausing automation.
    maxPendingQueue: 50,
  },

  // Message classification categories (seeds the prompt)
  categories: [
    'ac_inquiry',
    'random_question',
    'doubt',
    'attendance',
    'greeting',
    'complaint',
    'pricing',
    'other',
  ],

  // Meeting link patterns to extract
  meetLinkPatterns: [
    { type: 'zoom', regex: 'https://(?:[a-z0-9-]+\\.)?zoom\\.us/j/[A-Za-z0-9?=&._-]+' },
    { type: 'google-meet', regex: 'https://meet\\.google\\.com/[a-z0-9-]+' },
    { type: 'teams', regex: 'https://teams\\.microsoft\\.com/l/meetup/[A-Za-z0-9/_-]+' },
    { type: 'webex', regex: 'https://[a-z0-9-]+\\.webex\\.com/[a-z0-9./]+meet/[A-Za-z0-9?=&._-]+' },
  ],
};