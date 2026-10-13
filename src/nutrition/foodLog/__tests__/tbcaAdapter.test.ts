import { describe, expect, it } from 'vitest';
import { mapTbcaRecordToFoodLog, type RawTbcaRecord } from '../tbcaAdapter';
import { normalizeFoodLogRecord } from '../normalize';

// Synthetic fixture only — NOT real TBCA data (no TBCA dataset has been
// downloaded or persisted anywhere in this repo; round brief C3 Part 9).
const fixture = (): RawTbcaRecord => ({
  tbcaId: 'TBCA-TEST-0001', name: 'Alimento de teste, cozido', foodGroup: 'Cereais e derivados',
  energyKcal: 130, proteinG: 2.7, carbsG: 28, lipidsG: 0.3, fiberG: 1.2, tbcaVersion: 'synthetic-fixture-v0',
});

describe('mapTbcaRecordToFoodLog (scaffold, no real data)', () => {
  it('maps into a RawFoodLogRecord the normalizer accepts as-is', () => {
    const raw = mapTbcaRecordToFoodLog(fixture());
    expect(() => normalizeFoodLogRecord(raw, 'tbca-scaffold-v1')).not.toThrow();
  });

  it('always marks the license as proprietary_contract with attribution required, never configurable looser', () => {
    const raw = mapTbcaRecordToFoodLog(fixture());
    expect(raw.provenance).toMatchObject({ license: 'proprietary_contract', attributionRequired: true });
    expect(raw.provenance.attributionText).toContain('USP');
  });

  it('produces a stable flc_tbca_ id via the shared id scheme', () => {
    const raw = mapTbcaRecordToFoodLog(fixture());
    const food = normalizeFoodLogRecord(raw, 'tbca-scaffold-v1');
    expect(food.id).toMatch(/^flc_tbca_/);
  });
});
