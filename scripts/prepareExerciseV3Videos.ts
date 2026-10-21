/** Offline only: no fetch, upload, paid API, publishing or catalog activation. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXERCISES_V3_DRAFT, ACTIVITIES_V3_DRAFT } from '../src/data/exercisesV3DraftData';
import { prepareVideo, writeContactSheet, type VideoSource } from './lib/exerciseV3VideoPipeline';

const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--sources');
const outputIndex = args.indexOf('--out');
if (sourceIndex < 0 || outputIndex < 0 || !args[sourceIndex + 1] || !args[outputIndex + 1]) {
  throw new Error('Usage: node --import tsx scripts/prepareExerciseV3Videos.ts --sources <local.json> --out <local-directory>');
}
const sources = JSON.parse(readFileSync(resolve(args[sourceIndex + 1]), 'utf8')) as VideoSource[];
if (!Array.isArray(sources) || sources.length === 0) throw new Error('NO_LOCAL_SOURCES');
const draftIds = new Set([...EXERCISES_V3_DRAFT, ...ACTIVITIES_V3_DRAFT].map((exercise) => exercise.id));
const keys = sources.map((source) => `${source.exerciseId}:${source.orientation}`);
if (new Set(keys).size !== keys.length) throw new Error('DUPLICATE_EXERCISE_ORIENTATION');
for (const source of sources) {
  const { output } = prepareVideo(source, draftIds, args[outputIndex + 1]);
  writeContactSheet(output, `${output}.contact.jpg`);
  process.stdout.write(`${output}: PRODUZIDO — AGUARDANDO REVISÃO\n`);
}
