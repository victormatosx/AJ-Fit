import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const composerSource = readFileSync(new URL('../WorkoutShareComposer.tsx', import.meta.url), 'utf8');
const logoSource = readFileSync(new URL('../../../workoutShare/logo.ts', import.meta.url), 'utf8');
const backgroundArtSource = readFileSync(new URL('../../../workoutShare/backgroundArt.ts', import.meta.url), 'utf8');

const posterFiles = [
  'PosterClassic',
  'PosterMinimal',
  'PosterPerformance',
  'PosterBodyMap',
  'PosterCreative',
  'PosterSocial',
];

const posterSources = Object.fromEntries(
  posterFiles.map((name) => [
    name,
    readFileSync(new URL(`../posters/${name}.tsx`, import.meta.url), 'utf8'),
  ]),
);

// PosterSocial/PosterCreative need the logo tinted white for their dark
// footer — they read the separately preloaded white-tinted ref instead of
// the default-color one every other poster shares.
const whiteLogoPosterFiles = new Set(['PosterCreative', 'PosterSocial']);

describe('AJ Fit logo preload/cache sharing', () => {
  it('preloads both the default and white-tinted logo once as soon as the composer mounts', () => {
    expect(composerSource).toContain("import { preloadAjLogo, preloadAjLogoWhite } from '../../workoutShare/logo'");
    expect(composerSource).toContain('preloadAjLogo()');
    expect(composerSource).toContain('preloadAjLogoWhite()');
  });

  it('caches each decoded ImageRef in module scope and reuses it across every reader', () => {
    expect(logoSource).toContain('Image.loadAsync(AJ_LOGO_SOURCE)');
    expect(logoSource).toContain('Image.loadAsync(AJ_LOGO_SOURCE, { tintColor: WHITE_TINT })');
    expect(logoSource).toMatch(/if\s*\(\s*!loadPromise\s*\)/);
    expect(logoSource).toMatch(/if\s*\(\s*!loadWhitePromise\s*\)/);
  });

  for (const name of posterFiles) {
    const hookName = whiteLogoPosterFiles.has(name) ? 'useAjLogoWhiteSource' : 'useAjLogoSource';
    it(`${name} reads the shared preloaded logo (${hookName}) instead of resolving its own require()`, () => {
      const source = posterSources[name];
      expect(source).toContain(`${hookName} } from '../../../workoutShare/logo'`);
      expect(source).toContain(`${hookName}()`);
      expect(source).not.toContain("require('../../../../assets/aj-logo.png')");
    });
  }
});

describe('PosterCreative gym background preload/cache sharing', () => {
  it('preloads the gym artwork once as soon as the composer mounts', () => {
    expect(composerSource).toContain("import { preloadWorkoutShareGymArt } from '../../workoutShare/backgroundArt'");
    expect(composerSource).toContain('preloadWorkoutShareGymArt()');
  });

  it('caches the decoded ImageRef in module scope and reuses it across remounts', () => {
    expect(backgroundArtSource).toContain('Image.loadAsync(WORKOUT_SHARE_GYM_ART_SOURCE)');
    expect(backgroundArtSource).toMatch(/if\s*\(\s*!loadPromise\s*\)/);
  });

  it('PosterCreative reads the shared preloaded gym artwork instead of resolving its own require()', () => {
    const source = posterSources.PosterCreative;
    expect(source).toContain("useWorkoutShareGymArtSource } from '../../../workoutShare/backgroundArt'");
    expect(source).toContain('useWorkoutShareGymArtSource()');
    expect(source).not.toContain("require('../../../../assets/share-workout/gym.png')");
  });
});
