import fs from 'node:fs';
import { parse } from 'csv-parse';

/**
 * Read a CSV file and return an array of objects keyed by header names.
 *
 * Notes
 * - Uses streaming parse to avoid loading the whole file into memory.
 * - Empty lines are skipped; headers are required.
 *
 * @param filePath Absolute or relative path to the CSV file.
 * @returns Array of rows as string-keyed objects.
 * @example
 * const rows = await readCsv('data/sample.csv');
 * console.log(rows[0].website);
 */
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

/**
 * Write data as pretty-printed JSON to a file.
 *
 * @param filePath Output path (parent directory must exist).
 * @param data Any JSON-serializable value.
 */
export function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
