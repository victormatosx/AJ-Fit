import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-clipboard', () => ({ setImageAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({ File: class {} }));

import {
  copyWorkoutShareArtToClipboard,
  defaultWorkoutShareArtClipboardDependencies,
  type WorkoutShareArtClipboardDependencies,
} from '../artClipboard';

function dependencies(overrides: Partial<WorkoutShareArtClipboardDependencies> = {}): WorkoutShareArtClipboardDependencies {
  return {
    readBase64: vi.fn(async () => 'iVBORw0KGgo='),
    setImage: vi.fn(async () => undefined),
    isSupported: vi.fn(() => true),
    ...overrides,
  };
}

describe('copyWorkoutShareArtToClipboard', () => {
  it('reads the PNG as base64 and sets it on the system clipboard', async () => {
    const deps = dependencies();
    const result = await copyWorkoutShareArtToClipboard('file:///art.png', deps);
    expect(result).toBe('copied');
    expect(deps.readBase64).toHaveBeenCalledWith('file:///art.png');
    expect(deps.setImage).toHaveBeenCalledWith('iVBORw0KGgo=');
  });

  it('reports unsupported without touching the clipboard when the platform is not covered', async () => {
    const deps = dependencies({ isSupported: vi.fn(() => false) });
    const result = await copyWorkoutShareArtToClipboard('file:///art.png', deps);
    expect(result).toBe('unsupported');
    expect(deps.readBase64).not.toHaveBeenCalled();
    expect(deps.setImage).not.toHaveBeenCalled();
  });

  it('reports failed when reading or setting the image throws', async () => {
    const deps = dependencies({ setImage: vi.fn(async () => { throw new Error('nope'); }) });
    const result = await copyWorkoutShareArtToClipboard('file:///art.png', deps);
    expect(result).toBe('failed');
  });

  it('exposes real iOS/Android clipboard dependencies by default (never a URI/path stand-in)', () => {
    expect(defaultWorkoutShareArtClipboardDependencies.isSupported()).toBe(true);
  });
});
