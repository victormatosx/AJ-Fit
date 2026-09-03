import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSessionDisplayName } from '../sessionPresentation';

type CanonicalWorkoutsFile = { workouts: Array<{ id: string; sessions: Array<{ name: string; type: string; display_name?: string }> }> };

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), relativePath), 'utf8')) as T;
}

const canonical = readJson<CanonicalWorkoutsFile>(
  'docs/workouts/AJ_Fit_T001_T090_workouts_reformed_v2_0.json',
);

/** Every distinct (name, type) pair actually present across all 90 templates. */
const realSessions = new Map<string, string>();
for (const workout of canonical.workouts) {
  for (const session of workout.sessions) {
    realSessions.set(session.name, session.type);
  }
}

const LOCALES = ['pt-BR', 'en', 'es'] as const;

type WorkoutResource = {
  sessionDisplayNames: Record<string, string>;
  sessionNames: Record<string, string>;
  sessionTypes: Record<string, string>;
};

const resources: Record<(typeof LOCALES)[number], WorkoutResource> = Object.fromEntries(
  LOCALES.map((locale) => [locale, readJson<WorkoutResource>(`src/i18n/resources/${locale}/workout.json`)]),
) as never;

/** Minimal i18next-shaped lookup — resolves `workout:sessionNames.X` / `workout:sessionTypes.X` from the real resource JSON, same `defaultValue` contract `resolveSessionDisplayName` relies on. */
function makeT(locale: (typeof LOCALES)[number]) {
  return (key: string, opts?: Record<string, unknown>): string => {
    const [, path] = key.split(':');
    const [bucket, ...rest] = path.split('.');
    const lookupKey = rest.join('.');
    const table = bucket === 'sessionDisplayNames'
      ? resources[locale].sessionDisplayNames
      : bucket === 'sessionNames'
        ? resources[locale].sessionNames
        : resources[locale].sessionTypes;
    return table[lookupKey] ?? (opts?.defaultValue as string | undefined) ?? key;
  };
}

describe('session name presentation — real T001-T090 catalog vs real i18n resources', () => {
  it('sanity: exactly the audited 47 distinct session names exist in the canonical templates', () => {
    expect(realSessions.size).toBe(47);
  });

  for (const locale of LOCALES) {
    it(`(1) every real session name has a valid, non-empty presentation in ${locale}`, () => {
      const t = makeT(locale);
      for (const [name, type] of realSessions) {
        const label = resolveSessionDisplayName(t, name, type);
        expect(label.length).toBeGreaterThan(0);
      }
    });

    it(`(2) no known session name renders as a raw technical code in ${locale} (bare "A"/"B" must expand)`, () => {
      const t = makeT(locale);
      expect(resolveSessionDisplayName(t, 'A', 'resistance')).not.toBe('A');
      expect(resolveSessionDisplayName(t, 'B', 'resistance')).not.toBe('B');
      // Every catalogued name must have an explicit resource entry — never
      // silently falling through to the type-based or raw-name fallback.
      for (const [name] of realSessions) {
        expect(resources[locale].sessionNames[name]).toBeTruthy();
      }
    });
  }

  it('(3) an unrecognized name falls back to its session type label, never the raw name, when the type is known', () => {
    const t = makeT('pt-BR');
    const label = resolveSessionDisplayName(t, 'T091 Brand New Session Name', 'strength');
    expect(label).toBe(resources['pt-BR'].sessionTypes.strength);
    expect(label).not.toBe('T091 Brand New Session Name');
  });

  it('(3) an unrecognized name AND unrecognized type falls back to the raw name as a last resort — never throws', () => {
    const t = makeT('pt-BR');
    expect(() => resolveSessionDisplayName(t, 'Totally Unknown', 'totally_unknown_type')).not.toThrow();
    expect(resolveSessionDisplayName(t, 'Totally Unknown', 'totally_unknown_type')).toBe('Totally Unknown');
  });

  it('uses localized v2 display_name without leaking its pt-BR authoring value into en/es', () => {
    expect(resolveSessionDisplayName(makeT('pt-BR'), 'Push', 'resistance', 'Peito, Ombros & Tríceps · Push'))
      .toBe('Peito, Ombros & Tríceps · Push');
    expect(resolveSessionDisplayName(makeT('en'), 'Push', 'resistance', 'Peito, Ombros & Tríceps · Push'))
      .toBe('Chest, Shoulders & Triceps · Push');
    expect(resolveSessionDisplayName(makeT('es'), 'Push', 'resistance', 'Peito, Ombros & Tríceps · Push'))
      .toBe('Pecho, Hombros y Tríceps · Empuje');
  });

  it('all 9 real session types have a presentation entry in every locale', () => {
    const realTypes = new Set<string>();
    for (const workout of canonical.workouts) for (const session of workout.sessions) realTypes.add(session.type);
    expect(realTypes.size).toBe(9);
    for (const locale of LOCALES) {
      for (const type of realTypes) {
        const slug = { functional_strength: 'functionalStrength', balance_cardio: 'balanceCardio' }[type] ?? type;
        expect(resources[locale].sessionTypes[slug]).toBeTruthy();
      }
    }
  });
});
