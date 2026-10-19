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

  it('(3) an unrecognized name always falls back to its own raw authorial name — never the session type label', () => {
    const t = makeT('pt-BR');
    const label = resolveSessionDisplayName(t, 'T091 Brand New Session Name', 'strength');
    expect(label).toBe('T091 Brand New Session Name');
    expect(label).not.toBe(resources['pt-BR'].sessionTypes.strength);
  });

  it('(3) an unrecognized name AND unrecognized type falls back to the raw name as a last resort — never throws', () => {
    const t = makeT('pt-BR');
    expect(() => resolveSessionDisplayName(t, 'Totally Unknown', 'totally_unknown_type')).not.toThrow();
    expect(resolveSessionDisplayName(t, 'Totally Unknown', 'totally_unknown_type')).toBe('Totally Unknown');
  });

  it('(4) a session sharing type "resistance" with many others (e.g. every T091+ Push/Pull/Legs session) never collapses to the generic type label', () => {
    const t = makeT('pt-BR');
    for (const name of ['Push A', 'Pull A', 'Lower 1 — Quadríceps/Panturrilha', 'Upper Extra', 'Lower 2 — Posterior/Glúteos']) {
      const label = resolveSessionDisplayName(t, name, 'resistance');
      expect(label).toBe(name);
      expect(label).not.toBe(resources['pt-BR'].sessionTypes.resistance);
    }
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

describe('session name presentation — real v1.27 T001-T102 catalog (regression: v1.27 rollout collapsed every "resistance" session to its type label)', () => {
  type CanonicalV127File = {
    workouts: Array<{
      id: string;
      profile: { sex: string; environment: string; primary_goal: string; days_per_week: number };
      sessions: Array<{ name: string; type: string; display_name?: string }>;
    }>;
  };

  const canonicalV127 = readJson<CanonicalV127File>(
    'docs/workouts/AJ_Fit_T001_T102_workouts_canonical_v1_33_peck_deck_runtime_id_fixed.json',
  );

  it('reproduces the reported case (female, gym, 5x/week, hypertrophy — T016): every authorial session name survives, none collapses to "Resistência"', () => {
    const workout = canonicalV127.workouts.find((w) => w.id === 'T016');
    if (!workout) throw new Error('fixture T016 not found in canonical v1.27 file');
    expect(workout.profile).toEqual({
      sex: 'female',
      environment: 'gym',
      primary_goal: 'hypertrophy_body_composition',
      days_per_week: 5,
    });

    const t = makeT('pt-BR');
    const labels = workout.sessions.map((session) =>
      resolveSessionDisplayName(t, session.name, session.type, session.display_name),
    );
    expect(labels).toEqual(['Lower A — Posterior/Glúteos', 'Upper A — Anterior', 'Lower B — Quadríceps', 'Upper B — Posterior', 'Lower C — Glúteos/Posterior']);
    for (const label of labels) expect(label).not.toBe(resources['pt-BR'].sessionTypes.resistance);
  });

  it('every session across all 102 v1.27 templates renders as its own authorial name or a strictly more specific localization — never the generic type label', () => {
    for (const locale of LOCALES) {
      const t = makeT(locale);
      for (const workout of canonicalV127.workouts) {
        for (const session of workout.sessions) {
          const label = resolveSessionDisplayName(t, session.name, session.type, session.display_name);
          expect(label.length).toBeGreaterThan(0);
          const genericTypeLabel = resources[locale].sessionTypes[
            { functional_strength: 'functionalStrength', balance_cardio: 'balanceCardio', active_recovery: 'activeRecovery' }[session.type] ?? session.type
          ];
          const isCatalogued = Boolean(resources[locale].sessionNames[session.name]);
          // A name genuinely absent from the catalog must render as itself,
          // never as the generic type label — that coincidence is only
          // acceptable when a translator deliberately catalogued this exact
          // name to read the same as its type (e.g. "Cardio + Equilíbrio").
          if (!isCatalogued) {
            expect(label).toBe(session.name);
          }
        }
      }
    }
  });
});
