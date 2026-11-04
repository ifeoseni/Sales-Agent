import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-search-'));
const { webSearch, leadsFromUrls } = await import('../lib/leadfinder.js');

test('SearXNG results are used when configured, with the region passed through', async () => {
  let seen;
  const srv = http.createServer((req, res) => {
    seen = new URL(req.url, 'http://x');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ results: [{ url: 'https://pixel.ng', title: 'Pixel <b>Games</b>', content: 'Lounge in Lekki' }, { title: 'no url' }] }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const out = await webSearch('gaming lounge Lekki', '234', `http://127.0.0.1:${srv.address().port}`);
    assert.deepEqual(out, [{ url: 'https://pixel.ng', title: 'Pixel Games', snippet: 'Lounge in Lekki' }]);
    assert.equal(seen.pathname, '/search');
    assert.equal(seen.searchParams.get('format'), 'json');
    assert.equal(seen.searchParams.get('q'), 'gaming lounge Lekki');
    assert.equal(seen.searchParams.get('language'), 'ng-en');
  } finally { srv.close(); }
});

test('pasted website lists are cleaned, de-duplicated and never reach internal hosts', async () => {
  const msgs = [];
  const r = await leadsFromUrls(
    ['javascript:alert(1)', '', 'http://127.0.0.1:9/', 'http://localhost/admin', 'http://169.254.169.254/latest', 'http://127.0.0.1:9/again'],
    {},
    (m) => msgs.push(m),
  );
  assert.equal(r.leads.length, 0);
  assert.ok(msgs.some((m) => /unreachable/.test(m)), msgs.join(' | '));
  assert.ok(msgs.some((m) => /Reading 1 websites|Reading 2 websites|Reading 3 websites/.test(m)), 'junk and duplicates removed before crawling: ' + msgs.join(' | '));
});
