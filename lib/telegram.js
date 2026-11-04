import { getSettings, updateSettings, verifyPassword } from './settings.js';
import { reply, resetConversation, matchProduct } from './agent.js';
import { findLeads } from './leadfinder.js';
import { getProducts } from './products.js';
import { PROVIDERS } from './llm.js';
import { allow, blocked, record, underDailyCap } from './ratelimit.js';
import { bus } from './events.js';

let running = null;
let activeToken = '';

async function api(token, method, body, timeout = 15000) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(timeout),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || 'Telegram error');
  return j.result;
}

async function send(token, chatId, text) {
  for (let i = 0; i < text.length; i += 4000) {
    await api(token, 'sendMessage', { chat_id: chatId, text: text.slice(i, i + 4000), disable_web_page_preview: true });
  }
}

const isAdmin = (id) => getSettings().telegram.adminChatIds.includes(id);

async function handle(token, msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim().slice(0, 1500);
  if (!text) return;
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ');
  const s = getSettings();
  const admin = isAdmin(chatId);

  // Floods: customers get 15 messages per 10 minutes, plus the shared daily AI cap.
  if (!admin && !allow('tg:' + chatId, 15, 600_000)) return send(token, chatId, 'You are sending messages very quickly. Please wait a few minutes.');

  if (cmd === '/start') {
    resetConversation('telegram:' + chatId);
    return send(token, chatId, `Hi! I'm the ${s.company.name} assistant. Ask me about our software (${getProducts().filter((p) => p.type === 'product' && p.status !== 'hidden').map((p) => p.name).join(', ')}) and services, and I'll help you find the right fit.\n\nNote: I'm an AI, and messages are stored so our team can follow up. Send /stop to clear our chat history.`);
  }
  if (cmd === '/stop') {
    resetConversation('telegram:' + chatId);
    return send(token, chatId, 'Done. Our conversation has been cleared. Send /start any time.');
  }
  if (cmd === '/products') {
    return send(token, chatId, getProducts().filter((p) => p.status !== 'hidden').map((p) => `${p.name}: ${p.tagline}`).join('\n\n'));
  }
  if (cmd === '/claim') {
    // Brute-force guard: 5 wrong tries per hour per chat.
    if (blocked('claim:' + chatId, 5, 3_600_000)) return send(token, chatId, 'Too many attempts. Try again later.');
    if (!verifyPassword(arg)) { record('claim:' + chatId); return send(token, chatId, 'Wrong password.'); }
    updateSettings({ telegram: { adminChatIds: [...new Set([...s.telegram.adminChatIds, chatId])] } }, { internal: true });
    return send(token, chatId, 'You are now a Code Tech admin on this bot. You will get alerts for new website leads.\nCommands: /find <industry> in <city>, /provider <gemini|groq|ollama>');
  }
  if (cmd === '/find' || cmd === '/provider') {
    if (!admin) return send(token, chatId, 'Admin only. Send /claim <dashboard password> first.');
    if (cmd === '/provider') {
      if (!PROVIDERS.includes(arg)) return send(token, chatId, 'Use one of: ' + PROVIDERS.join(', '));
      updateSettings({ provider: arg });
      return send(token, chatId, 'AI provider switched to ' + arg);
    }
    const m = arg.match(/^(.{2,80}?)\s+in\s+(.{2,80})$/i);
    if (!m) return send(token, chatId, 'Usage: /find gaming lounge in Lagos');
    await send(token, chatId, `Searching for "${m[1]}" in ${m[2]}. This takes a minute or two…`);
    const { leads, warnings } = await findLeads({ query: m[1], location: m[2], limit: 10, product: matchProduct(m[1]) });
    if (!leads.length) return send(token, chatId, 'No new leads found. ' + warnings.join(' '));
    const lines = leads.map((l) =>
      [l.name, ...l.phones.slice(0, 2), ...l.emails.slice(0, 2), ...Object.values(l.socials).slice(0, 2), l.website].filter(Boolean).join('\n'),
    );
    return send(token, chatId, `${leads.length} new leads saved (open the dashboard to draft messages):\n\n` + lines.join('\n\n'));
  }

  if (!admin && !underDailyCap(s.widget.dailyCap)) return send(token, chatId, "I'm very busy right now. Please contact us directly or try again tomorrow.");
  const r = await reply('telegram:' + chatId, 'telegram', text);
  return send(token, chatId, r.text);
}

