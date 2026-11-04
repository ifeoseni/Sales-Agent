import { load, save } from './store.js';

// PLACEHOLDERS: edit these in the dashboard (Products tab) so the agent only
// says things that are true about your software.
const EVENTOS = {
  id: 'eventos',
  name: 'Event Owner App (EventOS)',
  type: 'service',
  tagline: 'One shareable link runs the whole celebration — invites, RSVP, aso-ebi, gifts, vendors and check-in.',
  description:
    'All-in-one event planning and management platform for Nigerian celebrations: weddings, birthdays, owambe, naming ceremonies and corporate events. One link handles digital invitations, RSVP tracking, aso-ebi ordering, cash and gift registries, vendor and venue booking, seating and run-of-show, and live QR guest check-in. Includes Paystack checkout, an AI planning assistant, an installable PWA and the Event Owner App for hosts on mobile.',
  features: [
    'Digital invitations and RSVP tracking',
    'Aso-ebi ordering with stock-safe checkout',
    'Cash and physical gift registry',
    'Vendor and venue booking',
    'QR-code guest check-in and ticketing',
    'Seating plans and run-of-show',
    'Live photo wall and spraying animations',
    'Paystack payments and AI planning assistant',
    'PWA and native Event Owner App',
  ],
  idealCustomers: ['event planners', 'wedding planners', 'event venues', 'conference organisers', 'corporate event managers', 'event vendors'],
  searchQueries: ['event planning company', 'wedding planner', 'event venue', 'conference organiser', 'corporate event manager'],
  price: '',
  demoUrl: 'https://eventownerapp.com',
  status: 'active',
};

const SEED_VERSION = 3;

const SEED = [
  EVENTOS,
  {
    id: 'gamecenter',
    name: 'GameCenter',
    type: 'product',
    tagline: 'Run a gaming lounge or arcade without paper and guesswork.',
    description:
      'Management software for game centres and gaming lounges: track stations and play sessions, bill by time or package, manage customers and tournaments, and see daily revenue.',
    features: ['Session timers and station tracking', 'Billing and receipts', 'Customer records and loyalty', 'Tournaments', 'Daily revenue reports'],
    idealCustomers: ['gaming lounge owners', 'PlayStation / game centre operators', 'arcade owners', 'internet cafes', 'entertainment centres'],
    searchQueries: ['gaming lounge', 'game center', 'playstation gaming centre', 'arcade'],
    price: '',
    demoUrl: '',
    status: 'active',
  },
  {
    id: 'hrsolutioneventos',
    name: 'HRSolutionEventos',
    type: 'product',
    tagline: 'HR and event operations in one place.',
    description:
      'Platform for HR teams and event organisers: staff records and scheduling, event staffing, attendee registration and check-in, and reporting.',
    features: ['Staff records and scheduling', 'Event staffing and attendance', 'Registration and check-in', 'Reports'],
    idealCustomers: ['event planners', 'HR departments of mid-size companies', 'staffing agencies', 'conference organisers', 'hospitality businesses'],
    searchQueries: ['event planning company', 'staffing agency', 'conference organiser', 'hr consulting firm'],
    price: '',
    demoUrl: '',
    status: 'active',
  },
  {
    id: 'goalbuddy',
    name: 'Goal Buddy',
    type: 'product',
    tagline: 'Milestone tracking with peer verification and staking.',
    description:
      'Milestone tracking dashboard with transparent peer verification and blockchain-based smart contract staking for accountability. Currently in development.',
    features: ['Milestone dashboard', 'Peer verification', 'Smart contract staking'],
    idealCustomers: ['coaches', 'accountability groups', 'online communities', 'fitness and learning programmes'],
    searchQueries: ['life coach', 'fitness coach', 'online learning academy'],
    price: '',
    demoUrl: '',
    status: 'in development',
  },
  {
    id: 'services',
    name: 'IT Consulting and Custom Software',
    type: 'service',
    tagline: 'Security-first software, cybersecurity audits and data/AI.',
    description:
      'Custom software and database architecture, cybersecurity vulnerability assessments and penetration testing, machine learning and analytics pipelines, IT consulting and training.',
    features: ['Custom software', 'Cybersecurity audits and pen-testing', 'Data science and AI', 'IT consulting and training'],
    idealCustomers: ['SMEs needing software', 'fintechs', 'schools', 'logistics companies', 'clinics and hospitals'],
    searchQueries: ['logistics company', 'private school', 'microfinance bank', 'clinic'],
    price: '',
    demoUrl: '',
    status: 'active',
  },
];

let products = load('products', null);
const seeded = load('seed', {}) || {};
const seedVersion = Number(seeded.products) || 0;
if (!Array.isArray(products) || !products.length) {
  products = SEED;
  save('products', products);
} else if (!seedVersion) {
  // One-time upgrade for installs seeded before EventOS existed: add it at the
  // front without touching offers the admin has already edited or added.
  if (!products.some((p) => p && p.id === EVENTOS.id)) {
    products = [{ ...EVENTOS }, ...products];
    save('products', products);
  }
} else if (seedVersion < SEED_VERSION) {
  // v2 → v3: correct the public name and add the live demo link, but only where
  // the admin has not already renamed the offer or set their own URL.
  let changed = false;
  products = products.map((p) => {
    if (!p || p.id !== EVENTOS.id) return p;
    const next = { ...p };
    let touched = false;
    if (next.name === 'EventOS') { next.name = EVENTOS.name; touched = true; }
    if (!next.demoUrl) { next.demoUrl = EVENTOS.demoUrl; touched = true; }
    if (touched) changed = true;
    return touched ? next : p;
  });
  if (changed) save('products', products);
}
// Record the seed version so removing EventOS in the dashboard sticks across restarts.
if (seedVersion < SEED_VERSION) save('seed', { ...seeded, products: SEED_VERSION });

export const getProducts = () => products;

export function setProducts(list) {
  products = (Array.isArray(list) ? list : []).map((p, i) => ({
    id: String(p.id || p.name || 'item' + i).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item' + i,
    name: String(p.name || 'Untitled'),
    type: p.type === 'service' ? 'service' : 'product',
    tagline: String(p.tagline || ''),
    description: String(p.description || ''),
    features: [].concat(p.features || []).map(String).filter(Boolean),
    idealCustomers: [].concat(p.idealCustomers || []).map(String).filter(Boolean),
    searchQueries: [].concat(p.searchQueries || []).map(String).filter(Boolean),
    price: String(p.price || ''),
    demoUrl: String(p.demoUrl || ''),
    status: String(p.status || 'active'),
  }));
  save('products', products);
  return products;
}
