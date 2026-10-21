import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXERCISES_SEED } from '../exercisesSeedData';
import { EXERCISES_V3_DRAFT, ACTIVITIES_V3_DRAFT } from '../exercisesV3DraftData';

const registryPath = resolve('src/data/exerciseV3VideoAssets.ts');
const registry = readFileSync(registryPath, 'utf8');
const entries = [...registry.matchAll(/'([a-z0-9-]+)':\s*\{([\s\S]*?)\}/g)];
const mediaDirectory = resolve('assets/videos/exercises-v3');

describe('exercise video registry', () => {
  it('keeps each referenced local media file and its catalog identity', () => {
    const ids = new Set([...EXERCISES_SEED, ...EXERCISES_V3_DRAFT, ...ACTIVITIES_V3_DRAFT].map(item => item.id));
    expect(entries.length).toBeGreaterThan(0);
    for (const [, id, body] of entries) {
      expect(ids.has(id)).toBe(true);
      for (const [, asset] of body.matchAll(/require\('([^']+)'\)/g)) {
        expect(existsSync(resolve('src/data', asset))).toBe(true);
      }
    }
  });
});
