import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const posterNames = ['Classic', 'Minimal', 'Performance', 'BodyMap', 'Creative', 'Social'];
const posterSources = posterNames.map((name) => read(`../posters/Poster${name}.tsx`));
const registry = read('../artPosters/registry.tsx');
const composer = read('../WorkoutShareComposer.tsx');
const exportArt = read('../../../workoutShare/exportArt.ts');

describe('transparent versions of FOTO posters', () => {
  it('reuses the FOTO components and real workout data in the ARTE registry', () => {
    expect(registry).toContain('WORKOUT_SHARE_POSTERS.find');
    expect(registry).toContain('data={shareData}');
    expect(registry).toContain('sex={sex}');
    expect(registry).toContain('variant="transparent"');
    expect(registry).toContain('photo={null}');
  });

  it('omits every full-canvas background and photo in the transparent variant', () => {
    for (const source of posterSources) {
      expect(source).toContain("variant = 'photo'");
      expect(source).toMatch(/style=\{\{ width, height, overflow: 'hidden', \.\.\.\(variant === 'photo' \? \{ backgroundColor:/);
      expect(source).toContain("variant === 'photo' ? (");
    }
    for (const source of posterSources.filter((_, index) => index !== 4)) {
      expect(source).toContain("variant === 'transparent' ? null : photo ? (");
    }
    expect(posterSources[4]).toContain("source={gymArtSource}");
    expect(posterSources[4]).toMatch(/variant === 'photo' \? \(\s*<Image\s+source=\{gymArtSource\}/);
    expect(posterSources[5]).toMatch(/variant === 'photo' \? \{ backgroundColor: '#050B1E' \} : \{\}/);
  });

  it('previews and exports the same registered component with no checkerboard in the capture', () => {
    expect(composer).toContain('const ArtPosterComponent = poster.Component');
    expect(composer).toContain('const HdPosterComponent = hdPoster.Component');
    expect(composer).toContain('<ArtPreviewCheckerboard');
    const hdStage = composer.slice(composer.indexOf('{hdMountedPosterId ? (() => {'));
    expect(hdStage).not.toContain('<ArtPreviewCheckerboard');
    expect(exportArt).toContain("format: 'png'");
    expect(exportArt).toContain("createWorkoutShareExportUri('png')");
  });

  it('sends the selected PNG through both native actions', () => {
    expect(composer).toContain('copyWorkoutShareArtToClipboard(uri)');
    expect(composer).toContain('saveWorkoutShareArtToLibrary(uri)');
  });
});
