import 'dotenv/config';
import fs from 'node:fs';
import MiniSearch from 'minisearch';

interface Profile { website: string; name?: string; phones?: string[]; social?: Record<string, string[]>; address?: string }

async function main() {
  const profilesPath = process.env.PROFILES_OUT || process.argv[2] || 'out/profiles.json';
  const indexOutPath = process.env.INDEX_PATH || 'out/index.json';
  const profiles: Profile[] = JSON.parse(fs.readFileSync(profilesPath, 'utf-8'));

  const mini = new MiniSearch<Profile>({
    fields: ['name', 'website', 'address'],
    storeFields: ['website', 'name', 'phones', 'social', 'address'],
    searchOptions: { prefix: true, fuzzy: 0.2 }
  });

  mini.addAll(profiles.map((p, i) => ({ id: i, ...p })));

  fs.writeFileSync(indexOutPath, JSON.stringify({ index: mini.toJSON(), profiles }, null, 2));
  console.log(`Indexed ${profiles.length} profiles -> ${indexOutPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
