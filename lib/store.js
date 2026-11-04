import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(DIR, { recursive: true });

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file

export function load(name, fallback) {
  const file = path.join(DIR, name + '.json');
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_FILE_BYTES) {
      console.error(`Data file too large (${Math.round(stat.size / 1024 / 1024)} MB): ${file}. Archive or delete old records.`);
      return fallback;
    }
    if (stat.size === 0) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    // Corrupted JSON: rename the broken file for recovery, start fresh.
    if (e instanceof SyntaxError) {
      const bak = file + '.' + Date.now() + '.corrupt';
      try { fs.renameSync(file, bak); console.error(`Corrupted data file backed up to ${bak}`); } catch {}
    }
    return fallback;
  }
}

export function save(name, data) {
  const file = path.join(DIR, name + '.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
