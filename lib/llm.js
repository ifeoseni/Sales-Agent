import { getSettings } from './settings.js';

const TIMEOUT = 90_000;

async function post(url, body, headers = {}, timeout = TIMEOUT) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const txt = await r.text();
  let j;
  try { j = JSON.parse(txt); } catch { /* not json */ }
  if (!r.ok) {
    const msg = j?.error?.message || (typeof j?.error === 'string' ? j.error : '') || txt;
    throw new Error(`HTTP ${r.status}: ${String(msg).slice(0, 300)}`);
  }
  return j;
}

const impl = {
  // Free-tier quotas are per model, so a second (lighter) model gives extra headroom when the first is
  // out of quota (429), overloaded (503) or retired (404).
  async gemini(c, { system, messages, temperature, json }) {
    const call = async (model) => {
      const j = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
        },
        { 'x-goog-api-key': c.apiKey },
      );
      return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    };
    const models = [...new Set([c.model, c.fallbackModel].filter(Boolean))];
    let last;
    for (const model of models) {
      try { return await call(model); }
      catch (e) {
        last = e;
        if (!/HTTP (404|429|500|502|503|504)/.test(e.message)) throw e; // e.g. bad key: a second model won't help
      }
    }
    throw last;
  },

  async groq(c, { system, messages, temperature, json }) {
    const j = await post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: c.model,
        temperature,
        messages: [{ role: 'system', content: system }, ...messages],
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      },
      { authorization: `Bearer ${c.apiKey}` },
    );
    return j.choices?.[0]?.message?.content || '';
  },

  async ollama(c, { system, messages, temperature, json }) {
    const j = await post(`${c.host.replace(/\/$/, '')}/api/chat`, {
      model: c.model,
      stream: false,
      options: { temperature, num_ctx: 4096 }, // small context keeps CPU-only machines usable
      ...(json ? { format: 'json' } : {}),
      messages: [{ role: 'system', content: system }, ...messages],
    }, {}, 240_000);
    return j.message?.content || '';
  },
};

export const PROVIDERS = Object.keys(impl);

function isConfigured(name, c) {
  if (name === 'ollama') return !!(c.host && c.model);
  return !!c.apiKey;
}

/** Runs a chat completion on the selected provider, failing over to the others when enabled. */
export async function chat({ system, messages, temperature = 0.6, json = false, provider }) {
  const s = getSettings();
  const first = provider || s.provider;
  const order = [first, ...(s.failover && !provider ? PROVIDERS.filter((p) => p !== first) : [])].filter((p) =>
    isConfigured(p, s.providers[p]),
  );
  if (!order.length) {
    throw new Error('No AI provider is configured. Open Settings and add a free Gemini or Groq key, or pick an Ollama model.');
  }
  // Providers (Gemini especially) reject a history that starts with the assistant.
  while (messages.length && messages[0].role !== 'user') messages = messages.slice(1);
  const errors = [];
  for (const name of order) {
    // Free tiers return transient 429/5xx often: retry once before failing over.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const text = (await impl[name](s.providers[name], { system, messages, temperature, json })).trim();
        if (!text) throw new Error('empty response');
        return { text, provider: name };
      } catch (e) {
        const transient = /HTTP (429|500|502|503|504)|timeout|aborted|fetch failed|empty response/i.test(e.message);
        if (attempt < 3 && transient && name !== 'ollama') { await new Promise((r) => setTimeout(r, attempt === 1 ? 1500 : 4000)); continue; }
        errors.push(`${name}: ${e.message}`);
        break;
      }
    }
  }
  throw new Error('All AI providers failed. ' + errors.join(' | '));
}

export async function ollamaModels(host) {
  const r = await fetch(`${(host || 'http://127.0.0.1:11434').replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(4000) });
  const j = await r.json();
  return (j.models || []).map((m) => m.name);
}

export function parseJson(text) {
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { /* try extracting */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('Model did not return valid JSON');
}
