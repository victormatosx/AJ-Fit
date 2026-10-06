import { describe, expect, it } from 'vitest';

import { classifyWorkoutFinalizationError } from '../finalizationErrorClassification';

describe('classifyWorkoutFinalizationError', () => {
  it('buckets offline/unavailable callable errors as OFFLINE', () => {
    expect(classifyWorkoutFinalizationError({ code: 'functions/unavailable' })).toBe('OFFLINE');
    expect(classifyWorkoutFinalizationError({ code: 'unavailable' })).toBe('OFFLINE');
  });

  it('buckets deadline-exceeded as TIMEOUT', () => {
    expect(classifyWorkoutFinalizationError({ code: 'functions/deadline-exceeded' })).toBe('TIMEOUT');
    expect(classifyWorkoutFinalizationError({ code: 'deadline-exceeded' })).toBe('TIMEOUT');
  });

  it('buckets backend business-rule rejections as VALIDATION', () => {
    expect(classifyWorkoutFinalizationError({ code: 'functions/failed-precondition' })).toBe('VALIDATION');
    expect(classifyWorkoutFinalizationError({ code: 'failed-precondition' })).toBe('VALIDATION');
    expect(classifyWorkoutFinalizationError({ code: 'permission-denied' })).toBe('VALIDATION');
    expect(classifyWorkoutFinalizationError({ code: 'invalid-argument' })).toBe('VALIDATION');
    // Same code as cardio, different message — must NOT be special-cased.
    expect(classifyWorkoutFinalizationError({
      code: 'functions/failed-precondition', message: 'schedule_completion_session_not_expected',
    })).toBe('VALIDATION');
  });

  it('singles out the specific cardio-pending rejection out of the generic failed-precondition bucket', () => {
    expect(classifyWorkoutFinalizationError({
      code: 'functions/failed-precondition', message: 'cardio_completion_required',
    })).toBe('CARDIO_COMPLETION_REQUIRED');
    expect(classifyWorkoutFinalizationError({
      code: 'failed-precondition', message: 'cardio_completion_required',
    })).toBe('CARDIO_COMPLETION_REQUIRED');
    // Same message text under a different code must not match — it isn't a
    // failed-precondition at that point, so it can't be this rejection.
    expect(classifyWorkoutFinalizationError({
      code: 'functions/internal', message: 'cardio_completion_required',
    })).toBe('UNKNOWN');
  });

  it('falls back to UNKNOWN for anything else, including a plain thrown Error', () => {
    expect(classifyWorkoutFinalizationError(new Error('boom'))).toBe('UNKNOWN');
    expect(classifyWorkoutFinalizationError({ code: 'functions/internal' })).toBe('UNKNOWN');
    expect(classifyWorkoutFinalizationError(null)).toBe('UNKNOWN');
    expect(classifyWorkoutFinalizationError(undefined)).toBe('UNKNOWN');
  });
});
