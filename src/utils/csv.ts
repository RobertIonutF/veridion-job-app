import fs from 'node:fs';
import { parse } from 'csv-parse';

export async function readCsv(filePath: string): Promise<Record<string, string>[]> {
  const records: Record<string, string>[] = [];
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true }))
      .on('data', (row) => records.push(row))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return records;
}

export function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
