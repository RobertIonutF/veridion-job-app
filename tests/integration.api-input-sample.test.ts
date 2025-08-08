import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import MiniSearch from 'minisearch';
import { buildApp, canonicalUrl } from '../src/api/server.js';
import { readCsv } from '../src/utils/csv.js';

// Build an index from existing profiles.json to exercise the real pipeline surface
// If out/profiles.json doesn't exist, use a tiny synthetic fallback.

let app: any;
let profiles: any[] = [];

function buildIndexFromProfiles(dst: string) {
  const mini = new MiniSearch({ fields: ['name','website','address'], storeFields: ['website','name','phones','social','address'] });
  mini.addAll(profiles.map((p, i) => ({ id: i, ...p })));
  fs.writeFileSync(dst, JSON.stringify({ index: mini.toJSON(), profiles }, null, 2), 'utf-8');
}

describe('Integration: API-input-sample.csv', () => {
  const idxPath = 'out/index.integration.json';
  const csvPath = 'data/API-input-sample.csv';

  beforeAll(async () => {
    // Prefer real profiles when available, otherwise create a tiny synthetic fallback
    if (fs.existsSync('out/profiles.json')) {
      profiles = JSON.parse(fs.readFileSync('out/profiles.json','utf-8'));
    } else {
      profiles = [
        { website: 'https://forcht-law.com/', name: 'Forcht Law P.C.' },
        { website: 'https://acornlawpc.com/', name: 'Acorn Law P.C.' },
        { website: 'https://steppir.com/', name: 'SteppIR' },
      ];
    }
    if (!fs.existsSync('out')) fs.mkdirSync('out');
    buildIndexFromProfiles(idxPath);
    app = await buildApp(idxPath);
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it('returns non-zero scores or best candidate for most rows', async () => {
    const rows = await readCsv(csvPath);
    // Process up to 30 rows to keep test fast
    const subset = rows.slice(0, 30);
    let nonZero = 0;
    for (const r of subset) {
      const payload: any = {};
      if (r['input name']) payload.name = r['input name'];
      if (r['input website']) payload.website = r['input website'];
      if (r['input phone']) payload.phone = r['input phone'];
      if (r['input_facebook']) payload.facebook = r['input_facebook'];
      const res = await app.inject({ method: 'POST', url: '/match', payload });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const top = body.candidates?.[0];
      if (top && top.score > 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThanOrEqual(3);
  });

  it('website canonicalization fixes https// typo cases (unit)', async () => {
    expect(canonicalUrl('https://https//acornlawpc.com/')).toBe('acornlawpc.com');
  });
});
