import test from 'node:test';
import assert from 'node:assert/strict';
import { geoapifySearch, geoapifyTest, categoriesForQuery } from '../lib/geoapify.js';

const realFetch = globalThis.fetch;

function mockGeoapify(handler) {
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    const u = new URL(String(url));
    seen.push({ url: u, path: u.pathname, params: Object.fromEntries(u.searchParams), opts });
    return handler(u);
  };
  return () => seen;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('Geoapify categories map common business words and prefer gaming over bars', () => {
  const gaming = categoriesForQuery('gaming lounge');
  assert.ok(gaming.includes('entertainment.amusement_arcade'));
  assert.ok(!gaming.includes('catering.bar'));

  assert.ok(categoriesForQuery('lounge').includes('catering.bar'));
  assert.ok(categoriesForQuery('private school').includes('education.school'));
  assert.ok(categoriesForQuery('microfinance bank').includes('service.financial.bank'));
  assert.ok(categoriesForQuery('logistics company').includes('office.logistics'));
  assert.ok(categoriesForQuery('hr consulting firm').includes('office.consulting'));
  assert.equal(categoriesForQuery('quantum widget'), null);
});

test('Geoapify geocodes the area, searches categories, and reads contact details', async () => {
  const seen = mockGeoapify((u) => {
    if (u.pathname === '/v1/geocode/search') {
      return json({ results: [{ place_id: 'city-1', formatted: 'Lagos, Nigeria', lon: 3.394, lat: 6.455 }] });
    }
    if (u.pathname === '/v2/places') {
      return json({
        features: [
          { properties: { place_id: 'place-1', name: 'Pixel Games', formatted: '1 Admiralty Way, Lekki' } },
          { properties: { place_id: 'place-2', name: 'Arcade Two', formatted: '2 Road, Lekki' } },
          { properties: { name: 'No Geoapify id' } },
        ],
      });
    }
    if (u.pathname === '/v2/place-details') {
      const id = u.searchParams.get('id');
      return json({
        features: [{
          properties: {
            name: id === 'place-1' ? 'Pixel Games' : 'Arcade Two',
            website: id === 'place-1' ? 'https://pixelgames.ng/' : '',
            contact: id === 'place-1'
              ? { phone: '+234 801 234 5678', phone_other: ['0803 555 0000'], email: 'hello@pixelgames.ng', email_other: ['sales@pixelgames.ng'] }
              : { phone: '0803 111 2222' },
            formatted: id === 'place-1' ? '1 Admiralty Way, Lekki, Lagos' : '2 Road, Lekki, Lagos',
            description: 'Gaming lounge in Lekki',
          },
        }],
      });
    }
    throw new Error('unexpected Geoapify path ' + u.pathname);
  });

  try {
    const out = await geoapifySearch({ query: 'gaming lounge', location: 'Lagos, Nigeria', limit: 2, apiKey: 'secret-geo', cc: '234' });
    const calls = seen();
    const geocode = calls.find((c) => c.path === '/v1/geocode/search');
    const places = calls.find((c) => c.path === '/v2/places');
    const details = calls.filter((c) => c.path === '/v2/place-details');

    assert.equal(geocode.params.text, 'Lagos, Nigeria');
    assert.match(places.params.categories, /entertainment\.amusement_arcade/);
    assert.equal(places.params.filter, 'place:city-1');
    assert.equal(places.params.limit, '4');
    assert.equal(places.params.bias, 'proximity:3.394,6.455');
    assert.deepEqual(details.map((c) => c.params.id), ['place-1', 'place-2']);
    assert.ok(calls.every((c) => c.params.apiKey === 'secret-geo'));

    assert.equal(out.candidates.length, 2);
    const pixel = out.candidates.find((c) => c.name === 'Pixel Games');
    assert.equal(pixel.website, 'https://pixelgames.ng');
    assert.deepEqual(pixel.phones, ['+2348012345678', '+2348035550000']);
    assert.deepEqual(pixel.emails, ['hello@pixelgames.ng', 'sales@pixelgames.ng']);
    assert.equal(pixel.address, '1 Admiralty Way, Lekki, Lagos');
    assert.equal(pixel.source, 'geoapify');

    assert.equal(out.credits, 4, '1 geocode + 1 for two places + 2 place details');
    assert.equal(out.failed, 0);
    assert.equal(out.area, 'Lagos, Nigeria');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Geoapify errors are clear and never leak the API key', async () => {
  const cases = [
    [401, { message: 'bad key secret-geo' }, /rejected the API key/],
    [403, { message: 'forbidden' }, /rejected the API key/],
    [429, { message: 'slow down' }, /rate limit/],
    [422, { message: 'bad filter' }, /could not use that request/],
  ];
  for (const [status, body, expected] of cases) {
    mockGeoapify(() => json(body, status));
    try {
      await assert.rejects(
        () => geoapifySearch({ query: 'gaming lounge', location: 'Lagos', apiKey: 'secret-geo' }),
        (e) => expected.test(e.message) && !e.message.includes('secret-geo'),
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});

test('Geoapify key test makes one minimal geocoding request', async () => {
  const seen = mockGeoapify(() => json({ results: [{ place_id: 'city-1', formatted: 'Lagos, Nigeria' }] }));
  try {
    const out = await geoapifyTest('secret-geo');
    const calls = seen();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/v1/geocode/search');
    assert.equal(calls[0].params.text, 'Lagos, Nigeria');
    assert.equal(out.sample, 'Lagos, Nigeria');
    assert.equal(out.credits, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
