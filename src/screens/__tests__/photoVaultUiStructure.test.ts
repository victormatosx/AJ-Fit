import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Structural guarantees for the Photo Vault UI.
 *
 * The project has no component renderer, so these assert the properties that
 * would silently weaken the feature if broken: a screen reaching Firebase
 * directly, a decrypted photo landing in a durable cache, or content being
 * rendered before the vault is open.
 */

const UI_FILES = [
  'src/screens/ProgressPhotosScreen.tsx',
  ...readdirSync('src/components/photoVault').map((f) => `src/components/photoVault/${f}`),
];

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * Source with comments stripped. These assertions are about what the code
 * does — a comment explaining that a file avoids `expo-image` must not be
 * mistaken for the file using it.
 */
function readCode(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const SCREEN = read('src/screens/ProgressPhotosScreen.tsx');

describe('the UI never talks to Firebase', () => {
  it.each(UI_FILES)('%s imports no Firebase module', (file) => {
    const source = read(file);

    expect(source).not.toContain('firebase/firestore');
    expect(source).not.toContain('firebase/storage');
    expect(source).not.toContain('firebase/functions');
    expect(source).not.toContain('httpsCallable');
    expect(source).not.toContain('getDownloadURL');
  });

  it.each(UI_FILES)('%s never reaches the vault key or crypto', (file) => {
    const source = read(file);

    expect(source).not.toContain('photoVaultKeyStorage');
    expect(source).not.toContain('photoVaultCrypto');
    expect(source).not.toContain('vaultKey');
    expect(source).not.toContain('localAuthentication');
  });
});

describe('no durable cache of decrypted photos', () => {
  it.each(UI_FILES)('%s does not use expo-image or a disk cache', (file) => {
    const source = readCode(file);

    // expo-image's disk cache would copy decrypted photos outside the
    // vault's control, which is exactly what the design avoids.
    expect(source).not.toContain('expo-image');
    expect(source).not.toContain('memory-disk');
    expect(source).not.toContain('cachePolicy');
  });

  it.each(UI_FILES)('%s never persists a decrypted uri', (file) => {
    const source = read(file);

    expect(source).not.toContain('AsyncStorage');
    expect(source).not.toContain('SecureStore');
  });
});

describe('locked state reveals nothing', () => {
  it('returns the locked component before rendering any content', () => {
    // The early return must come before the grid, the viewer and the sheet.
    const lockedReturn = SCREEN.indexOf('<PhotoVaultLockedState');
    expect(lockedReturn).toBeGreaterThan(-1);
    expect(lockedReturn).toBeLessThan(SCREEN.indexOf('<PhotoVaultGrid'));
    expect(lockedReturn).toBeLessThan(SCREEN.indexOf('<PhotoVaultViewer'));
  });

  it('guards the whole content branch on the unlocked status', () => {
    expect(SCREEN).toMatch(/if \(!unlocked\) \{/);
  });

  it('shows no photo count, date or preview while locked', () => {
    const locked = read('src/components/photoVault/PhotoVaultLockedState.tsx');

    expect(locked).not.toContain('photos.length');
    expect(locked).not.toContain('<Image');
    expect(locked).not.toContain('formatDate');
  });

  it('never names a specific biometric mechanism', () => {
    // The same build runs on devices that prompt for a fingerprint or PIN,
    // so the visible copy must stay mechanism-neutral.
    const locked = readCode('src/components/photoVault/PhotoVaultLockedState.tsx');

    expect(locked).not.toMatch(/Face ID|Touch ID|impress[ãa]o digital/i);
  });
});

describe('viewer and sheet close with the vault', () => {
  it('locks the vault when the private screen unmounts', () => {
    expect(SCREEN).toContain('const { status, lastIssue, unlock, lock } = usePhotoVault()');
    expect(SCREEN).toMatch(/useEffect\(\(\) => \(\) => lock\(\), \[lock\]\)/);
  });

  it('clears the viewer and sheet when the vault is not unlocked', () => {
    expect(SCREEN).toMatch(
      /if \(!unlocked\) \{[\s\S]*?releaseGalleryPhotoFromViewer\(viewerId\);[\s\S]*?setViewerId\(null\);[\s\S]*?setSheetOpen\(false\);/,
    );
  });

  it('closes the viewer when its file disappears', () => {
    // All progressive representations are revoked together on lock/delete.
    expect(SCREEN).toContain('!viewerPhoto.fullUri');
    expect(SCREEN).toContain('!viewerPhoto.thumbnailUri');
    expect(SCREEN).toContain('!viewerPhoto.previewUri');
    expect(SCREEN).toMatch(/setViewerId\(null\);/);
  });

  it('renders the viewer only for a photo with a live uri', () => {
    const viewer = read('src/components/photoVault/PhotoVaultViewer.tsx');

    expect(viewer).toContain('photo?.fullUri ?? photo?.thumbnailUri ?? photo?.previewUri');
    expect(viewer).toMatch(/photo !== null && displayUri !== null/);
  });

  it('uses thumbnail-first progressive rendering instead of waiting for full', () => {
    const grid = read('src/components/photoVault/PhotoVaultGrid.tsx');
    const viewer = read('src/components/photoVault/PhotoVaultViewer.tsx');

    expect(grid).toContain('photo.thumbnailUri ?? photo.previewUri');
    expect(viewer).toContain('photo?.fullUri ?? photo?.thumbnailUri ?? photo?.previewUri');
    expect(viewer).toContain('photo?.fullLoading');
  });

  it('keeps viewer actions below the safe-area boundary', () => {
    const viewer = read('src/components/photoVault/PhotoVaultViewer.tsx');

    expect(viewer).toContain('<SafeAreaProvider');
    expect(viewer).toContain('<SafeAreaView');
    expect(viewer.indexOf('<SafeAreaProvider')).toBeLessThan(viewer.indexOf('<SafeAreaView'));
    expect(viewer).toContain("edges={['top', 'right', 'bottom', 'left']}");
    expect(viewer).toContain('paddingTop: 12');
    expect(viewer).toContain('paddingBottom: 12');
    expect(viewer).not.toContain('paddingVertical: 12');
  });
});

describe('operations go through the service layer', () => {
  it('uploads, lists and deletes through the gallery controller', () => {
    expect(SCREEN).toContain('addGalleryPhoto');
    expect(SCREEN).toContain('loadGallery');
    expect(SCREEN).toContain('removeGalleryPhoto');
    expect(SCREEN).toContain('mountGalleryPhoto');
    expect(SCREEN).toContain('unmountGalleryPhoto');
  });

  it('uses one virtualized FlatList rather than mapping every photo', () => {
    const grid = readCode('src/components/photoVault/PhotoVaultGrid.tsx');

    expect(grid).toContain('<FlatList');
    expect(grid).not.toMatch(/photos\.map\(/);
    expect(grid).toContain('initialNumToRender');
    expect(grid).toContain('windowSize');
  });

  it('unlocks through the vault context, never the auth service', () => {
    expect(SCREEN).toContain('usePhotoVault()');
    expect(SCREEN).not.toContain('authenticateForPhotoVault');
  });

  it('picks photos through the picker service', () => {
    expect(SCREEN).toContain('pickPhotoFromLibrary');
    expect(SCREEN).toContain('takePhotoWithCamera');
    expect(SCREEN).not.toContain('expo-image-picker');
  });
});

describe('no technical detail leaks to the user', () => {
  it.each(UI_FILES)('%s shows no encryption internals', (file) => {
    const source = readCode(file);

    // `iv` is matched as a whole identifier: a bare substring would hit
    // "private", "active" and half the file.
    for (const term of ['AES-256', 'KMS', 'encryptionVersion', 'vaultKeyVersion']) {
      expect(source, `${file} must not mention ${term}`).not.toContain(term);
    }
    expect(source, `${file} must not expose the iv`).not.toMatch(/\biv\b/);
  });
});

describe('internationalisation', () => {
  it.each(UI_FILES)('%s routes visible copy through i18n', (file) => {
    const source = readCode(file);

    // Files that render text must translate it. Project-wide detection of
    // hardcoded strings is the job of `npm run i18n:audit`, which already
    // covers these files; this only catches a component that renders copy
    // without wiring translation at all.
    if (source.includes('<Text')) {
      expect(source, `${file} renders text without useTranslation`).toContain(
        'useTranslation',
      );
    }
  });
});
