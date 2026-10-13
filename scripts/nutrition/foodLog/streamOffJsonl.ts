#!/usr/bin/env -S node --import tsx
/**
 * Fase C3 — official, full-database bulk export
 * (`https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz`,
 * documented at `https://world.openfoodfacts.org/data`), streamed and
 * filtered to Brazil — NOT the paginated search API (`fetchOff.ts`, Fase
 * C2), which hit a sustained rate-limit/block at ~1.000 products
 * (`docs/nutrition/catalog-expansion/09_c2_import_results.md`). No
 * scraping: this is OFF's own published nightly export, fetched once with
 * a single long-lived connection — far gentler on their infrastructure
 * than thousands of small search requests.
 *
 * True streaming: gunzip -> line-by-line JSON parse -> discard immediately
 * unless Brazil-tagged and non-obsolete. The full decompressed file is
 * tens of GB; this process never holds more than one line plus a small
 * flush buffer in memory (round brief C3 Part 3: "streaming, sem carregar
 * o dump inteiro na memória").
 *
 * The file itself is ~13 GB compressed; in this environment's measured
 * ~1.5 MB/s throughput a full pass takes on the order of hours. This
 * script is time-budgeted (`--time-budget-seconds`) rather than
 * line-budgeted so it can be safely re-run in short sessions — each run
 * appends to `--out` and reports exactly how far it scanned
 * (`linesScanned`), so a later run can resume past that point with
 * `--skip-lines` without re-processing (re-downloading is still required —
 * gzip streams aren't byte-seekable — but re-processing cost is the cheap
 * part; network transfer is the bottleneck, documented honestly in
 * `docs/nutrition/catalog-expansion/12_c3_scale_import.md`).
 *
 * Usage:
 *   node --import tsx scripts/nutrition/foodLog/streamOffJsonl.ts \
 *     --out scripts/nutrition/sources/off-brazil-bulk.jsonl \
 *     --time-budget-seconds 1200 [--skip-lines 0]
 */
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';

const DEFAULT_URL = 'https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz';
const USER_AGENT = 'AJFit-FoodLogCatalog/1.0 (+contact: victor.matos3112@gmail.com; Fase C3 one-shot official bulk export stream, see docs/nutrition/catalog-expansion)';

function flagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

interface RawLine { countries_tags?: string[]; obsolete?: boolean; code?: string }

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const url = flagValue(args, '--url') ?? DEFAULT_URL;
  const outPath = resolve(flagValue(args, '--out') ?? 'scripts/nutrition/sources/off-brazil-bulk.jsonl');
  const timeBudgetSeconds = Number(flagValue(args, '--time-budget-seconds') ?? '1200');
  const skipLines = Number(flagValue(args, '--skip-lines') ?? '0');

  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok || !response.body) throw new Error(`OFF_BULK_FETCH_FAILED:${response.status}`);

  const nodeStream = Readable.fromWeb(response.body as never);
  const gunzip = createGunzip();
  nodeStream.pipe(gunzip);
  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });

  const append = existsSync(outPath) && skipLines > 0;
  const out = createWriteStream(outPath, { flags: append ? 'a' : 'w' });

  let linesScanned = 0;
  let brazilMatched = 0;
  let parseErrors = 0;
  const startedAt = Date.now();
  const deadline = startedAt + timeBudgetSeconds * 1000;
  let stoppedReason: 'time_budget' | 'end_of_file' = 'end_of_file';

  for await (const line of rl) {
    linesScanned += 1;
    if (linesScanned <= skipLines) continue;
    if (Date.now() > deadline) { stoppedReason = 'time_budget'; rl.close(); nodeStream.destroy(); break; }
    let parsed: RawLine;
    try {
      parsed = JSON.parse(line) as RawLine;
    } catch {
      parseErrors += 1;
      continue;
    }
    const countries = (parsed.countries_tags ?? []).map((tag) => tag.toLowerCase());
    if (parsed.obsolete === true) continue;
    if (!countries.some((tag) => tag.includes('brazil'))) continue;
    brazilMatched += 1;
    out.write(`${line}\n`);
    if (linesScanned % 200000 === 0) {
      process.stdout.write(`checkpoint: scanned=${linesScanned} brazilMatched=${brazilMatched} elapsedS=${Math.round((Date.now() - startedAt) / 1000)}\n`);
    }
  }
  out.end();

  const report = {
    url, outPath, stoppedReason, linesScanned, brazilMatched, parseErrors,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    outFileBytes: existsSync(outPath) ? statSync(outPath).size : 0,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
