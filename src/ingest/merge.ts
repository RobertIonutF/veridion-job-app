import 'dotenv/config';
import fs from 'node:fs';
import { readCsv, writeJson } from '../utils/csv.js';

async function main() {
  const namesCsvPath = process.env.NAMES_INPUT || process.argv[2] || 'data/sample-websites-company-names.csv';
  const scrapedJsonPath = process.env.SCRAPED_OUT || process.argv[3] || 'out/scraped.json';
  const profilesOutPath = process.env.PROFILES_OUT || 'out/profiles.json';

  const nameRows = await readCsv(namesCsvPath);
  const scraped: { data: any[] } = JSON.parse(fs.readFileSync(scrapedJsonPath, 'utf-8'));

  const nameByWebsite = new Map<string, string>();
  for (const row of nameRows) {
    const website = canonicalizeWebsite(row.website || row.domain || row.url || '');
    const name = (row.name || row.company_name || '').trim();
    if (website && name) nameByWebsite.set(website, name);
  }

  const merged = scraped.data.map((row) => ({
    website: row.website,
    name: nameByWebsite.get(canonicalizeWebsite(row.website)) || undefined,
    phones: row.phones || [],
    social: row.social || {},
    address: row.address || undefined,
  }));

  writeJson(profilesOutPath, merged);
  console.log(`Merged ${merged.length} profiles -> ${profilesOutPath}`);
}

function canonicalizeWebsite(u: string) {
  try {
    const url = new URL(u.startsWith('http') ? u : `https://${u}`);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/$/, '');
    return url.toString();
  } catch {
    return u;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
