import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-scraper-')); // never touch the real data/ folder
const { extractContacts, findEmails, findPhones, normPhone, classifySocial } = await import('../lib/scraper.js');
const { parseCsv } = await import('../lib/leads.js');

test('normalises Nigerian phone numbers', () => {
  assert.equal(normPhone('0803 123 4567'), '+2348031234567');
  assert.equal(normPhone('+234 803 123 4567'), '+2348031234567');
  assert.equal(normPhone('2348031234567'), '+2348031234567');
  assert.equal(normPhone('12345'), null);
});

test('finds phones in text but ignores dates and ids', () => {
  const t = 'Call 0803 123 4567 or +234 (0) 701 234 5678. Posted 2024-05-12, ref 20240512345.';
  assert.deepEqual(findPhones(t), ['+2348031234567', '+2347012345678']);
  assert.ok(findPhones('Office: +44 20 7946 0958').includes('+442079460958'));
});

test('finds and filters emails, incl. obfuscated', () => {
  assert.deepEqual(findEmails('mail info [at] acme.com.ng or logo@2x.png or user@example.com'), ['info@acme.com.ng']);
});

test('extracts contacts, socials and cloudflare-protected email from html', () => {
  const key = 0x42;
  const enc = 'sales@acme.com'.split('').map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
  const html = `<title>Acme Games | Home</title><meta name="description" content="Best lounge">
    <a href="mailto:hello@acme.com?subject=Hi">mail</a><a href="tel:08031234567">call</a>
    <a href="https://www.facebook.com/acmegames/">fb</a><a href="https://facebook.com/sharer/sharer.php?u=x">share</a>
    <a href="https://instagram.com/acme.games?igsh=1">ig</a><a href="https://wa.me/2348031234567">wa</a>
    <span data-cfemail="42${enc}"></span>`;
  const r = extractContacts(html, 'https://acme.com');
  assert.ok(r.emails.includes('hello@acme.com'));
  assert.ok(r.emails.includes('sales@acme.com'));
  assert.deepEqual(r.phones, ['+2348031234567']);
  assert.equal(r.socials.facebook, 'https://www.facebook.com/acmegames');
  assert.equal(r.socials.instagram, 'https://instagram.com/acme.games');
  assert.equal(r.description, 'Best lounge');
});

test('classifySocial rejects share links and bare homepages', () => {
  assert.equal(classifySocial('https://twitter.com/intent/tweet'), null);
  assert.equal(classifySocial('https://facebook.com/'), null);
  assert.equal(classifySocial('https://linkedin.com/company/acme/').name, 'linkedin');
});

test('csv parser handles quotes and commas', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
});
