import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-llm-'));
delete process.env.GEMINI_API_KEY;
delete process.env.GROQ_API_KEY;
const S = await import('../lib/settings.js');
const { chat, parseJson } = await import('../lib/llm.js');

const realFetch = globalThis.fetch;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (text) => json(200, { candidates: [{ content: { parts: [{ text }] } }] });

test('Gemini falls back to the backup model when the first is out of quota', async () => {
  S.updateSettings({ provider: 'gemini', failover: false, providers: { gemini: { apiKey: 'k', model: 'main-model', fallbackModel: 'lite-model' } } });
  const tried = [];
  globalThis.fetch = async (url) => {
    const model = String(url).match(/models\/([^:]+):/)[1];
    tried.push(model);
    return model === 'main-model' ? json(429, { error: { message: 'quota' } }) : ok('from backup');
  };
  try {
    const r = await chat({ system: 's', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.text, 'from backup');
    assert.deepEqual(tried, ['main-model', 'lite-model']);
  } finally { globalThis.fetch = realFetch; }
});

test('a bad API key is reported straight away (a backup model would not help)', async () => {
  const tried = [];
  globalThis.fetch = async (url) => { tried.push(String(url)); return json(400, { error: { message: 'API key not valid' } }); };
  try {
    await assert.rejects(() => chat({ system: 's', messages: [{ role: 'user', content: 'hi' }] }), /API key not valid/);
    assert.equal(tried.length, 1);
  } finally { globalThis.fetch = realFetch; }
});

test('no provider configured gives a helpful message', async () => {
  S.updateSettings({ providers: { gemini: { apiKey: '' } } });
  await assert.rejects(() => chat({ system: 's', messages: [{ role: 'user', content: 'hi' }] }), /No AI provider is configured/);
});

test('JSON from models is parsed even when wrapped in code fences or prose', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Sure! {"a":2} hope that helps'), { a: 2 });
  assert.throws(() => parseJson('nope'));
});
