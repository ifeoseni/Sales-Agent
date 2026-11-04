const log = document.getElementById('log');
const form = document.getElementById('f');
const input = document.getElementById('i');
const send = document.getElementById('s');

let sid;
try { sid = localStorage.getItem('ct_sid'); } catch { /* storage blocked: session lasts until the page closes */ }
if (!sid) {
  sid = 'w' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem('ct_sid', sid); } catch { /* ignore */ }
}

function add(cls, text) {
  const d = document.createElement('div');
  d.className = 'm ' + cls;
  d.textContent = text;
  log.append(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

async function greet() {
  try {
    const j = await (await fetch('/api/public/info')).json();
    document.getElementById('title').textContent = j.name;
    add('b', `Hi! I'm the ${j.name} assistant. Ask me about ${j.products.slice(0, 3).join(', ')} or what we can build for your business.`);
  } catch {
    add('b', 'Hi! How can I help you today?');
  }
}
greet();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  add('u', text);
  send.disabled = true;
  const typing = add('b', '…');
  typing.setAttribute('aria-label', 'Assistant is typing');
  try {
    const r = await fetch('/api/public/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid, message: text }) });
    const j = await r.json();
    typing.textContent = r.ok ? j.reply : j.error || 'Something went wrong. Please try again.';
  } catch {
    typing.textContent = 'Connection problem. Please check your internet and try again.';
  }
  log.scrollTop = log.scrollHeight;
  send.disabled = false;
  input.focus();
});

document.getElementById('clear').addEventListener('click', async () => {
  await fetch('/api/public/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid }) }).catch(() => {});
  log.textContent = '';
  greet();
});
