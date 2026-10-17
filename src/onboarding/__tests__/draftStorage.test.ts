import { nutritionDraftAnswers, emptyOnboardingNutrition } from '../nutritionDraft';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const localStore = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => localStore.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      localStore.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      localStore.delete(key);
    }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  bindOnboardingDraft,
  bindOnboardingHealthSnapshot,
  acknowledgeOnboardingHealthChoice,
  buildDraft,
  clearOnboardingDraft,
  draftToQuiz,
  ONBOARDING_DRAFT_STORAGE_KEY,
  readOnboardingDraft,
  writeOnboardingDraft,
} from '../draftStorage';
import { defaultQuiz } from '../../state/AppState';

beforeEach(() => {
  localStore.clear();
  vi.clearAllMocks();
});

describe('draft round-trip', () => {
  it('persists and restores step id, name and answers (including birthDate)', async () => {
    const quiz = { ...defaultQuiz, goal: 'hyper' as const, days: 5, birthDate: new Date('1998-03-15') };
    const draft = buildDraft({ currentStepId: 'weight', name: 'Ana', healthIntegrationChoice: 'connect', quiz });

    await writeOnboardingDraft(draft);
    const restored = await readOnboardingDraft();

    expect(restored?.currentStepId).toBe('weight');
    expect(restored?.name).toBe('Ana');
    expect(restored?.healthIntegrationChoice).toBe('connect');
    const restoredQuiz = draftToQuiz(restored!);
    expect(restoredQuiz.goal).toBe('hyper');
    expect(restoredQuiz.days).toBe(5);
    expect(restoredQuiz.birthDate?.toISOString()).toBe(new Date('1998-03-15').toISOString());
  });

  it('round-trips a null birthDate without crashing', async () => {
    const draft = buildDraft({ currentStepId: 'sex', name: null, healthIntegrationChoice: null, quiz: defaultQuiz });
    await writeOnboardingDraft(draft);
    const restored = await readOnboardingDraft();
    expect(draftToQuiz(restored!).birthDate).toBeNull();
  });
});

describe('missing/corrupted/future-versioned draft', () => {
  it('migrates legacy per-question pregnancy and postpartum cursors to grouped screens', async () => {
    for (const [legacy, grouped] of [
      ['pregnancyComplication', 'pregnancyCare'],
      ['postpartumDeliveryType', 'postpartumContext'],
    ]) {
      localStore.set(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, currentStepId: legacy, answers: { sex: 'f', specialConditions: [legacy.startsWith('pregnancy') ? 'pregnancy' : 'postpartum'] } }));
      await expect(readOnboardingDraft()).resolves.toMatchObject({ currentStepId: grouped });
    }
  });

  it('moves a draft paused on the removed motivation step to goal and drops its answer', async () => {
    localStore.set(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify({
      version: 1,
      currentStepId: 'motivation',
      answers: { motivation: 'strength' },
    }));
    const restored = await readOnboardingDraft();
    expect(restored?.currentStepId).toBe('goal');
    expect(Object.prototype.hasOwnProperty.call(draftToQuiz(restored!), 'motivation')).toBe(false);
  });

  it('moves a draft paused on primaryPlace to place and folds its legacy answer into place', async () => {
    localStore.set(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify({
      version: 1,
      currentStepId: 'primaryPlace',
      answers: { place: 'both', primaryPlace: 'home' },
    }));
    const restored = await readOnboardingDraft();
    expect(restored?.currentStepId).toBe('place');
    const quiz = draftToQuiz(restored!);
    expect(quiz.place).toBe('home');
    expect(Object.prototype.hasOwnProperty.call(quiz, 'primaryPlace')).toBe(false);
  });

  it.each(['scheduleMode', 'trainingDays'])('moves a draft paused on removed %s to the unified days step', async (legacyStep) => {
    localStore.set(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify({
      version: 1,
      currentStepId: legacyStep,
      answers: {
        days: 3,
        scheduleMode: 'fixed',
        trainingDays: ['MON', 'WED', 'FRI'],
      },
    }));
    const restored = await readOnboardingDraft();
    expect(restored?.currentStepId).toBe('days');
    expect(draftToQuiz(restored!)).toMatchObject({
      days: 3,
      scheduleMode: 'fixed',
      trainingDays: ['MON', 'WED', 'FRI'],
    });
  });

  it('returns null when nothing is stored', async () => {
    await expect(readOnboardingDraft()).resolves.toBeNull();
  });

  it('discards invalid JSON instead of throwing', async () => {
    localStore.set(ONBOARDING_DRAFT_STORAGE_KEY, '{not json');
    await expect(readOnboardingDraft()).resolves.toBeNull();
  });

  it('discards an object with the wrong version instead of throwing', async () => {
    localStore.set(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify({ version: 99, currentStepId: 'goal' }));
    await expect(readOnboardingDraft()).resolves.toBeNull();
  });

  it('discards a shape missing currentStepId', async () => {
    localStore.set(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify({ version: 1 }));
    await expect(readOnboardingDraft()).resolves.toBeNull();
  });

  it('falls back to defaultQuiz fields for a sparse answers object', async () => {
    localStore.set(
      ONBOARDING_DRAFT_STORAGE_KEY,
      JSON.stringify({ version: 1, currentStepId: 'goal', name: null, answers: { goal: 'cut' } }),
    );
    const restored = await readOnboardingDraft();
    const quiz = draftToQuiz(restored!);
    expect(quiz.goal).toBe('cut');
    expect(quiz.limits).toEqual([]);
    expect(quiz.equipment).toEqual([]);
  });

  it('returns null when storage read fails', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('offline'));
    await expect(readOnboardingDraft()).resolves.toBeNull();
  });

  it('Fase 5: a draft written before healthIntegrationChoice existed migrates to null, not a fabricated choice', async () => {
    localStore.set(
      ONBOARDING_DRAFT_STORAGE_KEY,
      JSON.stringify({ version: 1, currentStepId: 'goal', name: null, answers: { goal: 'cut' } }),
    );
    const restored = await readOnboardingDraft();
    expect(restored?.healthIntegrationChoice).toBeNull();
  });

  it('Fase 5: discards a bogus healthIntegrationChoice value instead of trusting it', async () => {
    localStore.set(
      ONBOARDING_DRAFT_STORAGE_KEY,
      JSON.stringify({
        version: 1, currentStepId: 'goal', name: null, healthIntegrationChoice: 'yes please', answers: {},
      }),
    );
    const restored = await readOnboardingDraft();
    expect(restored?.healthIntegrationChoice).toBeNull();
  });
});

