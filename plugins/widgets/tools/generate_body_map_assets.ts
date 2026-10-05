#!/usr/bin/env npx tsx
/**
 * Generates the widget BodyMap layers from the exact vendored anatomy used
 * by React Native's BodyMuscleMap. The checked-in PNGs are intentionally
 * presentation-only: exercise→muscle projection remains in TypeScript.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BODY_MUSCLE_MAP_FEMALE,
} from '../../../src/data/bodyMuscleMapFemaleAnatomy';
import {
  BODY_MUSCLE_MAP_MALE,
  type MuscleMapDiagram,
} from '../../../src/data/bodyMuscleMapAnatomy';
import { muscleForPartId } from '../../../src/lib/muscleMapRegions';
import type { MuscleId } from '../../../src/types/exercise';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const TEMPLATE_CATALOG = path.join(
  PROJECT_ROOT,
  'plugins/widgets/ios/AJFitWidgetsExtension/AJFitWidgetsAssets.xcassets',
);
const GENERATED_CATALOG = path.join(
  PROJECT_ROOT,
  'ios/AJFitWidgetsExtension/AJFitWidgetsAssets.xcassets',
);
const ANDROID_DRAWABLES = path.join(
  PROJECT_ROOT,
  'modules/ajfit-widgets/android/src/main/res/drawable-nodpi',
);
const MUSCLES: readonly MuscleId[] = [
  'chest', 'lats', 'upper_back', 'traps', 'lower_back',
  'front_deltoid', 'side_deltoid', 'rear_deltoid',
  'biceps', 'triceps', 'forearms', 'quads', 'hamstrings',
  'glutes', 'adductors', 'abductors', 'calves', 'abs',
];

const SVG_WIDTH = 2112;
const SVG_HEIGHT = 1536;
const PNG_WIDTH = 264;
const PNG_HEIGHT = 192;
const BACK_X = 1088;

function pathElements(
  diagram: MuscleMapDiagram,
  kind: 'base' | 'muscle',
  muscle?: MuscleId,
): string {
  if (kind === 'base') {
    const outlines = diagram.outline.map((part) =>
      `<path d="${part.d}" fill="#FFFFFF" fill-opacity="0.14" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="2"/>`,
    );
    const muscles = diagram.muscles.map((part) =>
      `<path d="${part.d}" fill="#FFFFFF" fill-opacity="0.14" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="1"/>`,
    );
    return [...outlines, ...muscles].join('');
  }
  return diagram.muscles
    .filter((part) => muscleForPartId(part.id) === muscle)
    .map((part) => `<path d="${part.d}" fill="#FFFFFF"/>`)
    .join('');
}

function svg(
  anatomy: { front: MuscleMapDiagram; back: MuscleMapDiagram },
  kind: 'base' | 'muscle',
  muscle?: MuscleId,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PNG_WIDTH}" height="${PNG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">`
    + `<g>${pathElements(anatomy.front, kind, muscle)}</g>`
    + `<g transform="translate(${BACK_X} 0)">${pathElements(anatomy.back, kind, muscle)}</g>`
    + '</svg>';
}

function imageSetContents(filename: string): string {
  return `${JSON.stringify({
    images: [{ filename, idiom: 'universal', scale: '1x' }],
    info: { author: 'xcode', version: 1 },
  }, null, 2)}\n`;
}

function removeGeneratedAssets(): void {
  for (const catalog of [TEMPLATE_CATALOG, GENERATED_CATALOG]) {
    if (!fs.existsSync(catalog)) continue;
    for (const entry of fs.readdirSync(catalog)) {
      if (entry.startsWith('AJFitBodyMap_') && entry.endsWith('.imageset')) {
        fs.rmSync(path.join(catalog, entry), { recursive: true, force: true });
      }
    }
  }
  if (fs.existsSync(ANDROID_DRAWABLES)) {
    for (const entry of fs.readdirSync(ANDROID_DRAWABLES)) {
      if (entry.startsWith('ajfit_widget_bodymap_') && entry.endsWith('.png')) {
        fs.rmSync(path.join(ANDROID_DRAWABLES, entry), { force: true });
      }
    }
  }
}

function writeAsset(
  tempDirectory: string,
  sex: 'm' | 'f',
  anatomy: { front: MuscleMapDiagram; back: MuscleMapDiagram },
  muscle?: MuscleId,
): void {
  const suffix = muscle ?? 'base';
  const nativeName = `AJFitBodyMap_${sex}_${suffix}`;
  const androidName = `ajfit_widget_bodymap_${sex}_${suffix}`;
  const source = path.join(tempDirectory, `${androidName}.svg`);
  const png = path.join(tempDirectory, `${androidName}.png`);
  fs.writeFileSync(source, svg(anatomy, muscle ? 'muscle' : 'base', muscle));
  execFileSync('/usr/bin/sips', ['-s', 'format', 'png', source, '--out', png], { stdio: 'pipe' });

  for (const catalog of [TEMPLATE_CATALOG, GENERATED_CATALOG]) {
    const imageSet = path.join(catalog, `${nativeName}.imageset`);
    fs.mkdirSync(imageSet, { recursive: true });
    fs.copyFileSync(png, path.join(imageSet, `${nativeName}.png`));
    fs.writeFileSync(path.join(imageSet, 'Contents.json'), imageSetContents(`${nativeName}.png`));
  }
  fs.mkdirSync(ANDROID_DRAWABLES, { recursive: true });
  fs.copyFileSync(png, path.join(ANDROID_DRAWABLES, `${androidName}.png`));
}

removeGeneratedAssets();
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ajfit-bodymap-'));
try {
  for (const [sex, anatomy] of [
    ['m', BODY_MUSCLE_MAP_MALE],
    ['f', BODY_MUSCLE_MAP_FEMALE],
  ] as const) {
    writeAsset(tempDirectory, sex, anatomy);
    for (const muscle of MUSCLES) writeAsset(tempDirectory, sex, anatomy, muscle);
  }
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}

console.log(`Generated ${2 * (MUSCLES.length + 1)} AJ Fit BodyMap layer images.`);