// Alert admins the moment a visitor leaves their contact details.
bus.on('lead', ({ lead, channel }) => {
  if (!activeToken) return;
  const msg = `New lead from ${channel}: ${lead.name}\n${[...lead.phones, ...lead.emails].join('\n')}\nOpen the dashboard to see the chat and reply.`;
  for (const id of getSettings().telegram.adminChatIds) send(activeToken, id, msg).catch(() => {});
});

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function postLeadToChannel(lead) {
  const token = activeToken || getSettings().telegram.token || process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID || getSettings().telegram.channelId;
  if (!token || !channelId) return;

  const phones = (lead.phones || []).filter(Boolean);
  const emails = (lead.emails || []).filter(Boolean);
  const socials = Object.entries(lead.socials || {})
    .filter(([_, v]) => Boolean(v))
    .map(([k, v]) => `• ${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`)
    .join('\n');

  const lines = [
    `🎯 <b>NEW LEAD SAVED</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🏢 <b>Business:</b> ${esc(lead.name || 'Unknown')}`,
    lead.industry ? `🏷️ <b>Industry:</b> ${esc(lead.industry)}` : null,
    lead.location ? `📍 <b>Location:</b> ${esc(lead.location)}` : null,
    lead.address ? `📌 <b>Address:</b> ${esc(lead.address)}` : null,
    lead.website ? `🌐 <b>Website:</b> ${esc(lead.website)}` : null,
    phones.length ? `📞 <b>Phone:</b> ${phones.map(esc).join(', ')}` : null,
    emails.length ? `✉️ <b>Email:</b> ${emails.map(esc).join(', ')}` : null,
    socials ? `📱 <b>Socials:</b>\n${socials}` : null,
    lead.description ? `📝 <b>Summary:</b> ${esc(lead.description)}` : null,
    `━━━━━━━━━━━━━━━━━━━━`,
    `⭐ <b>Quality Score:</b> ${lead.score || 0} | <b>Source:</b> ${esc(lead.source || 'in-house')}`,
  ].filter(Boolean);

  try {
    await api(token, 'sendMessage', {
      chat_id: channelId,
      text: lines.join('\n'),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('Telegram channel broadcast error:', err.message);
  }
}

// Automatically broadcast every newly created lead to the private Telegram backup channel
bus.on('lead:created', (lead) => {
  postLeadToChannel(lead).catch(() => {});
});

export function stopTelegram() {
  if (running) running.stop = true;
  running = null;
  activeToken = '';
}

export function startTelegram() {
  const token = getSettings().telegram.token;
  if (running && activeToken === token) return; // already polling with this token
  stopTelegram();
  if (!token) return;
  const state = { stop: false };
  running = state;
  (async () => {
    let offset = 0;
    try {
      const me = await api(token, 'getMe');
      await api(token, 'deleteWebhook');
      activeToken = token;
      console.log(`Telegram bot @${me.username} is running`);
    } catch (e) {
      console.error('Telegram: could not start:', e.message);
      if (running === state) running = null;
      return;
    }
    while (!state.stop) {
      try {
        const updates = await api(token, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'channel_post', 'my_chat_member'] }, 40000);
        for (const u of updates) {
          offset = u.update_id + 1;
          const chat = u.channel_post?.chat || u.my_chat_member?.chat;
          if (chat && (chat.type === 'channel' || chat.type === 'supergroup')) {
            console.log(`\n==============================================`);
            console.log(`[Telegram Channel Detected]`);
            console.log(`Title: "${chat.title}"`);
            console.log(`Channel ID: ${chat.id}`);
            console.log(`==============================================\n`);
          }
          if (u.message?.chat?.type !== 'private') continue; // private chats only
          handle(token, u.message).catch((e) => {
            console.error('Telegram handler error:', e.message);
            send(token, u.message.chat.id, 'Sorry, I could not answer just now. Please try again in a moment.').catch(() => {});
          });
        }
      } catch (e) {
        if (state.stop) break;
        console.error('Telegram poll error:', e.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
}
