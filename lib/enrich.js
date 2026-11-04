/**
 * Technology stack and CMS detector: profiles what technologies, ecommerce platforms,
 * and CMS frameworks a lead's website is running.
 */

const TECH_SIGNATURES = [
  { name: 'WordPress', pattern: /wp-content|wp-includes|<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*WordPress|<link rel=["']https?:\/\/api\.w\.org\/["']/i },
  { name: 'WooCommerce', pattern: /woocommerce|wc-block|woocommerce-Price-amount/i },
  { name: 'Shopify', pattern: /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i },
  { name: 'Wix', pattern: /wix\.com|wix-image|static\.parastorage\.com|X-Wix/i },
  { name: 'Squarespace', pattern: /static1\.squarespace\.com|squarespace/i },
  { name: 'Webflow', pattern: /assets\.website-files\.com|wf-page|data-wf-site/i },
  { name: 'Next.js', pattern: /__NEXT_DATA__|_next\/static/i },
  { name: 'Nuxt', pattern: /__NUXT__|_nuxt\//i },
  { name: 'React', pattern: /data-reactroot|react-dom/i },
  { name: 'Joomla', pattern: /joomla|<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*Joomla/i },
  { name: 'Drupal', pattern: /drupal|<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*Drupal/i },
  { name: 'Magento', pattern: /mage\/|static\/version.*\/frontend/i },
  { name: 'Google Analytics', pattern: /googletagmanager\.com|google-analytics\.com/i },
  { name: 'Meta Pixel', pattern: /fbevents\.js|fbq\(/i },
  { name: 'Cloudflare', pattern: /__cf_bm|cdn-cgi|cloudflare/i },
  { name: 'Paystack', pattern: /paystack\.co|paystack\.com|inline\.paystack|paystack\.js/i },
  { name: 'Flutterwave', pattern: /flutterwave\.com|rave\.js|flutterwave\.js/i },
];

export function detectTechStack(html = '', headers = {}) {
  const content = String(html || '');
  const out = new Set();

  for (const sig of TECH_SIGNATURES) {
    if (sig.pattern.test(content)) {
      out.add(sig.name);
    }
  }

  // Check headers for Cloudflare / server
  if (headers && typeof headers === 'object') {
    const s = String(headers.server || headers.Server || '').toLowerCase();
    const cf = String(headers['cf-ray'] || headers['CF-Ray'] || '');
    if (s.includes('cloudflare') || cf) out.add('Cloudflare');
    if (s.includes('nginx')) out.add('Nginx');
    if (s.includes('apache')) out.add('Apache');
  }

  return [...out].slice(0, 8);
}
