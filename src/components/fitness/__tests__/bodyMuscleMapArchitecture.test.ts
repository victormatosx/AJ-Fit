import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function productionTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : productionTsxFiles(path);
    }
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

const bodyMap = source('../BodyMuscleMap.tsx');
const onboarding = source('../../../screens/OnboardingFunnelScreen.tsx');
const picker = source('../../onboarding/MuscleFocusBodyMapPicker.tsx');
const appShell = source('../../../screens/AppShell.tsx');
const home = source('../../../screens/HomeScreen.tsx');
const workout = source('../../../screens/WorkoutScreen.tsx');
const summary = source('../../workoutSummary/WorkoutSummaryScreen.tsx');
const musclesWorked = source('../../workoutSummary/MusclesWorkedSection.tsx');
const composer = source('../../workoutShare/WorkoutShareComposer.tsx');
const posterTypes = source('../../workoutShare/posters/types.ts');
const posterBodyMap = source('../../workoutShare/posters/PosterBodyMap.tsx');
const posterCreative = source('../../workoutShare/posters/PosterCreative.tsx');
const anatomy = source('../../../data/bodyMuscleMapAnatomy.ts');
const femaleAnatomy = source('../../../data/bodyMuscleMapFemaleAnatomy.ts');
const notices = readFileSync(`${PROJECT_ROOT}/THIRD_PARTY_NOTICES.md`, 'utf8');
const packageJson = readFileSync(`${PROJECT_ROOT}/package.json`, 'utf8');

describe('Body Map sex propagation architecture', () => {
  it('requires sex at the central component and keeps anatomy resolution centralized', () => {
    expect(bodyMap).toContain('sex: Sex;');
    expect(bodyMap).toContain('const anatomy = getBodyMuscleMapAnatomy(sex);');
    expect(bodyMap).toContain('diagram={anatomy.front}');
    expect(bodyMap).toContain('diagram={anatomy.back}');
    expect(bodyMap).toContain('onPress={() => onMusclePress?.(muscleId)}');
    expect(bodyMap).toContain("bodyMuscleMapPathKey(diagramKey, 'outline', part, index)");
    expect(bodyMap).toContain("bodyMuscleMapPathKey(diagramKey, 'hit', muscle, index)");
    expect(bodyMap).toContain("bodyMuscleMapPathKey(diagramKey, 'visual', muscle, index)");
    expect(bodyMap).not.toContain('const key = muscle.id');
    expect(bodyMap).not.toContain('useAuth(');
  });

  it('passes in-memory quiz.sex to onboarding without a Firestore dependency or male fallback', () => {
    expect(onboarding).toContain('isMuscleFocusQuestion && quiz.sex');
    expect(onboarding).toContain('sex={quiz.sex}');
    expect(picker).toContain('sex: Sex;');
    expect(picker).toContain('sex={sex}');
    expect(picker).not.toContain('BODY_MUSCLE_MAP_MALE');
    expect(picker).not.toContain('useAuth(');
  });

  it('derives authenticated sex once from the authoritative questionnaire and guards unresolved state', () => {
    expect(appShell).toContain('const sex = questionnaire?.answers.sex;');
    expect(appShell).toContain('if (!sex) return <FullScreenLoading />;');
    expect(appShell).toContain('<HomeScreen\n            sex={sex}');
    expect(appShell).toContain('<WorkoutScreen\n              sex={sex}');
    expect(home).toContain('sex: Sex;');
    expect(home).toContain('<BodyMuscleMap\n                    sex={sex}');
  });

  it('propagates sex through completion summary and muscles worked', () => {
    expect(workout).toContain('<WorkoutSummaryScreen\n          sex={sex}');
    expect(summary).toContain('<MusclesWorkedSection sex={sex}');
    expect(musclesWorked).toContain('<BodyMuscleMap\n        sex={sex}');
  });

  it('propagates sex through the common poster contract and both Body Map posters', () => {
    expect(workout).toContain('<WorkoutShareComposer\n        sex={sex}');
    expect(composer).toContain('<PosterComponent\n                                  sex={sex}');
    expect(posterTypes).toContain('sex: Sex;');
    expect(posterBodyMap).toContain('<BodyMuscleMap\n              sex={sex}');
    expect(posterCreative).toContain('<BodyMuscleMap\n                sex={sex}');
  });

  it('gives every production BodyMuscleMap call site an explicit sex prop', () => {
    const files = productionTsxFiles(SRC_ROOT);
    const tags = files.flatMap((file) => {
      const contents = readFileSync(file, 'utf8');
      return [...contents.matchAll(/<BodyMuscleMap\b[\s\S]*?\/>/g)].map((match) => ({ file, tag: match[0] }));
    });

    expect(tags).toHaveLength(5);
    for (const { file, tag } of tags) {
      expect(tag, file).toMatch(/\bsex=\{/);
    }
  });

  it('prevents screens/components from importing sex-specific anatomy directly', () => {
    const files = productionTsxFiles(SRC_ROOT).filter((file) => !file.endsWith('/BodyMuscleMap.tsx'));
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      expect(contents, file).not.toMatch(/\b(?:BODY_MUSCLE_MAP_MALE|BODY_MUSCLE_MAP_FEMALE|MALE_FRONT|MALE_BACK|FEMALE_FRONT|FEMALE_BACK)\b/);
    }
  });

  it('contains no silent male fallback in the Body Map propagation chain', () => {
    const chain = [bodyMap, onboarding, picker, appShell, home, workout, summary, musclesWorked, composer, posterBodyMap, posterCreative];
    for (const contents of chain) {
      expect(contents).not.toMatch(/sex\s*(?:\?\?|\|\|)\s*['"]m['"]/);
    }
  });

  it('pins female assets and notices to v1.0.1 without adding a MuscleMap dependency', () => {
    expect(anatomy).toContain("BODY_MUSCLE_MAP_ASSET_VERSION = '1.0.1'");
    expect(femaleAnatomy).toContain('@musclemap/assets v1.0.1');
    expect(femaleAnatomy).toContain('%40musclemap%2Fassets%401.0.1');
    expect(notices).toContain('`FEMALE_FRONT`');
    expect(notices).toContain('`FEMALE_BACK`');
    const dependencies = JSON.parse(packageJson).dependencies as Record<string, string>;
    expect(Object.keys(dependencies).some((name) => name.startsWith('@musclemap/'))).toBe(false);
  });
});
