import { describe, expect, it } from 'vitest';

import { resolvePhotoActionsMode, shouldShowRemovePhotoButton } from '../composerUi';

describe('resolvePhotoActionsMode', () => {
  it('is "add" (camera/gallery) with no photo', () => {
    expect(resolvePhotoActionsMode(null)).toBe('add');
    expect(resolvePhotoActionsMode(undefined)).toBe('add');
    expect(resolvePhotoActionsMode('')).toBe('add');
  });

  it('is "change" once a photo uri exists', () => {
    expect(resolvePhotoActionsMode('file:///cache/workout-share/source/a.jpg')).toBe('change');
  });
});

describe('shouldShowRemovePhotoButton', () => {
  it('is false with no photo', () => {
    expect(shouldShowRemovePhotoButton(null)).toBe(false);
    expect(shouldShowRemovePhotoButton(undefined)).toBe(false);
  });

  it('is true once a photo uri exists', () => {
    expect(shouldShowRemovePhotoButton('file:///cache/workout-share/source/a.jpg')).toBe(true);
  });
});
