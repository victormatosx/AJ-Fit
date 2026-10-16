import { describe, expect, it } from 'vitest';
import { buildEvolutionProgressTickerItems } from '../evolutionProgressTickerItems';

const translate = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;

const baseInput = {
  weightDeltaKg: null,
  lastAssessmentMeasuredAt: null,
  recordsLast90DaysCount: null,
  assessmentsCount: null,
  resolvedUnits: 'metric' as const,
  t: translate,
};

describe('buildEvolutionProgressTickerItems', () => {
  it('returns no items when every input is absent', () => {
    expect(buildEvolutionProgressTickerItems(baseInput)).toEqual([]);
  });

  it('shows a signed, unit-converted weight delta only when one exists', () => {
    const lost = buildEvolutionProgressTickerItems({ ...baseInput, weightDeltaKg: -1.2 });
    expect(lost).toEqual([{ label: 'progress.ticker.weightSince', value: '−1.2 kg' }]);

    const gained = buildEvolutionProgressTickerItems({ ...baseInput, weightDeltaKg: 0.8 });
    expect(gained).toEqual([{ label: 'progress.ticker.weightSince', value: '+0.8 kg' }]);
  });

  it('converts the weight delta for imperial units', () => {
    const items = buildEvolutionProgressTickerItems({ ...baseInput, weightDeltaKg: -1, resolvedUnits: 'imperial' });
    expect(items).toEqual([{ label: 'progress.ticker.weightSince', value: '−2.2 lb' }]);
  });

  it('labels "today" for an assessment measured today, and pluralizes otherwise', () => {
    const today = buildEvolutionProgressTickerItems({ ...baseInput, lastAssessmentMeasuredAt: new Date() });
    expect(today).toEqual([{ label: 'progress.ticker.lastAssessment', value: 'progress.loads.ago.today' }]);

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const days = buildEvolutionProgressTickerItems({ ...baseInput, lastAssessmentMeasuredAt: threeDaysAgo });
    expect(days).toEqual([{ label: 'progress.ticker.lastAssessment', value: 'progress.loads.ago.days:{"count":3}' }]);

    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const weeks = buildEvolutionProgressTickerItems({ ...baseInput, lastAssessmentMeasuredAt: twoWeeksAgo });
    expect(weeks).toEqual([{ label: 'progress.ticker.lastAssessment', value: 'progress.loads.ago.weeks:{"count":2}' }]);

    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const months = buildEvolutionProgressTickerItems({ ...baseInput, lastAssessmentMeasuredAt: twoMonthsAgo });
    expect(months).toEqual([{ label: 'progress.ticker.lastAssessment', value: 'progress.loads.ago.months:{"count":2}' }]);
  });

  it('shows a real zero for 90-day records once load history exists, but omits it entirely with none', () => {
    const noHistory = buildEvolutionProgressTickerItems({ ...baseInput, recordsLast90DaysCount: null });
    expect(noHistory).toEqual([]);

    const zeroRecords = buildEvolutionProgressTickerItems({ ...baseInput, recordsLast90DaysCount: 0 });
    expect(zeroRecords).toEqual([{ label: 'progress.ticker.records90d', value: '0' }]);

    const threeRecords = buildEvolutionProgressTickerItems({ ...baseInput, recordsLast90DaysCount: 3 });
    expect(threeRecords).toEqual([{ label: 'progress.ticker.records90d', value: '3' }]);
  });

  it('omits the assessments-logged item when there are none, shows the count otherwise', () => {
    expect(buildEvolutionProgressTickerItems({ ...baseInput, assessmentsCount: null })).toEqual([]);
    expect(buildEvolutionProgressTickerItems({ ...baseInput, assessmentsCount: 5 }))
      .toEqual([{ label: 'progress.ticker.assessmentsLogged', value: '5' }]);
  });

  it('combines every available item in a fixed order: weight, last assessment, records, assessments', () => {
    const items = buildEvolutionProgressTickerItems({
      weightDeltaKg: -1.2,
      lastAssessmentMeasuredAt: new Date(),
      recordsLast90DaysCount: 2,
      assessmentsCount: 5,
      resolvedUnits: 'metric',
      t: translate,
    });
    expect(items.map((item) => item.label)).toEqual([
      'progress.ticker.weightSince',
      'progress.ticker.lastAssessment',
      'progress.ticker.records90d',
      'progress.ticker.assessmentsLogged',
    ]);
  });
});
