import { describe, expect, it } from 'vitest';

import { WORKOUT_SHARE_DESTINATIONS } from '../shareDestinations';

describe('workout share destinations registry', () => {
  it('has exactly 6 destinations', () => {
    expect(WORKOUT_SHARE_DESTINATIONS).toHaveLength(6);
  });

  it('orders destinations exactly: Instagram Stories, Instagram, TikTok, Facebook, WhatsApp, Outro', () => {
    expect(WORKOUT_SHARE_DESTINATIONS.map((destination) => destination.id)).toEqual([
      'instagramStories',
      'instagram',
      'tiktok',
      'facebook',
      'whatsapp',
      'generic',
    ]);
  });

  it('keeps Instagram Stories a distinct destination from general Instagram', () => {
    const ids = WORKOUT_SHARE_DESTINATIONS.map((destination) => destination.id);
    expect(ids).toContain('instagramStories');
    expect(ids).toContain('instagram');
    expect(ids.filter((id) => id === 'instagramStories' || id === 'instagram')).toHaveLength(2);
  });

  it('gives every brand destination a real brand icon, never an emoji or a lettered circle placeholder', () => {
    const brandDestinations = WORKOUT_SHARE_DESTINATIONS.filter((destination) => destination.id !== 'generic');
    for (const destination of brandDestinations) {
      expect(destination.icon.kind, destination.id).toBe('brand');
    }
  });

  it('gives "Outro" a neutral system icon, not a brand mark', () => {
    const other = WORKOUT_SHARE_DESTINATIONS.find((destination) => destination.id === 'generic');
    expect(other?.icon).toEqual({ kind: 'system', name: 'share' });
  });

  it('every destination id has a unique i18n label key', () => {
    const keys = WORKOUT_SHARE_DESTINATIONS.map((destination) => destination.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
