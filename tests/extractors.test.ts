import { describe, it, expect } from 'vitest';
import { extractFromHtml } from '../src/scraper/extractors.js';

const html = `
<html><body>
  <a href="tel:+1 (415) 555-1212">Call</a>
  <a href="https://facebook.com/acme">fb</a>
  <a href="https://www.linkedin.com/company/acme">li</a>
  <address>123 Market St, San Francisco, CA</address>
  <script type="application/ld+json">{
    "@context":"https://schema.org", "sameAs":["https://twitter.com/acme"]
  }</script>
</body></html>`;

describe('extractFromHtml', () => {
  it('finds phones, socials, and address', () => {
    const res = extractFromHtml(html, 'https://acme.com');
    expect(res.phones.length).toBeGreaterThan(0);
    expect(Object.values(res.social).some(a => a.length)).toBe(true);
    expect(res.address).toContain('Market');
  });
});
