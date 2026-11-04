import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, assertPublicUrl, cleanUrl } from '../lib/net.js';

test('private / internal addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('crawler refuses to fetch internal or odd URLs (SSRF)', async () => {
  for (const u of ['http://127.0.0.1/', 'http://localhost:3000/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://10.0.0.5/', 'ftp://example.com/', 'file:///etc/passwd', 'http://example.com:8080/', 'http://printer.local/']) {
    await assert.rejects(() => assertPublicUrl(u), undefined, u);
  }
  await assert.doesNotReject(() => assertPublicUrl('http://93.184.216.34/'));
});

test('cleanUrl keeps only safe http(s) addresses', () => {
  assert.equal(cleanUrl('acme.com'), 'https://acme.com');
  assert.equal(cleanUrl('https://acme.com/path/'), 'https://acme.com/path');
  assert.equal(cleanUrl('javascript:alert(1)'), '');
  assert.equal(cleanUrl('data:text/html,<script>1</script>'), '');
  assert.equal(cleanUrl('http://localhost'), '');
  assert.equal(cleanUrl(''), '');
  assert.equal(cleanUrl('a'.repeat(600) + '.com'), '');
});
