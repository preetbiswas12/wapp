// AI provider abstraction.
// classify(message) -> { category, intent, suggestedReply, meetLinks[], confidence }
// Providers are swappable via CONFIG.provider.

import { CONFIG } from './config.js';

export class AIProvider {
  constructor() {
    this.apiKey = null; // set by background from storage
  }

  setApiKey(key) { this.apiKey = key; }

  async classify(message) {
    const provider = CONFIG.provider;
    switch (provider) {
      case 'kilo': return this._kiloClassify(message);
      case 'openai': return this._openaiClassify(message);
      case 'local': return this._localClassify(message);
      default: return this._fallbackClassify(message);
    }
  }

  _buildPrompt(message) {
    return `You are a WhatsApp message classifier and auto-reply assistant.
Classify the following message into exactly ONE category from this list:
${CONFIG.categories.join(', ')}

Also determine:
- intent: a 1-5 word summary of what the sender wants
- context: "dm" (1-to-1) or "group" (group chat)
- mentionedMe: true if the message appears to mention the account owner directly
- suggestedReply: a concise, friendly reply in the same language as the message.
  If the category is 'other' and you cannot answer, set suggestedReply to null.
- confidence: 0.0-1.0

Extract any meeting links (Zoom, Google Meet, Microsoft Teams, Webex) into meetLinks[].

Message:
Chat context: ${message.isGroup ? 'GROUP' : 'DM'}${message.mentionedMe ? ', MENTIONED_ME' : ''}
Sender name: ${message.contactName || 'Unknown'}
Sender phone: ${message.phone || 'Unknown'}
Text: ${message.text || ''}

Reply ONLY with a JSON object, no markdown, no extra text:
{"category":"...","intent":"...","context":"dm|group","mentionedMe":true|false,"suggestedReply":"... or null","confidence":0.0,"meetLinks":["https://..."]}`;
  }

  _parseJSON(text) {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('no JSON in response');
      return JSON.parse(match[0]);
    } catch (e) {
      return {
        category: 'other',
        intent: 'parse_error',
        context: 'dm',
        mentionedMe: false,
        suggestedReply: null,
        confidence: 0.0,
        meetLinks: [],
        _parseError: e.message,
      };
    }
  }

  async _kiloClassify(message) {
    return this._openAICompatible({
      endpoint: CONFIG.kilo.endpoint,
      model: CONFIG.kilo.model,
      message,
    });
  }

  async _openaiClassify(message) {
    return this._openAICompatible({
      endpoint: CONFIG.openai.endpoint,
      model: CONFIG.openai.model,
      message,
    });
  }

  async _localClassify(message) {
    const prompt = this._buildPrompt(message);
    const res = await fetch(CONFIG.local.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CONFIG.local.model, prompt }),
    });
    if (!res.ok) throw new Error(`local provider error: ${res.status}`);
    const data = await res.json();
    return this._parseJSON(data.response || '');
  }

  async _openAICompatible({ endpoint, model, message }) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: this._buildPrompt(message) }],
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`provider error ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty provider content');
    return this._parseJSON(content);
  }

  _fallbackClassify(message) {
    // Rule-based fallback when no provider is configured.
    const text = (message.text || '').toLowerCase();
    let category = 'other';
    if (/\b(ac|air condition|conditioner)\b/.test(text)) category = 'ac_inquiry';
    else if (/\b(attendance|present|absent)\b/.test(text)) category = 'attendance';
    else if (/\b(hi|hello|namaste|hey)\b/.test(text)) category = 'greeting';
    else if (/\b(price|cost|rate|how much)\b/.test(text)) category = 'pricing';
    else if (/\b(sorry|bad|complain|problem)\b/.test(text)) category = 'complaint';
    else if (/\b(doubt|question|explain|how)\b/.test(text)) category = 'doubt';

    return {
      category,
      intent: category.replace(/_/g, ' '),
      context: message.isGroup ? 'group' : 'dm',
      mentionedMe: !!message.mentionedMe,
      suggestedReply: null,
      confidence: 0.5,
      meetLinks: [],
    };
  }
}