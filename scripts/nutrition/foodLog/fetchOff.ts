#!/usr/bin/env -S node --import tsx
/**
 * Fase C2 — controlled, read-only fetch from the OFFICIAL Open Food Facts
 * v2 search API (no scraping, no credentials needed — public read access
 * per `docs/nutrition/catalog-expansion/02_sources_comparison.md`).
 * Deliberately paced (one request at a time, `--delay-ms` apart, bounded
 * retry/backoff on 429/503) — C1's own benchmark hit OFF's rate limiter
 * even at low volume, and C1 recommends treating this as a periodic bulk
 * sync, never a live per-keystroke search dependency.
 *
 * Writes an incremental checkpoint file after EVERY page (`--out`), so a
 * crash/interrupt partway through loses at most one page, and reruns can
 * resume by raising `--start-page`.
 *
 * Usage: node --import tsx scripts/nutrition/foodLog/fetchOff.ts \
 *   --out scripts/nutrition/sources/off-brazil-raw.json --pages 40 --page-size 100 --delay-ms 7000
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const USER_AGENT = 'AJFit-FoodLogCatalog/1.0 (+contact: victor.matos3112@gmail.com; Fase C2 controlled bulk sync, see docs/nutrition/catalog-expansion)';
const FIELDS = 'code,product_name,brands,categories_tags,countries_tags,nutriments,lang,quantity';

interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  categories_tags?: string[];
  countries_tags?: string[];
  lang?: string;
  nutriments?: Record<string, number | string | undefined>;
}

function flagValue(argv: string[], flag: string, fallback: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
}

function sleep(ms: number): Promise<void> { return new Promise((resolveSleep) => { setTimeout(resolveSleep, ms); }); }

async function fetchPage(page: number, pageSize: number): Promise<OffProduct[]> {
  const url = `https://world.openfoodfacts.org/api/v2/search?countries_tags_en=Brazil&page=${page}&page_size=${pageSize}&fields=${FIELDS}`;
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (response.ok) {
      const data = await response.json() as { products?: OffProduct[] };
      return data.products ?? [];
    }
    if (response.status === 429 || response.status === 503) {
      const backoffMs = 5000 * attempt;
      process.stderr.write(`page ${page}: HTTP ${response.status}, retrying in ${backoffMs}ms (attempt ${attempt}/${maxAttempts})\n`);
      // eslint-disable-next-line no-await-in-loop -- sequential backoff is the point.
      await sleep(backoffMs);
      continue;
    }
    throw new Error(`OFF_FETCH_FAILED:${response.status}`);
  }
  throw new Error(`OFF_FETCH_EXHAUSTED_RETRIES:page_${page}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outPath = resolve(flagValue(args, '--out', 'scripts/nutrition/sources/off-brazil-raw.json'));
  const pages = Number(flagValue(args, '--pages', '20'));
  const pageSize = Number(flagValue(args, '--page-size', '100'));
  const delayMs = Number(flagValue(args, '--delay-ms', '7000'));
  const startPage = Number(flagValue(args, '--start-page', '1'));

  const existing: OffProduct[] = existsSync(outPath) && startPage > 1
    ? JSON.parse(readFileSync(outPath, 'utf8')) as OffProduct[] : [];
  const collected: OffProduct[] = [...existing];

  for (let page = startPage; page < startPage + pages; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- paced, sequential fetch by design (rate-limit friendly).
    const products = await fetchPage(page, pageSize);
    if (products.length === 0) {
      process.stdout.write(`page ${page}: empty, stopping early\n`);
      break;
    }
    collected.push(...products);
    writeFileSync(outPath, JSON.stringify(collected));
    process.stdout.write(`page ${page}: +${products.length} (total ${collected.length})\n`);
    // eslint-disable-next-line no-await-in-loop -- pacing between requests.
    await sleep(delayMs);
  }
  process.stdout.write(JSON.stringify({ totalFetched: collected.length, out: outPath }) + '\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
