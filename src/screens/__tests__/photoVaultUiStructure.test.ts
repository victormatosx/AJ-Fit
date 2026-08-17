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
  it.each(UI_FILES)('%s does not put decrypted photos in a disk cache', (file) => {
    const source = readCode(file);

    expect(source).not.toContain('memory-disk');
    expect(source).not.toContain('cachePolicy');

    if (file.endsWith('/PhotoComparePoster.tsx')) {
      // The sole expo-image is a public, bundled AVIF background. Private
      // before/after fulls remain on React Native Image and its temporary URI
      // pipeline, so this exception does not create a decrypted disk cache.
      expect(source).toContain(
        "import { Image as ExpoImage } from 'expo-image'",
      );
      expect(source).toContain(
        "require('../../../assets/background-comparacao.avif')",
      );
      expect(source.match(/<ExpoImage/g)).toHaveLength(1);
      expect(source).toContain('source={AJ_FIT_COMPARISON_BACKGROUND}');
      expect(source).toContain('source={{ uri }}');
      return;
    }

    // No other Photo Vault UI may route decrypted images through expo-image.
    expect(source).not.toContain('expo-image');
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
    // The grid is now a list of day rows; the cell that picks a representation
    // lives in the row. The invariant is unchanged: the grid never reaches for
    // a full image.
    const row = read('src/components/photoVault/PhotoVaultDayRow.tsx');
    const grid = read('src/components/photoVault/PhotoVaultGrid.tsx');
    const viewer = read('src/components/photoVault/PhotoVaultViewer.tsx');

    expect(row).toContain('photo.thumbnailUri ?? photo.previewUri');
    expect(row).not.toContain('fullUri');
    expect(grid).not.toContain('fullUri');
    expect(viewer).toContain('photo?.fullUri ?? photo?.thumbnailUri ?? photo?.previewUri');
    expect(viewer).toContain('photo?.fullLoading');
  });

  it('keeps one flat virtualized list rather than nesting or sectioning', () => {
    // Grouping by day must not cost the virtualization: month headings render
    // inline from `startsMonth`, so a SectionList or a nested list is not
    // needed and would break `removeClippedSubviews`.
    const grid = readCode('src/components/photoVault/PhotoVaultGrid.tsx');

    expect(grid).toContain('<FlatList');
    expect(grid).not.toContain('SectionList');
    expect(grid).not.toContain('ScrollView');
    expect(grid).toContain('keyExtractor={(day) => day.dateKey}');
    expect(grid).toContain('removeClippedSubviews');
  });

  it('keeps per-photo visibility callbacks inside the day row', () => {
    // Three cells in one row must not mean three eager downloads: each cell
    // still announces its own visibility to the controller.
    const row = readCode('src/components/photoVault/PhotoVaultDayRow.tsx');

    expect(row).toContain('onVisible(photo.photoId)');
    expect(row).toContain('onHidden(owner)');
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

describe('the new-photo flow', () => {
  const SHEET = readCode('src/components/photoVault/AddPhotoSheet.tsx');
  const ROW = readCode('src/components/photoVault/PhotoVaultDayRow.tsx');

  it('offers exactly the three supported poses', () => {
    expect(SHEET).toContain('POSE_SLOTS.map');
    expect(SHEET).toContain("t('progress.photos.poses.front')");
    expect(SHEET).toContain("t('progress.photos.poses.side')");
    expect(SHEET).toContain("t('progress.photos.poses.back')");
  });

  it('starts with a visible selection rather than a silent default', () => {
    // `front` is pre-selected, and the selected state is rendered, so the
    // choice is never invisible to the user.
    expect(SHEET).toContain("useState<ProgressPhotoPose>(initialPose ?? 'front')");
    expect(SHEET).toContain('selected={pose === option}');
    expect(SHEET).toContain('accessibilityState={{ selected }}');
  });

  it('keeps one independent draft per pose', () => {
    // The bug this replaced: a single `picked` state made every pose show the
    // photo chosen for whichever pose was selected first.
    expect(SHEET).toContain('useState<PoseDrafts>(EMPTY_DRAFTS)');
    expect(SHEET).toContain('const draft = drafts[pose];');
    expect(SHEET).toContain('setDrafts((current) => ({ ...current, [slot]: null }))');
  });

  it('fills only the pose that requested the picker', () => {
    // The pose is captured before awaiting: the user may switch while the
    // picker is open, and the photo belongs to the pose that asked for it.
    expect(SHEET).toContain('const target = pose;');
    expect(SHEET).toContain('setDraft(target, {');
  });

  it('shows the day of the selected pose, not one global date', () => {
    // Three library photos from three days must keep their own days; the
    // per-draft day resolution lives in the pure session module.
    expect(SHEET).toContain('draft?.takenAt ?? new Date()');
    const drafts = readCode('src/lib/photoVaultPoseDrafts.ts');
    expect(drafts).toContain('localDateKey(draft.takenAt)');
    expect(drafts).not.toContain('toISOString');
  });

  it('uploads nothing until the final action', () => {
    // Drafts stay local while the session is assembled.
    const pickHandler = SHEET.slice(SHEET.indexOf('const handlePick'), SHEET.indexOf('const handleClose'));
    expect(pickHandler).not.toContain('onSavePose');
  });

  it('supplies only a pose and an image to the caller', () => {
    const props = SHEET.slice(SHEET.indexOf('interface Props'), SHEET.indexOf('function PoseOption'));
    for (const forbidden of ['assetId', 'documentId', 'storagePath', 'thumbnailStoragePath']) {
      expect(props).not.toContain(forbidden);
    }
    expect(SHEET).toContain('onSavePose(photo, slot)');
  });

  it('blocks only the poses whose slot is already filled', () => {
    expect(SHEET).toContain('partitionSavablePoses(');
    expect(SHEET).toContain('savable: savablePoses, blocked: blockedPoses');
    expect(SHEET).toContain("t('progress.photos.add.slotTaken'");
  });

  it('never replaces a persisted photo without an explicit confirmation', () => {
    // The normal save action must not be able to reach the destructive path.
    const save = SHEET.slice(SHEET.indexOf('const handleSave'), SHEET.indexOf('const handleConfirmReplace'));
    expect(save).not.toContain('onReplacePose');
    // Replacing is a separate action, gated by a confirmation dialog.
    expect(SHEET).toContain('setConfirmingReplace(pose)');
    expect(SHEET).toContain("t('progress.photos.replace.confirmTitle')");
    expect(SHEET).toContain("style: 'destructive'");
    expect(SHEET).toContain('onPress: () => void handleConfirmReplace()');
  });

  it('uploads each pose independently, without a cross-photo rollback', () => {
    expect(SHEET).toContain('for (const slot of savablePoses)');
    // A sibling that already succeeded is never undone.
    expect(SHEET).not.toContain('Promise.all');
    expect(SHEET).not.toContain('rollback');
  });

  it('reports a partial failure without touching the poses that succeeded', () => {
    const save = SHEET.slice(SHEET.indexOf('const handleSave'), SHEET.indexOf('const state = states[pose]'));
    // A succeeded pose clears its draft; a failed one only records the error.
    expect(save).toContain("setStates((current) => ({ ...current, [slot]: { status: 'success' } }))");
    expect(save).toContain('failed.push(slot)');
    // Nothing here undoes a sibling, and the session stays open to retry.
    expect(save).not.toContain('releaseAll');
    expect(save).toContain('if (failed.length === 0 && blockedPoses.length === 0)');
  });

  it('shows per-pose state on the pose buttons themselves', () => {
    expect(SHEET).toContain('state={states[option]}');
    expect(SHEET).toContain('filled={drafts[option] !== null}');
  });

  it('releases every staged draft when the session ends', () => {
    // Covers cancel AND the vault locking underneath, which never reaches the
    // cancel handler.
    expect(SHEET).toContain('for (const uri of stagedDraftUris(draftsRef.current)) onDiscard(uri);');
    expect(SHEET).toContain('if (!visible) releaseAll();');
  });

  it('releases the photo a draft replaced', () => {
    expect(SHEET).toContain('if (released) onDiscard(released);');
  });

  it('lets an empty slot open the flow with that pose', () => {
    expect(ROW).toContain('onPress={() => onAddPose(pose)}');
    // Only the pose is carried over: the day still comes from the photo.
    expect(ROW).not.toContain('dateKey');
  });
});

describe('the pose filter', () => {
  const BAR = readCode('src/components/photoVault/PhotoVaultFilterBar.tsx');
  const GRID = readCode('src/components/photoVault/PhotoVaultGrid.tsx');
  const ROW = readCode('src/components/photoVault/PhotoVaultDayRow.tsx');
  const FILTER_EMPTY = readCode('src/components/photoVault/PhotoVaultFilterEmptyState.tsx');

  it('narrows a projection already in memory instead of querying again', () => {
    // Two derived passes over the same single metadata query.
    expect(SCREEN).toContain('groupProgressPhotosByDay(gallery.photos)');
    expect(SCREEN).toContain('filterProgressDays(days, filter)');
    expect(SCREEN).toMatch(/useMemo\(\(\) => filterProgressDays\(days, filter\), \[days, filter\]\)/);
    // No effect reacts to the filter, so changing it cannot start a fetch,
    // a download or a decrypt — only the memo above recomputes.
    const effectsOnFilter = SCREEN.match(/useEffect\([\s\S]*?\}, \[[^\]]*\bfilter\b[^\]]*\]\)/g);
    expect(effectsOnFilter).toBeNull();
    // The only writer is the bar itself.
    expect(SCREEN).toContain('onChange={setFilter}');
  });

  it('keeps the single virtualized list', () => {
    expect(GRID).toContain('<FlatList');
    expect(GRID).not.toContain('SectionList');
    expect(GRID).not.toContain('ScrollView');
    // A memoized row must re-render when the filter narrows it.
    expect(GRID).toContain('extraData={filter}');
  });

  it('renders one cell per row under a pose filter, with no placeholders', () => {
    expect(ROW).toContain("(filter === 'all' ? POSE_SLOTS : [filter]).map");
    expect(ROW).toContain("if (!photo && filter !== 'all') return null;");
  });

  it('separates the empty gallery from the empty filter', () => {
    expect(SCREEN).toContain('const galleryEmpty = gallery.photos.length === 0;');
    expect(SCREEN).toContain('const filterEmpty = !galleryEmpty && visibleDays.length === 0;');
    // Telling someone with fifty photos to add their first one would be wrong.
    expect(SCREEN).toContain('<PhotoVaultFilterEmptyState');
  });

  it('offers to add exactly the pose being filtered', () => {
    expect(SCREEN).toContain('onAdd={() => openSheet(filter)}');
    expect(FILTER_EMPTY).toContain("t('progress.photos.filterEmpty.cta', { pose: label })");
  });

  it('marks the selection for assistive technology', () => {
    expect(BAR).toContain('accessibilityRole="tablist"');
    expect(BAR).toContain('accessibilityRole="tab"');
    expect(BAR).toContain('accessibilityState={{ selected }}');
    expect(BAR).toContain("t('progress.photos.a11y.selectFilter'");
  });

  it('holds no private content in the filter itself', () => {
    // The selection is a pose name, so it may outlive a lock harmlessly — but
    // it must never be persisted anywhere.
    expect(SCREEN).not.toContain('AsyncStorage');
    expect(BAR).not.toContain('AsyncStorage');
    expect(BAR).not.toContain('photoId');
  });
});

describe('operations go through the service layer', () => {
  it('uploads, lists and deletes through the gallery controller', () => {
    expect(SCREEN).toContain('addGalleryPhoto');
    expect(SCREEN).toContain('loadGallery');
    expect(SCREEN).toContain('removeGalleryPhoto');
    expect(SCREEN).toContain('claimGalleryThumbnail');
    expect(SCREEN).toContain('releaseGalleryThumbnail');
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
      if (file.endsWith('/PhotoComparePoster.tsx')) {
        // The poster is intentionally a pure WYSIWYG renderer. Its screen
        // resolves every string through i18n and supplies one typed copy prop,
        // so export cannot drift from the localized preview.
        expect(source).toContain('copy: PhotoComparePosterCopy');
        expect(source).not.toContain('useTranslation');
        return;
      }
      expect(source, `${file} renders text without useTranslation`).toContain(
        'useTranslation',
      );
    }
  });
});
