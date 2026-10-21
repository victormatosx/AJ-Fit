import { describe, expect, it } from 'vitest';
import pt from '../../../i18n/resources/pt-BR/nutrition.json';
import en from '../../../i18n/resources/en/nutrition.json';
import es from '../../../i18n/resources/es/nutrition.json';
import {
  generationFailureCopyKey, generationStageKey, isGenerationRequestErrorRetryable, isGenerationRetryable,
  mapGenerationRequestError,
} from '../generationStage';

it('distinguishes reviewer rejection, unavailability and exhaustion with honest copy in all three languages', () => {
  expect(generationFailureCopyKey('AI_REVIEW_REJECTED')).toBe('reviewNotApproved');
  expect(generationFailureCopyKey('AI_EVIDENCE_INSUFFICIENT')).toBe('reviewNotApproved');
  expect(generationFailureCopyKey('AI_REVIEW_SCHEMA_INVALID')).toBe('reviewUnavailable');
  expect(generationFailureCopyKey('AI_REVIEW_PROVIDER_REFUSAL')).toBe('reviewUnavailable');
  expect(generationFailureCopyKey('AI_RETRY_EXHAUSTED')).toBe('attemptsExhausted');
  for (const locale of [pt, en, es]) for (const key of ['reviewNotApproved', 'reviewUnavailable', 'attemptsExhausted'] as const) {
    expect(locale.generating[key].title.length).toBeGreaterThan(0);
    expect(locale.generating[key].body.length).toBeGreaterThan(0);
    expect(locale.generating[key].body).not.toMatch(/gravidez|pregnan|embaraz|amamenta|breastfeed|lactancia/i);
  }
  expect(isGenerationRetryable('AI_REVIEW_PROVIDER_REFUSAL')).toBe(true);
  expect(generationFailureCopyKey('AI_DETERMINISTIC_SAFETY_BLOCKED')).toBe('safetyBlocked');
  expect(isGenerationRetryable('AI_DETERMINISTIC_SAFETY_BLOCKED')).toBe(false);
});

describe('generationStageKey', () => {
  it('maps every job status to a stage key, never fabricating a percentage', () => {
    expect(generationStageKey('queued')).toBe('queued');
    expect(generationStageKey('running')).toBe('running');
    expect(generationStageKey('validating')).toBe('validating');
    expect(generationStageKey('completed')).toBe('completing');
  });
});

describe('generationFailureCopyKey', () => {
  it('buckets every terminal error code into one of a small safe set, never the raw code', () => {
    expect(generationFailureCopyKey('FEATURE_DISABLED')).toBe('disabled');
    expect(generationFailureCopyKey('AI_SAFETY_VALIDATION_FAILED')).toBe('safetyBlocked');
    expect(generationFailureCopyKey('ACCOUNT_INACTIVE')).toBe('accountInactive');
    expect(generationFailureCopyKey('AI_PROVIDER_ERROR')).toBe('genericError');
    expect(generationFailureCopyKey(null)).toBe('genericError');
    expect(generationFailureCopyKey(undefined)).toBe('genericError');
  });

  it('buckets AI_PROVIDER_REFUSAL and AI_CONTENT_SAFETY_MISMATCH as generic/retryable, never the hard safety block', () => {
    // Both are one-off model misses (an opaque refusal, or the AI's own
    // draft failing OUR unweakened allergen/dietary-pattern check) rather
    // than a permanent condition of the account's profile — unlike
    // AI_SAFETY_VALIDATION_FAILED (reserved for a critical substance
    // exclusion needing catalog-verified foods), neither should show the
    // non-retryable "safetyBlocked" copy. Regression: UID
    // `2cbGGTGybdW0khZIiRreAzcBuGF3` (vegetarian + excluded `milk`) was
    // permanently stranded by AI_CONTENT_SAFETY_MISMATCH sharing that bucket.
    expect(generationFailureCopyKey('AI_PROVIDER_REFUSAL')).toBe('genericError');
    expect(generationFailureCopyKey('AI_CONTENT_SAFETY_MISMATCH')).toBe('genericError');
  });
});

describe('isGenerationRetryable', () => {
  it('refuses a retry CTA for safety/feature/account failures', () => {
    for (const code of ['AI_SAFETY_VALIDATION_FAILED', 'FEATURE_DISABLED', 'ACCOUNT_INACTIVE'] as const) {
      expect(isGenerationRetryable(code)).toBe(false);
    }
  });

  it('allows retry for transient/model failures and for no code at all', () => {
    expect(isGenerationRetryable('AI_TIMEOUT')).toBe(true);
    expect(isGenerationRetryable('AI_RATE_LIMIT')).toBe(true);
    expect(isGenerationRetryable('AI_PROVIDER_ERROR')).toBe(true);
    expect(isGenerationRetryable('AI_PROVIDER_REFUSAL')).toBe(true);
    expect(isGenerationRetryable('AI_CONTENT_SAFETY_MISMATCH')).toBe(true);
    expect(isGenerationRetryable(null)).toBe(true);
    expect(isGenerationRetryable(undefined)).toBe(true);
  });
});

describe('mapGenerationRequestError', () => {
  it('maps every known HttpsError message to its copy key', () => {
    expect(mapGenerationRequestError(new Error('NUTRITION_GENERATION_DISABLED'))).toBe('disabled');
    expect(mapGenerationRequestError(new Error('NUTRITION_GENERATION_COOLDOWN'))).toBe('cooldown');
    expect(mapGenerationRequestError(new Error('ACCOUNT_INACTIVE'))).toBe('accountInactive');
  });

  it('maps INVALID_PHYSICAL_CONTEXT to its own non-generic, non-retryable bucket', () => {
    // Regression: a brand-new account with no `assessments` entry yet (weight
    // is read ONLY from the latest assessment, never from the onboarding
    // questionnaire) hits this on every first-generation attempt. It used to
    // fall into `genericError`, which tells the user to "try again in a
    // moment" — misleading, since retrying alone can never succeed.
    expect(mapGenerationRequestError(new Error('INVALID_PHYSICAL_CONTEXT'))).toBe('missingPhysicalContext');
  });

  it('falls back to genericError for anything unrecognized, including non-Error values', () => {
    expect(mapGenerationRequestError(new Error('INVALID_REQUEST'))).toBe('genericError');
    expect(mapGenerationRequestError('boom')).toBe('genericError');
    expect(mapGenerationRequestError(null)).toBe('genericError');
  });
});

describe('isGenerationRequestErrorRetryable', () => {
  it('refuses retry for disabled/accountInactive/missingPhysicalContext', () => {
    expect(isGenerationRequestErrorRetryable('disabled')).toBe(false);
    expect(isGenerationRequestErrorRetryable('accountInactive')).toBe(false);
    expect(isGenerationRequestErrorRetryable('missingPhysicalContext')).toBe(false);
    expect(isGenerationRequestErrorRetryable('cooldown')).toBe(true);
    expect(isGenerationRequestErrorRetryable('genericError')).toBe(true);
  });
});
