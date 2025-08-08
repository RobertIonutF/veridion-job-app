import * as cheerio from 'cheerio';
import { findPhoneNumbersInText } from 'libphonenumber-js/max';

const SOCIAL_PATTERNS = {
  facebook: [/facebook\.com\//i, /m\.facebook\.com\//i, /l\.facebook\.com\//i],
  linkedin: [/linkedin\.com\//i],
  twitter: [/x\.com\//i, /twitter\.com\//i],
  instagram: [/instagram\.com\//i],
  youtube: [/youtube\.com\//i, /youtu\.be\//i],
};

export function extractFromHtml(html: string, baseUrl: string) {
  const $ = cheerio.load(html);

  // Phones: search text and tel: links; use libphonenumber-js to validate.
  const bodyText = $('body').text() || '';
  const region = inferRegionFromUrl(baseUrl) || 'US';
  const found = findPhoneNumbersInText(bodyText, { defaultCountry: region as any });
  const phonesFromText = found.map((r) => r.number.number);
  const links: string[] = [];
  $('a[href^="tel:"]').each((_, el) => {
    const href = String($(el).attr('href') || '');
    if (href) links.push(href);
  });
  const phonesFromLinks = links.map((h) => h.replace(/^tel:/i, ''));
  const rawPhones = [...phonesFromText, ...phonesFromLinks].map(normalizePhone).filter(Boolean) as string[];

  // Social links: anchors + JSON-LD sameAs
  const social: Record<string, string[]> = {};
  $('a[href]').each((_, el) => {
    const href = String($(el).attr('href') || '').trim();
    if (!href) return;
    const abs = canonicalizeUrl(toAbsoluteUrl(href, baseUrl));
    for (const [network, patterns] of Object.entries(SOCIAL_PATTERNS)) {
      if (patterns.some((r) => r.test(abs))) {
        social[network] = social[network] || [];
        social[network].push(abs);
      }
    }
  });

  // JSON-LD sameAs
  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).contents().text();
    try {
      if (!txt || txt.length > 200_000) return; // guard huge blobs
      const json = JSON.parse(txt);
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        const sameAs = item?.sameAs as string[] | undefined;
        if (sameAs && Array.isArray(sameAs)) {
          for (const url of sameAs) {
            const abs = canonicalizeUrl(toAbsoluteUrl(url, baseUrl));
            for (const [network, patterns] of Object.entries(SOCIAL_PATTERNS)) {
              if (patterns.some((r) => r.test(abs))) {
                social[network] = social[network] || [];
                social[network].push(abs);
              }
            }
          }
        }
        if (item?.telephone && typeof item.telephone === 'string') {
          const p = normalizePhone(String(item.telephone));
          if (p) rawPhones.push(p);
        }
      }
  } catch { /* ignore invalid JSON-LD */ }
  });

  const address = extractAddress($);

  return { phones: uniq(rawPhones), social: dedupeSocial(social), address };
}

function toAbsoluteUrl(href: string, base: string) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function normalizePhone(p: string) {
  const cleaned = p.trim()
    .replace(/\s+/g, ' ')
    .replace(/[()\.\-]/g, '')
    .replace(/^\+\+/, '+');
  const digits = cleaned.replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length < 7) return undefined;
  return digits;
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function dedupeSocial(input: Record<string, string[]>) {
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(input)) {
    out[k] = Array.from(new Set(input[k].map(canonicalizeUrl)));
  }
  return out;
}

function extractAddress($: cheerio.CheerioAPI): string | undefined {
  const sel = 'address, [itemprop="address"], .address, .Address';
  const text = $(sel).first().text().trim();
  if (text && /[\w\s,.-]{10,}/.test(text)) return text;
  return undefined;
}

function canonicalizeUrl(u: string) {
  try {
    // Unwrap facebook outbound links
    if (/l\.facebook\.com\//i.test(u) && /[?&]u=/.test(u)) {
      const url = new URL(u);
      const wrapped = url.searchParams.get('u');
      if (wrapped) u = decodeURIComponent(wrapped);
    }
    const url = new URL(u);
    url.hash = '';
    // strip tracking params
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid','mc_cid','mc_eid'].forEach((p) => url.searchParams.delete(p));
    return url.toString();
  } catch {
    return u.split('?')[0];
  }
}

function inferRegionFromUrl(u: string): string | undefined {
  try {
    const host = new URL(u).host.toLowerCase();
    const tld = host.split('.').pop();
    const map: Record<string, string> = {
      us: 'US', ca: 'CA', mx: 'MX', br: 'BR', ar: 'AR', cl: 'CL', co: 'CO',
      uk: 'GB', gb: 'GB', ie: 'IE', fr: 'FR', de: 'DE', at: 'AT', ch: 'CH',
      it: 'IT', es: 'ES', pt: 'PT', nl: 'NL', be: 'BE', se: 'SE', no: 'NO', fi: 'FI', dk: 'DK',
      pl: 'PL', cz: 'CZ', sk: 'SK', hu: 'HU', ro: 'RO', bg: 'BG', gr: 'GR',
      au: 'AU', nz: 'NZ', in: 'IN', sg: 'SG', hk: 'HK', jp: 'JP', kr: 'KR', cn: 'CN'
    };
    return tld ? map[tld] : undefined;
  } catch { return undefined; }
}
