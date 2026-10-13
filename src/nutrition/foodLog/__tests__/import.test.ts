import { describe, expect, it } from 'vitest';
import { prepareFoodLogImport, parseFoodLogImportFile, type FoodLogImportFile } from '../import';
import type { RawFoodLogRecord } from '../normalize';

const record = (overrides: Partial<RawFoodLogRecord> = {}): RawFoodLogRecord => ({
  source: { type: 'taco', sourceId: '1', sourceName: 'TACO' },
  name: 'Arroz', category: 'cereal',
  nutritionPer100g: { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, fiberG: null },
  provenance: { license: 'public_domain', attributionRequired: false },
  ...overrides,
});

describe('prepareFoodLogImport', () => {
  it('is idempotent — importing the same file twice yields the same ids/content', () => {
    const file: FoodLogImportFile = { schemaVersion: 1, catalogVersion: 'v1', records: [record()] };
    const first = prepareFoodLogImport(file);
    const second = prepareFoodLogImport(file);
    expect(first.foods).toEqual(second.foods);
    expect(first.rejected).toEqual([]);
  });

  it('rejects a broken record (invalid category) without failing the whole batch', () => {
    const file: FoodLogImportFile = { schemaVersion: 1, catalogVersion: 'v1',
      records: [record(), record({ source: { type: 'taco', sourceId: '2', sourceName: 'TACO' }, category: 'not-a-real-category' })] };
    const { foods, rejected } = prepareFoodLogImport(file);
    expect(foods).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe('INVALID_FOOD_CATEGORY');
  });

  it('rejects conflicting duplicate ids (same source+sourceId, different content) within one file', () => {
    const file: FoodLogImportFile = { schemaVersion: 1, catalogVersion: 'v1',
      records: [record(), record({ name: 'Arroz (outro nome)' })] };
    const { foods, rejected } = prepareFoodLogImport(file);
    expect(foods).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/^CONFLICTING_DUPLICATE_FOOD:/);
  });

  it('is safe to rerun — two identical records (same source+sourceId+content) collapse into one, no reject', () => {
    const file: FoodLogImportFile = { schemaVersion: 1, catalogVersion: 'v1', records: [record(), record()] };
    const { foods, rejected } = prepareFoodLogImport(file);
    expect(foods).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });
});

describe('parseFoodLogImportFile', () => {
  it('rejects malformed files', () => {
    expect(() => parseFoodLogImportFile('not json')).toThrow();
    expect(() => parseFoodLogImportFile(JSON.stringify({ schemaVersion: 2, catalogVersion: 'v1', records: [] }))).toThrow('INVALID_FOOD_LOG_IMPORT');
    expect(() => parseFoodLogImportFile(JSON.stringify({ schemaVersion: 1, records: [] }))).toThrow('INVALID_FOOD_LOG_IMPORT');
  });
  it('parses a well-formed file', () => {
    const text = JSON.stringify({ schemaVersion: 1, catalogVersion: 'v1', records: [record()] });
    const file = parseFoodLogImportFile(text);
    expect(file.records).toHaveLength(1);
  });
});
