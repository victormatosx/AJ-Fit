import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const { mockAssetCreate, mockRequestPermissionsAsync, mockSaveToLibraryAsync } = vi.hoisted(() => ({
  mockAssetCreate: vi.fn(async () => ({ id: 'fake-asset-id' })),
  mockRequestPermissionsAsync: vi.fn(),
  // Still exported so an accidental re-regression (calling the deprecated
  // function again) would be observable, not a module-resolution crash.
  mockSaveToLibraryAsync: vi.fn(async () => { throw new Error('saveToLibraryAsync is deprecated and throws at runtime'); }),
}));
vi.mock('expo-media-library', () => ({
  requestPermissionsAsync: mockRequestPermissionsAsync,
  saveToLibraryAsync: mockSaveToLibraryAsync,
  Asset: { create: mockAssetCreate },
}));

import * as MediaLibrary from 'expo-media-library';
import {
  defaultWorkoutShareArtSaveDependencies,
  saveWorkoutShareArtToLibrary,
  type WorkoutShareArtSaveDependencies,
} from '../artSave';

function dependencies(overrides: Partial<WorkoutShareArtSaveDependencies> = {}): WorkoutShareArtSaveDependencies {
  return {
    requestPermission: vi.fn(async () => ({ granted: true, canAskAgain: true })),
    saveToLibrary: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('saveWorkoutShareArtToLibrary', () => {
  it('saves to the library once permission is granted', async () => {
    const deps = dependencies();
    const result = await saveWorkoutShareArtToLibrary('file:///art.png', deps);
    expect(result).toBe('saved');
    expect(deps.saveToLibrary).toHaveBeenCalledWith('file:///art.png');
  });

  it('reports permissionDenied without attempting to save', async () => {
    const deps = dependencies({ requestPermission: vi.fn(async () => ({ granted: false, canAskAgain: true })) });
    const result = await saveWorkoutShareArtToLibrary('file:///art.png', deps);
    expect(result).toBe('permissionDenied');
    expect(deps.saveToLibrary).not.toHaveBeenCalled();
  });

  it('reports failed when saving throws after permission is granted', async () => {
    const deps = dependencies({ saveToLibrary: vi.fn(async () => { throw new Error('nope'); }) });
    const result = await saveWorkoutShareArtToLibrary('file:///art.png', deps);
    expect(result).toBe('failed');
  });
});

describe('defaultWorkoutShareArtSaveDependencies', () => {
  it('saves via the class-based Asset.create — never the deprecated saveToLibraryAsync/createAssetAsync stubs', async () => {
    mockAssetCreate.mockClear();
    mockSaveToLibraryAsync.mockClear();
    await defaultWorkoutShareArtSaveDependencies.saveToLibrary('file:///art.png');
    expect(MediaLibrary.Asset.create).toHaveBeenCalledWith('file:///art.png');
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
  });

  it('requests write-only (add-only) permission, never full library read access', async () => {
    mockRequestPermissionsAsync.mockClear();
    await defaultWorkoutShareArtSaveDependencies.requestPermission();
    expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(true);
  });
});

describe('artSave.ts source (regression guard)', () => {
  // SDK 57's default `expo-media-library` entry point re-exports
  // `saveToLibraryAsync`/`createAssetAsync` as stubs that log a deprecation
  // warning and then throw at runtime — the exact bug this file fixes. This
  // guards against silently reintroducing either call.
  const source = readFileSync(new URL('../artSave.ts', import.meta.url), 'utf8');

  it('never calls the deprecated saveToLibraryAsync/createAssetAsync stubs', () => {
    expect(source).not.toMatch(/\.saveToLibraryAsync\(/);
    expect(source).not.toMatch(/\.createAssetAsync\(/);
  });

  it('uses the class-based Asset.create API', () => {
    expect(source).toContain('MediaLibrary.Asset.create(');
  });

  it('does not import the legacy API module as a workaround', () => {
    expect(source).not.toContain('expo-media-library/legacy');
  });
});