describe('clearOnboardingDraft', () => {
  it('removes the stored draft and is idempotent', async () => {
    await writeOnboardingDraft(buildDraft({ currentStepId: 'goal', name: 'Ana', healthIntegrationChoice: null, quiz: defaultQuiz }));
    await clearOnboardingDraft();
    await expect(readOnboardingDraft()).resolves.toBeNull();
    // Calling again on an already-absent key must not throw.
    await expect(clearOnboardingDraft()).resolves.toBeUndefined();
  });
});

describe('nutrition draft retention and handoff', () => {
  it('expires abandoned drafts after 30 days but retains account-bound pending transfers', async () => {
    const draft = buildDraft({ currentStepId: 'weight', name: null, healthIntegrationChoice: null, quiz: defaultQuiz });
    draft.updatedAt = new Date(Date.now() - 31 * 86400000).toISOString();
    localStore.set(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    expect(await readOnboardingDraft()).toBeNull();
    localStore.set(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify({ ...draft, transfer: { uid: 'alice', status: 'pending' } }));
    expect((await readOnboardingDraft())?.transfer?.uid).toBe('alice');
  });
  it('moves a resumed v1 completed training flow to nutrition without losing training answers', async () => {
    localStore.set(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, currentStepId: 'plan', answers: { goal: 'health', weight: 75 } }));
    const draft = await readOnboardingDraft();
    expect(draft?.currentStepId).toBe('nutrition_progressionPace');
    expect(draft?.answers.weight).toBe(75);
  });
});

describe('target weight JSON recovery', () => {
  it('retains raw invalid text rather than converting NaN into a skipped answer', async () => {
    const nutrition = { ...emptyOnboardingNutrition(), targetWeightText: '80kg', targetWeightUnits: 'metric' as const };
    const draft = buildDraft({ currentStepId: 'nutrition_targetWeightKg', name: null, healthIntegrationChoice: null, quiz: defaultQuiz, nutrition });
    await writeOnboardingDraft(draft);
    const restored = (await readOnboardingDraft())!.nutrition;
    expect(restored.targetWeightText).toBe('80kg');
    expect(Number.isNaN(nutritionDraftAnswers(restored).targetWeightKg)).toBe(true);
  });
  it('preserves pounds across process restarts independently of current display preferences', async () => {
    const nutrition = { ...emptyOnboardingNutrition(), targetWeightText: '180', targetWeightUnits: 'imperial' as const };
    const draft = buildDraft({ currentStepId: 'nutrition_targetWeightKg', name: null, healthIntegrationChoice: null, quiz: defaultQuiz, nutrition });
    await writeOnboardingDraft(draft);
    const restored = (await readOnboardingDraft())!.nutrition;
    expect(restored.targetWeightUnits).toBe('imperial');
    expect(nutritionDraftAnswers(restored).targetWeightKg).toBeCloseTo(81.6466, 4);
  });
});

describe('scoped cleanup and legacy health ownership', () => {
  it('never clears a pending transfer for another UID or session', async () => {
    const nutrition = emptyOnboardingNutrition(); nutrition.completed = true;
    const draft = buildDraft({ currentStepId: 'plan', quiz: defaultQuiz, name: null, healthIntegrationChoice: 'connect', nutrition });
    draft.sessionId = 'session-123'; await writeOnboardingDraft(draft); await bindOnboardingDraft('u', 'session-123');
    await clearOnboardingDraft({ uid: 'other', sessionId: 'session-123' });
    expect(await readOnboardingDraft()).not.toBeNull();
    await clearOnboardingDraft({ uid: 'u', sessionId: 'wrong' });
    expect(await readOnboardingDraft()).not.toBeNull();
    await clearOnboardingDraft({ uid: 'u', sessionId: 'session-123' });
    expect(await readOnboardingDraft()).toBeNull();
  });
  it('binds and consumes a legacy choice independently, retaining partial nutrition', async () => {
    const draft = buildDraft({ currentStepId: 'goal', quiz: defaultQuiz, name: null, healthIntegrationChoice: 'connect' });
    draft.nutrition.targetWeightText = '123.4'; await writeOnboardingDraft(draft);
    await bindOnboardingHealthSnapshot('u', draft);
    await acknowledgeOnboardingHealthChoice('other');
    expect((await readOnboardingDraft())?.healthIntegrationChoice).toBe('connect');
    await acknowledgeOnboardingHealthChoice('u');
    expect((await readOnboardingDraft())?.healthIntegrationChoice).toBeNull();
    expect((await readOnboardingDraft())?.nutrition.targetWeightText).toBe('123.4');
  });
});
