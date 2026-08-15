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
    const draft = buildDraft({ currentStepId: 'weight', name: 'Ana', quiz });

    await writeOnboardingDraft(draft);
    const restored = await readOnboardingDraft();

    expect(restored?.currentStepId).toBe('weight');
    expect(restored?.name).toBe('Ana');
    const restoredQuiz = draftToQuiz(restored!);
    expect(restoredQuiz.goal).toBe('hyper');
    expect(restoredQuiz.days).toBe(5);
    expect(restoredQuiz.birthDate?.toISOString()).toBe(new Date('1998-03-15').toISOString());
  });

  it('round-trips a null birthDate without crashing', async () => {
    const draft = buildDraft({ currentStepId: 'sex', name: null, quiz: defaultQuiz });
    await writeOnboardingDraft(draft);
    const restored = await readOnboardingDraft();
    expect(draftToQuiz(restored!).birthDate).toBeNull();
  });
});

describe('missing/corrupted/future-versioned draft', () => {
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
});

describe('clearOnboardingDraft', () => {
  it('removes the stored draft and is idempotent', async () => {
    await writeOnboardingDraft(buildDraft({ currentStepId: 'goal', name: 'Ana', quiz: defaultQuiz }));
    await clearOnboardingDraft();
    await expect(readOnboardingDraft()).resolves.toBeNull();
    // Calling again on an already-absent key must not throw.
    await expect(clearOnboardingDraft()).resolves.toBeUndefined();
  });
});
