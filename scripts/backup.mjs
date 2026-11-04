// Copies data/ (leads, chats, settings, products) into backups/<timestamp>/ and keeps the newest 14.
// If TELEGRAM_CHANNEL_ID is configured, it also sends leads.json to your private Telegram channel.
// Run:  npm run backup      (schedule it daily; see DEPLOY.md)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const out = path.resolve(process.env.BACKUP_DIR || path.join(root, 'backups'));

try { process.loadEnvFile(path.join(root, '.env')); } catch {}

if (!fs.existsSync(data)) { console.error('Nothing to back up: ' + data + ' does not exist'); process.exit(1); }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.join(out, stamp);
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(data)) if (f.endsWith('.json')) fs.copyFileSync(path.join(data, f), path.join(dest, f));

const all = fs.readdirSync(out).filter((d) => /^\d{4}-/.test(d)).sort();
for (const old of all.slice(0, Math.max(0, all.length - 14))) fs.rmSync(path.join(out, old), { recursive: true, force: true });
console.log(`Backed up to ${dest} (${fs.readdirSync(dest).length} files). Keeping the newest 14. Note: settings.json contains your API keys, so keep backups private.`);

// Optional Telegram Channel Backup
const token = process.env.TELEGRAM_BOT_TOKEN;
const channelId = process.env.TELEGRAM_CHANNEL_ID;
const leadsFile = path.join(data, 'leads.json');

if (token && channelId && fs.existsSync(leadsFile)) {
  try {
    let leadCount = 0;
    try { leadCount = JSON.parse(fs.readFileSync(leadsFile, 'utf8')).length; } catch {}

    const form = new FormData();
    form.append('chat_id', channelId);
    form.append('caption', `📦 <b>Code Tech Sales CRM Backup</b>\n📅 Date: ${stamp}\n📊 Total Leads: ${leadCount}\n📁 Attached: leads-${stamp}.json`);
    form.append('parse_mode', 'HTML');
    form.append('document', new Blob([fs.readFileSync(leadsFile)]), `leads-${stamp}.json`);

    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const result = await res.json();
    if (result.ok) {
      console.log(`[Telegram Backup] Uploaded leads-${stamp}.json to Telegram channel (${channelId}).`);
    } else {
      console.error(`[Telegram Backup] Upload failed: ${result.description}`);
    }
  } catch (err) {
    console.error(`[Telegram Backup] Failed to send backup to Telegram: ${err.message}`);
  }
}
