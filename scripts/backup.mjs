// Copies data/ (leads, chats, settings, products) into backups/<timestamp>/ and keeps the newest 14.
// Run:  npm run backup      (schedule it daily; see DEPLOY.md)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const out = path.resolve(process.env.BACKUP_DIR || path.join(root, 'backups'));

if (!fs.existsSync(data)) { console.error('Nothing to back up: ' + data + ' does not exist'); process.exit(1); }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.join(out, stamp);
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(data)) if (f.endsWith('.json')) fs.copyFileSync(path.join(data, f), path.join(dest, f));

const all = fs.readdirSync(out).filter((d) => /^\d{4}-/.test(d)).sort();
for (const old of all.slice(0, Math.max(0, all.length - 14))) fs.rmSync(path.join(out, old), { recursive: true, force: true });
console.log(`Backed up to ${dest} (${fs.readdirSync(dest).length} files). Keeping the newest 14. Note: settings.json contains your API keys, so keep backups private.`);
