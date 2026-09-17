# WA Auto-Sender & Classifier

Human-in-the-loop WhatsApp Web auto-reply system with AI classification and strict dedupe.

## Features
- Classifies inbound messages into categories (AC inquiry, doubt, attendance, greeting, etc.)
- First message of a new category → queued for human review (AI-suggested reply shown)
- Human approves / edits / rejects → template stored under that category
- From the second message of that category onward → auto-send (no human wait)
- Strict dedupe: never send identical text to same contact; never repeat a category-response to same contact within a rolling window; min delay between sends (anti-ban)
- Meet link extraction (Zoom / Google Meet / Teams / Webex) stored for a connected later project
- Configurable AI provider (kilo.ai default, OpenAI-compatible, local Ollama)

## Scope
v1: WhatsApp Web only (Chrome MV3 extension + dashboard). Android/iOS apps are a later phase.

## Structure
- `extension/` — Chrome extension (MV3)
  - `manifest.json`, `background.js`, `content.js`, `popup.html/js`
  - `dom.js` — WhatsApp DOM extraction
  - `sender.js` — message input + send automation
  - `shared/config.js`, `shared/aiProvider.js`, `shared/stateStore.js`
  - `dashboard/` — human review console (web_accessible_resource)
- `server/` — reserved for future backend (meet-link project)

## Install
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Load unpacked → select `extension/`
4. Open `web.whatsapp.com`, scan QR, then open the extension popup and click **Dashboard**
5. In Settings, set your AI API key and provider

## How it works
1. New incoming message arrives on WhatsApp Web
2. content.js extracts context (chat id, name, phone, group/DM, mentionedMe, text)
3. AI provider classifies → {category, intent, suggestedReply, meetLinks}
4. If no template exists for that category → queued to Review tab
5. Human approves/edits → template saved
6. Next same-category message → dedupe check → auto-send with min delay

## Notes / Risks
- WhatsApp's Terms restrict DOM automation; the user accepts responsibility.
- WhatsApp may change DOM selectors; keep `dom.js` selectors updated.
- No official WhatsApp Business API is used.