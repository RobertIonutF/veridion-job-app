import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import MiniSearch from 'minisearch';
import { buildApp } from '../src/api/server.js';

// Build a tiny index fixture in-memory and write to out/index.test.json
const profiles = [
  { website: 'https://acme.com', name: 'Acme Inc', phones: ['+14155551212'], social: { facebook: ['https://facebook.com/acme'] }, address: '123 Market St' },
  { website: 'https://contoso.com', name: 'Contoso LLC', phones: ['+442071234567'], social: {}, address: 'London' }
];

function writeIndexFixture(path: string) {
  const mini = new MiniSearch({ fields: ['name','website','address'], storeFields: ['website','name','phones','social','address'] });
  mini.addAll(profiles.map((p, i) => ({ id: i, ...p })));
  fs.writeFileSync(path, JSON.stringify({ index: mini.toJSON(), profiles }, null, 2), 'utf-8');
}

let app: any;

describe('API /match', () => {
  const idxPath = 'out/index.test.json';

  beforeAll(async () => {
    if (!fs.existsSync('out')) fs.mkdirSync('out');
    writeIndexFixture(idxPath);
    app = await buildApp(idxPath);
  await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('matches by exact website', async () => {
    const res = await app.inject({ method: 'POST', url: '/match', payload: { website: 'https://acme.com' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.best?.website).toBe('https://acme.com');
  });

  it('matches by phone', async () => {
    const res = await app.inject({ method: 'POST', url: '/match', payload: { phone: '+1 (415) 555-1212' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.best?.website).toBe('https://acme.com');
  });

  it('matches by facebook', async () => {
    const res = await app.inject({ method: 'POST', url: '/match', payload: { facebook: 'https://facebook.com/acme' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.best?.website).toBe('https://acme.com');
  });
});
