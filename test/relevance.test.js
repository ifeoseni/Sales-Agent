import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rel-'));
const { isRelevant } = await import('../lib/leadfinder.js');

const q = 'event planner';
const loc = 'Lagos, Nigeria';

test('keeps businesses that match the topic and the place', () => {
  assert.equal(isRelevant({ name: 'Glam Events Lagos', description: 'Wedding and event planning', website: 'https://glam.com.ng' }, q, loc, '234'), true);
  // topic words in any form (planning/planners/events) and place via phone number
  assert.equal(isRelevant({ name: 'Elite Planners', description: 'We plan your events', website: 'https://elite.com', phones: ['+2348031234567'] }, q, loc, '234'), true);
  // place via country-code domain
  assert.equal(isRelevant({ name: 'Bright Events', description: 'Event management', website: 'https://bright.ng' }, q, loc, '234'), true);
});

test('drops results from the wrong place or about the wrong thing', () => {
  assert.equal(isRelevant({ name: 'University of Westminster, London', description: 'Study events in London', website: 'https://www.westminster.ac.uk' }, q, loc, '234'), false);
  assert.equal(isRelevant({ name: 'UK Postcodes', description: 'Find all about UK postcodes', website: 'https://ukpostcodecheck.com' }, q, loc, '234'), false);
  assert.equal(isRelevant({ name: 'Lagos Plumbers', description: 'Pipes and taps in Lagos', website: 'https://plumb.ng' }, q, loc, '234'), false);
});

test('gaming-style queries match game/games/gaming', () => {
  assert.equal(isRelevant({ name: 'Pixel Games Lounge', description: 'Playstation in Lekki, Lagos', website: 'https://pixel.ng' }, 'gaming lounge', 'Lekki, Lagos', '234'), true);
});
