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

describe('the gallery opens directly, with no unlock gate', () => {
  const LOCKED_CODE = readCode('src/components/photoVault/PhotoVaultLockedState.tsx');
  const LOCAL_AUTH = readCode('src/services/localAuthentication.ts');

  it('opens the session itself instead of waiting for a user action', () => {
    expect(SCREEN).toMatch(
      /useEffect\(\(\) => \{\s*if \(!appActive \|\| status !== 'locked' \|\| openFailure\) return;\s*void unlock\(\);\s*\}, \[appActive, status, openFailure, unlock\]\)/,
    );
  });

  /**
   * The session must never open behind an app-switcher preview, and
   * `unlockPhotoVault` cancels itself if the app is not foregrounded. So
   * returning to the foreground is also what reopens a session the lifecycle
   * closed — otherwise the gallery would sit on a retry control after every
   * backgrounding.
   */
  it('reopens on returning to the foreground, never while backgrounded', () => {
    expect(SCREEN).toContain("AppState.currentState === 'active'");
    expect(SCREEN).toContain("setAppActive(next === 'active')");
    expect(SCREEN).toContain('subscription.remove()');
  });

  it('treats a lifecycle cancellation as transient, not as a failure to report', () => {
    expect(SCREEN).toMatch(
      /openFailure =\s*lastIssue !== null && lastIssue !== 'vaultAuthCancelled' \? lastIssue : null/,
    );
    // The transition only ever sees real failures, so it cannot show a retry
    // control for the app simply having been backgrounded.
    expect(SCREEN).toContain('issue={openFailure}');
    expect(SCREEN).not.toContain('issue={lastIssue}');
  });

  it('never runs an OS authentication prompt to open the gallery', () => {
    // The whole point: no Face ID, Touch ID, fingerprint, iris or device
    // passcode stands between the user and their own photos.
    expect(LOCAL_AUTH).toContain('export async function authenticateForPhotoVault');
    const gate = LOCAL_AUTH.slice(
      LOCAL_AUTH.indexOf('export async function authenticateForPhotoVault'),
    );
    expect(gate).toContain("return { status: 'success' }");
    expect(gate).not.toContain('authenticateAsync');
    expect(gate).not.toContain('getVaultAuthCapability');
  });

  it('offers no unlock control, only a retry for a real technical failure', () => {
    // A lock button would invite the user to unlock something that is not
    // locked. The retry exists because opening the session can still fail on
    // temp-file cleanup or the native app-switcher guard.
    expect(LOCKED_CODE).toContain("status === 'locked' && issue !== null");
    expect(LOCKED_CODE).toContain('{showRetry ? (');
    expect(LOCKED_CODE).toContain('testID="photo-vault-open-retry"');
    expect(LOCKED_CODE).toContain('name="refresh"');
    expect(LOCKED_CODE).not.toContain("name={iconOpen ? 'lock-open' : 'lock'}");
    expect(LOCKED_CODE).not.toContain('openSettings');
    expect(LOCKED_CODE).not.toContain('notConfigured');
  });

  it('treats the blurred skeleton as a loading transition, not a gate', () => {
    // The layer clears the moment the session opens — no success flash on a
    // control that no longer exists, and no delay waiting for one.
    expect(LOCKED_CODE).toContain('revealOpacity.value = withTiming(0');
    expect(LOCKED_CODE).toContain('runOnJS(onRevealComplete)');
    expect(LOCKED_CODE).not.toContain('successFlash');
    expect(LOCKED_CODE).not.toContain('setIconOpen');
  });

  it('clears the transition by fading the layer, never by weakening the blur', () => {
    // Animating the blur's intensity to zero would spend the whole reveal
    // making the skeleton legible and end on several frames of a sharp grid
    // of placeholder tiles (or cached, degraded previews) under the real
    // header. The blur is therefore a constant, and the opacity is what
    // moves.
    expect(LOCKED_CODE).toContain('intensity={BLUR_INTENSITY}');
    expect(LOCKED_CODE).not.toContain('blurIntensity');
    expect(LOCKED_CODE).not.toContain('useAnimatedProps');
    // And the whole layer — blur included — is what fades.
    expect(LOCKED_CODE).toContain('style={[{ flex: 1 }, revealStyle]}');
  });

  it('snaps the transition back the instant the session closes mid-reveal', () => {
    // A background lock while the layer is fading out must restore it
    // immediately: a half-faded locked layer is a half-visible gallery.
    expect(LOCKED_CODE).toMatch(
      /if \(status === 'unlocked'\) return;\s*revealOpacity\.value = 1;/,
    );
  });
});

describe('the opening transition reveals no private photo data', () => {
  const LOCKED_CODE = readCode('src/components/photoVault/PhotoVaultLockedState.tsx');

  it('returns the locked component before rendering any content', () => {
    const lockedReturn = SCREEN.indexOf('<PhotoVaultLockedState');
    expect(lockedReturn).toBeGreaterThan(-1);
    expect(lockedReturn).toBeLessThan(SCREEN.indexOf('<PhotoVaultGrid'));
    expect(lockedReturn).toBeLessThan(SCREEN.indexOf('<PhotoVaultViewer'));
  });

  it('gates the real gallery on `unlocked` alone, never on local animation state', () => {
    // `shouldShowPhotoVaultLocked` is the ONLY thing deciding this branch, and
    // it is computed fresh every render directly from `unlocked` — so a stale
    // `showLocked` left over from a previous session can only ever keep the
    // locked view up for longer, never take it down early. See
    // photoVaultLockedVisibility.test.ts for the exhaustive truth table.
    expect(SCREEN).toContain('shouldShowPhotoVaultLocked');
    expect(SCREEN).toMatch(/if \(shouldShowPhotoVaultLocked\(unlocked, showLocked\)\) \{/);
    expect(SCREEN).toContain('useState(!unlocked)');
    expect(SCREEN).toContain('onRevealComplete={() => setShowLocked(false)}');
  });

  it('loads the gallery only after the vault reports unlocked', () => {
    expect(SCREEN).toMatch(
      /useEffect\(\(\) => \{\s*if \(unlocked\) void loadGallery\(\);\s*\}, \[unlocked\]\)/,
    );
  });

  it('uses the available height so the transition fills the screen', () => {
    expect(SCREEN).toContain("contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }}");
    expect(LOCKED_CODE).toContain('flex: 1');
  });

  it('shows the same blurred skeleton whether the gallery is empty or populated', () => {
    // The locked screen must never receive anything that could distinguish
    // an empty vault from a full one.
    expect(LOCKED_CODE).not.toContain('hasContent');
    expect(LOCKED_CODE).not.toContain('contentPresenceReady');
    expect(SCREEN).not.toContain('hasContent={hasPhotoVaultContent}');
    expect(SCREEN).not.toContain('contentPresenceReady={hasPhotoVaultContentReady}');
    expect(LOCKED_CODE).not.toContain('photos.length');
    expect(LOCKED_CODE).not.toContain('<Image');
    expect(LOCKED_CODE).not.toContain('formatDate');
  });

  it('builds the locked composition from the static skeleton and a real Android blur target, only', () => {
    expect(LOCKED_CODE).toContain('<PhotoVaultGallerySkeleton');
    expect(LOCKED_CODE).toContain('BlurTargetView');
    expect(LOCKED_CODE).toContain('blurTarget=');
    expect(LOCKED_CODE).toContain('blurMethod="dimezisBlurViewSdk31Plus"');
    expect(LOCKED_CODE).not.toContain('<Image');
    expect(LOCKED_CODE).not.toContain('source=');
    expect(LOCKED_CODE).not.toContain(' uri');
    expect(LOCKED_CODE).not.toContain('photoVaultGallery');
    expect(LOCKED_CODE).not.toContain('progressPhotos');
    expect(LOCKED_CODE).not.toContain('photoVaultCrypto');
    expect(LOCKED_CODE).not.toContain('photoVaultKey');
    expect(LOCKED_CODE).not.toContain('downloadProgressPhoto');
    expect(LOCKED_CODE).not.toContain('decrypt');
  });

  it('does not overwrite a persisted true from the gallery initial empty array', () => {
    expect(SCREEN).toMatch(
      /useEffect\(\(\) => \{\s*if \(unlocked\) void loadGallery\(\);\s*\}, \[unlocked\]\)/,
    );
    const lockedBranch = SCREEN.slice(
      SCREEN.indexOf('// ── Locked'),
      SCREEN.indexOf("return (\n    <View style={{ flex: 1 }}>", SCREEN.indexOf('// ── Locked')),
    );
    expect(lockedBranch).not.toContain('setHasPhotoVaultContent(false)');
  });

  it('clears the hint only after a confirmed delete leaves no photos', () => {
    const deleteFlow = SCREEN.slice(
      SCREEN.indexOf('const ok = await removeGalleryPhoto(photoId);'),
      SCREEN.indexOf('})();', SCREEN.indexOf('const ok = await removeGalleryPhoto(photoId);')),
    );
    expect(deleteFlow).toContain('if (!ok)');
    expect(deleteFlow).toContain('return;');
    expect(deleteFlow).toContain('getGalleryState().photos.length === 0');
    expect(deleteFlow).toContain('setHasPhotoVaultContent(false)');
  });

  it('announces the protected title for assistive technology', () => {
    // No visible text is rendered any more, but the region is still labeled.
    expect(LOCKED_CODE).toContain("t('progress.photos.locked.title')");
  });

  it('flashes red and shakes on a real failure, without visible error text', () => {
    expect(LOCKED_CODE).toContain('withSequence');
    expect(LOCKED_CODE).toContain('shakeX');
    expect(LOCKED_CODE).toContain('dangerFlash');
    expect(LOCKED_CODE).toContain('AccessibilityInfo.announceForAccessibility');
    // The error message itself is announced, never rendered as visible text.
    expect(LOCKED_CODE).not.toMatch(/<Text[^>]*>\s*\{errorMessage\}/);
  });

  it('fades the blur out once the session opens, then reveals the gallery', () => {
    expect(LOCKED_CODE).toContain('onRevealComplete');
    expect(LOCKED_CODE).toContain('runOnJS(onRevealComplete)');
  });

  it('never names a specific biometric mechanism', () => {
    expect(LOCKED_CODE).not.toMatch(/Face ID|Touch ID|impress[ãa]o digital/i);
  });
});

describe('the locked gallery skeleton', () => {
  const SKELETON = readCode(
    'src/components/photoVault/PhotoVaultGallerySkeleton.tsx',
  );

  it('never reaches Firestore, the vault key, crypto or a decrypt', () => {
    expect(SKELETON).toContain('testID="photo-vault-gallery-skeleton"');
    expect(SKELETON).not.toContain('expo-image');
    expect(SKELETON).not.toContain('photoVaultGallery');
    expect(SKELETON).not.toContain('progressPhotos');
    expect(SKELETON).not.toContain('photoVaultCrypto');
    expect(SKELETON).not.toContain('photoVaultKey');
    expect(SKELETON).not.toContain('downloadProgressPhoto');
    expect(SKELETON).not.toContain('decrypt');
    expect(SKELETON).not.toContain('localAuthentication');
    expect(SKELETON).not.toContain('firebase');
    expect(SKELETON).not.toContain('FlatList');
  });

  it('paints only already-cached, already-degraded local previews — never the real gallery', () => {
    // The only source of image data: a pure local-disk read, gated on the
    // signed-in uid, never on anything the vault itself gates.
    expect(SKELETON).toContain("from '../../services/photoVaultLockedPreviewCache'");
    expect(SKELETON).toContain('listLockedPreviewUris(uid)');
    expect(SKELETON).toContain('<Image');
    // No day/pose grouping and no month/date label — those come from
    // metadata this component must never touch.
    expect(SKELETON).not.toContain('formatDate');
    expect(SKELETON).not.toContain('formatMonth');
    expect(SKELETON).not.toContain('dateKey');
    expect(SKELETON).not.toContain('pose');
  });

  it('falls back to the same generic skeleton for both "really empty" and "not cached yet"', () => {
    // Both cases must be visually indistinguishable from each other, and
    // from what existed before this feature — never a fabricated photo.
    expect(SKELETON).toContain('hasPhotoVaultContent');
    expect(SKELETON).toContain('hasPhotoVaultContentReady');
    expect(SKELETON).toContain('showPreviews');
    expect(SKELETON).toContain('<NeutralSkeleton');
  });

  it('is hidden from assistive technology, since it carries no information', () => {
    expect(SKELETON).toContain('accessibilityElementsHidden');
    expect(SKELETON).toContain('importantForAccessibility="no-hide-descendants"');
  });
});

/**
 * "Add your photos here" invites the user to start their gallery, but only
 * when the vault is REALLY empty. The determination must come from the same
 * one-bit `hasPhotoVaultContent` signal the rest of the locked flow already
 * trusts — never from the locked-preview cache being empty, which also
 * happens for a real account this device just has not backfilled yet.
 */
describe('the locked empty-gallery hint', () => {
  const LOCKED_CODE = readCode('src/components/photoVault/PhotoVaultLockedState.tsx');

  it('is gated on the content-presence signal, never on the preview cache', () => {
    expect(LOCKED_CODE).toContain('usePhotoVault()');
    expect(LOCKED_CODE).toContain('hasPhotoVaultContent');
    expect(LOCKED_CODE).toContain('hasPhotoVaultContentReady');
    expect(LOCKED_CODE).toMatch(
      /trulyEmpty = hasPhotoVaultContentReady && !hasPhotoVaultContent/,
    );
    // This component has no knowledge of local previews at all — that
    // distinction belongs entirely to PhotoVaultGallerySkeleton.
    expect(LOCKED_CODE).not.toContain('listLockedPreviewUris');
    expect(LOCKED_CODE).not.toContain('previewUris');
  });

  it('renders through i18n, in the same Display font used across the rest of the app, with no card or background', () => {
    expect(LOCKED_CODE).toContain("t('progress.photos.locked.addPhotosHint')");
    // The same `Display` component that renders "EVOLUÇÃO" and other section
    // titles — not a bespoke style, and not the mono/label font.
    expect(LOCKED_CODE).toContain("import { Display } from '../ui/Display'");
    expect(LOCKED_CODE).toMatch(/<Display[^>]*size=\{14\}/);
    expect(LOCKED_CODE).toContain('theme.colors.textMuted');
    // Discreet: no skew (the stylized slant used for large headlines), no
    // background/card/pill wrapping the text.
    expect(LOCKED_CODE).toMatch(/<Display[^>]*skew=\{false\}/);
  });

  it('respects the safe area instead of crowding the bottom navigation', () => {
    expect(LOCKED_CODE).toContain('useSafeAreaInsets');
    expect(LOCKED_CODE).toContain('insets.bottom');
  });

  it('never touches the blur, the lock button, or the rest of the layout', () => {
    // Added as its own conditional sibling, not woven into the existing
    // blur/lock JSX.
    expect(LOCKED_CODE).toContain('trulyEmpty ? (');
    expect(LOCKED_CODE).toContain('pointerEvents="none"');
  });
});

describe('the vault session is bound to the active Evolution screen', () => {
  const EVOLUTION = read('src/screens/ProgressScreen.tsx');

  it('locks the moment Evolution stops being the active screen', () => {
    // The session used to be scoped to the Fotos panel's mount, which made
    // every tab switch re-open the vault and reload the gallery. It now
    // belongs to the screen — but ONLY while that screen is active, never
    // merely mounted: this tab stays mounted behind Home/Treino.
    // `useScreenFocusEffect`'s cleanup fires on deactivation and on unmount
    // (logout) alike.
    expect(EVOLUTION).toContain("} = usePhotoVault();");
    expect(EVOLUTION).toContain('useScreenFocusEffect(() => () => lockVault());');
  });

  it('opens it only while the screen is active and the app is foregrounded', () => {
    // Never behind an app-switcher preview, and never retrying a genuine
    // failure in a loop.
    expect(EVOLUTION).toMatch(
      /if \(!isScreenActive \|\| !appActive \|\| vaultStatus !== 'locked'\) return;/,
    );
    expect(EVOLUTION).toMatch(
      /if \(vaultIssue !== null && vaultIssue !== 'vaultAuthCancelled'\) return;/,
    );
    expect(EVOLUTION).toContain('void unlockVault();');
  });

  it('leaves no second owner of the session in the Fotos panel', () => {
    // Two owners would mean the panel's unmount could close a session the
    // screen still considers open — the exact tab-switch re-lock this
    // replaced.
    expect(SCREEN).toContain('} = usePhotoVault();');
    expect(SCREEN).toContain('status,');
    expect(SCREEN).not.toMatch(/useEffect\(\(\) => \(\) => lock\(\), \[lock\]\)/);
    expect(SCREEN).not.toMatch(/^\s*lock,$/m);
  });
});

describe('viewer and sheet close with the vault', () => {

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

    // The representation choice is shared by the pager and the header, so it
    // lives in one helper instead of being repeated per page.
    expect(viewer).toContain('photo.fullUri ?? photo.thumbnailUri ?? photo.previewUri');
    expect(viewer).toMatch(/photo !== null && displayUriOf\(photo\) !== null/);
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
    expect(viewer).toContain('photo.fullUri ?? photo.thumbnailUri ?? photo.previewUri');
    expect(viewer).toContain('photo?.fullLoading');
  });

  /**
   * Paging must not widen what is decrypted beyond the viewer's own window.
   * The screen releases the previous claim before taking the next one, and the
   * claim carries the window with it — otherwise swiping fast would leave
   * decrypts racing for ownership and their plaintext behind.
   */
  it('moves the vault claim one photo at a time while paging', () => {
    const viewer = read('src/components/photoVault/PhotoVaultViewer.tsx');

    expect(SCREEN).toContain('handleNavigateViewer');
    expect(SCREEN).toMatch(
      /releaseGalleryPhotoFromViewer\(current\);\s*\n\s*claimGalleryPhotoForViewer\(nextPhotoId, neighboursOf\(nextPhotoId\)\);/,
    );
    // Neighbouring pages must never request a full-resolution decrypt of their
    // own: the window is granted by the screen, never taken by a page.
    expect(viewer).not.toContain('claimGalleryPhotoForViewer');
    expect(viewer).not.toContain('ensureFullPhotoLoaded');
  });

  /**
   * Prefetch is bounded to what a single swipe can reach.
   *
   * The window is computed from the SAME filtered sequence the grid paints, so
   * a pose filter narrows it too. Anything wider would turn opening one photo
   * into decrypting a gallery.
   */
  it('prefetches the immediate neighbours and nothing further', () => {
    expect(SCREEN).toContain('neighboursOf');
    expect(SCREEN).toContain('viewerPhotos[index - 1]');
    expect(SCREEN).toContain('viewerPhotos[index + 1]');
    // No second- or third-degree neighbour may ever be claimed.
    expect(SCREEN).not.toMatch(/viewerPhotos\[index [-+] [2-9]\]/);
    expect(SCREEN).toMatch(
      /claimGalleryPhotoForViewer\(photoId, neighboursOf\(photoId\)\)/,
    );
  });

  /**
   * Regression: a closing list emits one final momentum event while it tears
   * down. Acting on it reported a page to the parent, which set a photo id
   * again and reopened the viewer the user had just dismissed — closing it
   * became impossible. The guard has to be a ref, read when the native event
   * fires, so a callback created before the close cannot act on a stale value.
   */
  it('ignores the teardown paging event so closing the viewer sticks', () => {
    const viewer = readCode('src/components/photoVault/PhotoVaultViewer.tsx');

    expect(viewer).toContain('acceptsPagingRef');
    // Cleared on the tap itself, ahead of any teardown event.
    expect(viewer).toMatch(
      /acceptsPagingRef\.current = false;\s*\n\s*onClose\(\);/,
    );
    // Both dismissal paths go through it, including the Android back button.
    expect(viewer).toContain('onRequestClose={closeViewer}');
    expect(viewer).toContain('onPress={closeViewer}');
    // And a parent-driven close (lock, delete) never taps anything.
    expect(viewer).toContain('photoId === null');
  });

  /**
   * A page must be the pager's own box, never the window: the list sits below
   * the header and inside the safe area, so a window-sized page centres the
   * photo in a taller box than the visible one — pushing anything that is not
   * the screen's aspect ratio below centre and clipping its bottom.
   */
  it('sizes each page from the measured viewport, not the window', () => {
    const viewer = readCode('src/components/photoVault/PhotoVaultViewer.tsx');

    expect(viewer).toContain('onLayout={measurePage}');
    // Offsets come from the measured width, so mounting before it is known
    // would resolve every `initialScrollIndex` to the first page.
    expect(viewer).toContain('length: page.width');
    expect(viewer).toMatch(/\{page \? \(/);

    // Every page DIMENSION is read from the measured box. The window is taller
    // than the pager (which sits below the header, inside the safe area), so
    // sizing a page to it centres each photo in a box bigger than the visible
    // one — pushing anything that does not fill the screen below the true
    // centre and clipping its bottom edge.
    expect(viewer).toContain('width={page?.width ?? 0}');
    expect(viewer).toContain('height={page?.height ?? 0}');
    // Every geometry value the pager computes is read off `page`.
    expect(viewer).toContain('offset: page.width * i');
  });

  it('uses the window only to animate the dismiss, never to lay a page out', () => {
    const viewer = readCode('src/components/photoVault/PhotoVaultViewer.tsx');

    // The swipe-down has to travel the whole screen, not just the pager box,
    // so it legitimately needs the window height — but that is an ANIMATION
    // target, and it must not leak back into geometry.
    expect(viewer).toContain('const { height: windowHeight } = useWindowDimensions()');
    const uses = viewer.match(/windowHeight/g) ?? [];
    // Exactly two: the declaration, and the dismiss animation's target.
    expect(uses).toHaveLength(2);
    expect(viewer).toContain('dragY.value = withTiming(windowHeight');
  });

  it('centres a photo that does not fill the screen, on both axes', () => {
    const viewer = readCode('src/components/photoVault/PhotoVaultViewer.tsx');

    expect(viewer).toContain("alignItems: 'center'");
    expect(viewer).toContain("justifyContent: 'center'");
    // `contain` letterboxes rather than cropping; `cover` would fill the page
    // by cutting the photo, which is not what a progress photo may do.
    expect(viewer).toContain('resizeMode="contain"');
    expect(viewer).not.toContain('resizeMode="cover"');
  });

  /**
   * These are decrypted vault photos: a caching image component would persist
   * plaintext to disk outside the vault's lifecycle.
   */
  it('keeps the viewer on the uncached Image element', () => {
    const viewer = read('src/components/photoVault/PhotoVaultViewer.tsx');

    expect(viewer).not.toContain('expo-image');
    expect(viewer).toMatch(/from 'react-native'/);
  });

  /** The swipe sequence is the filtered one the grid paints, not everything. */
  it('pages through the same photos the grid is showing', () => {
    expect(SCREEN).toContain('flattenProgressDayPhotos(visibleDays)');
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

  it('closes back to the gallery when its backdrop is pressed', () => {
    const backdrop = SHEET.slice(
      SHEET.indexOf('testID="photo-vault-add-backdrop"'),
      SHEET.indexOf('/>', SHEET.indexOf('testID="photo-vault-add-backdrop"')),
    );

    expect(backdrop).toContain('onPress={handleClose}');
    expect(SCREEN).toContain('onClose={() => setSheetOpen(false)}');
  });

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
    // Clearing is per slot and copies the map, so releasing one pose's draft
    // can never drop another's — the invariant that matters now that three
    // poses settle concurrently and in any order.
    expect(SHEET).toContain('const next = { ...current };');
    expect(SHEET).toContain('for (const slot of clearedSlots) next[slot] = null;');
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

  it('commits the poses concurrently, without a cross-photo rollback', () => {
    const save = SHEET.slice(SHEET.indexOf('const handleSave'), SHEET.indexOf('const handleConfirmReplace'));
    // The three poses share no identifier — separate asset UUIDs, separate
    // Storage paths, separate `{dateKey}_{pose}` documents — so they commit
    // together rather than one after another.
    expect(save).toContain('Promise.allSettled(');
    expect(save).not.toContain('for (const slot of savablePoses)');
    // `Promise.all` would stop this function from reading what the other two
    // poses actually did the moment one rejected.
    expect(save).not.toMatch(/await Promise\.all\(/);
    // A sibling that already succeeded is never undone.
    expect(SHEET).not.toContain('rollback');
  });

  it('reports a partial failure without touching the poses that succeeded', () => {
    const save = SHEET.slice(SHEET.indexOf('const handleSave'), SHEET.indexOf('const handleConfirmReplace'));
    // A succeeded pose clears its draft; a failed one only records the error.
    expect(save).toContain("next[slot] = { status: 'success' };");
    expect(save).toContain("next[slot] = { status: 'error', issue };");
    // Nothing here undoes a sibling, and the session stays open to retry.
    expect(save).not.toContain('releaseAll');
    expect(save).toContain('if (failed.length === 0 && blockedPoses.length === 0)');
  });

  it('distinguishes total success, partial success and total failure', () => {
    const save = SHEET.slice(SHEET.indexOf('const handleSave'), SHEET.indexOf('const handleConfirmReplace'));
    // A batch that half-landed must never be reported as either extreme.
    expect(save).toContain("'allSucceeded'");
    expect(save).toContain("'allFailed'");
    expect(save).toContain("'partial'");
  });

  it('reopens on a pose chosen by fixed order, never by which finished first', () => {
    const save = SHEET.slice(SHEET.indexOf('const handleSave'), SHEET.indexOf('const handleConfirmReplace'));
    // `committed` is built from `savablePoses`, which `partitionSavablePoses`
    // emits in POSE_SLOTS order. Rebuilding `failed` from it — rather than
    // pushing as results arrive — keeps the reopened pose deterministic.
    expect(save).toContain('failed = committed');
    expect(save).toContain('setPose(failed[0]!)');
    expect(save).not.toContain('failed.push(');
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

// ── Pinned gallery actions ─────────────────────────────────────────────────

/**
 * "Add" used to sit at the very bottom of the list footer and "compare" up in
 * the header, so reaching either meant scrolling to opposite ends of the
 * gallery. Both are now pinned above the grid, add first.
 */
describe('the pinned action bar', () => {
  it('lives outside the list, so it never scrolls away', () => {
    const bar = SCREEN.slice(SCREEN.indexOf('photo-vault-action-bar'));

    // Neither action may be handed back to the list, in either slot.
    const list = SCREEN.slice(SCREEN.indexOf('<PhotoVaultGrid'), SCREEN.indexOf('photo-vault-action-bar'));
    expect(list).not.toContain('photo-vault-compare-cta');
    expect(list).not.toContain("capability=\"ADD_PROGRESS_PHOTO\"");
    expect(bar).toContain('photo-vault-compare-cta');
    expect(bar).toContain('capability="ADD_PROGRESS_PHOTO"');
  });

  it('puts add above compare', () => {
    const bar = SCREEN.slice(SCREEN.indexOf('photo-vault-action-bar'));

    expect(bar.indexOf('ADD_PROGRESS_PHOTO')).toBeLessThan(
      bar.indexOf('photo-vault-compare-cta'),
    );
  });

  it('is a flex sibling of the grid rather than an overlay', () => {
    // An absolutely positioned bar would let the last row of photos scroll
    // underneath it and stay unreachable.
    expect(SCREEN).not.toMatch(/testID="photo-vault-action-bar"[\s\S]{0,200}position: 'absolute'/);
  });

  it('stays hidden wherever an empty state already offers to add', () => {
    // Otherwise the same call to action appears twice on one screen.
    expect(SCREEN).toContain(
      "const showActionBar = gallery.status === 'ready' && !galleryEmpty && !filterEmpty",
    );
    expect(SCREEN).toContain('{showActionBar ? (');
  });

  it('offers compare only once a valid pair exists', () => {
    const bar = SCREEN.slice(SCREEN.indexOf('photo-vault-action-bar'));
    expect(bar).toContain('{canCompare ? (');
  });
});

// ── Viewer carousel ────────────────────────────────────────────────────────

describe('the full-screen carousel', () => {
  const viewer = readCode('src/components/photoVault/PhotoVaultViewer.tsx');

  it('pages horizontally, one photo at a time', () => {
    expect(viewer).toContain('horizontal');
    expect(viewer).toContain('pagingEnabled');
  });

  it('drives the dots from the live scroll offset, not the settled index', () => {
    // The settled index also transfers which photo may be decrypted, so it
    // only moves when a swipe comes to rest. Dots have no such constraint and
    // must follow the finger, or they lag a whole page behind the photo.
    expect(viewer).toContain('useAnimatedScrollHandler');
    expect(viewer).toContain('scrollX.value = event.contentOffset.x');
    expect(viewer).toContain('const position = pageWidth > 0 ? scrollX.value / pageWidth : 0');
    expect(viewer).toContain('scrollEventThrottle={16}');
  });

  it('seeds the dots from the photo it opened on', () => {
    // `initialScrollIndex` sets the offset natively and emits no scroll event,
    // so without this the dots would start on the first photo every time.
    expect(viewer).toContain('scrollX.value = initialIndexRef.current * page.width');
  });

  it('still hands vault ownership over only when the swipe settles', () => {
    expect(viewer).toContain('onMomentumScrollEnd={handleMomentumEnd}');
    const momentum = viewer.slice(viewer.indexOf('const handleMomentumEnd'));
    expect(momentum).toContain('onNavigate(target.photoId)');
  });

  it('falls back to a counter when there are too many photos to dot', () => {
    expect(viewer).toContain('const MAX_DOTS = 12');
    expect(viewer).toContain('photos.length > 1 && photos.length <= MAX_DOTS');
    // Exactly one of the two is shown, never both.
    expect(viewer).toContain('photos.length > 1 && !showDots ?');
  });
});

describe('swipe down to dismiss', () => {
  const viewer = readCode('src/components/photoVault/PhotoVaultViewer.tsx');

  it('tracks the finger instead of firing on a threshold', () => {
    expect(viewer).toContain('dragY.value = Math.max(0, event.translationY)');
    expect(viewer).toContain('translateY: dragY.value');
  });

  it('yields to the pager the moment the drag turns sideways', () => {
    // Without this the horizontal carousel would stop working, because the
    // dismiss would swallow every drag that started on the photo.
    expect(viewer).toContain('.failOffsetX([-DISMISS_FAIL_X, DISMISS_FAIL_X])');
    expect(viewer).toContain('.activeOffsetY(DISMISS_ACTIVATION)');
  });

  it('never competes with panning a zoomed-in photo', () => {
    expect(viewer).toContain('.enabled(!zoomed)');
  });

  it('closes on distance or on a flick, and springs back otherwise', () => {
    expect(viewer).toContain('dragY.value > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY');
    expect(viewer).toContain('dragY.value = withSpring(0');
  });

  it('only reports the close once the photo is actually gone', () => {
    // Calling back mid-animation would tear the Modal down under the gesture.
    expect(viewer).toContain('if (finished) runOnJS(closeViewer)()');
  });

  it('keeps the measured pager box outside the dismiss transform', () => {
    // The bug this pins: `onLayout={measurePage}` used to sit inside the
    // transformed wrapper. Layout events fired while the transform ran, `page`
    // was re-set mid-drag, and `getItemLayout`/`initialScrollIndex` changed
    // underneath a pager that was still settling — the photo rendered askew
    // and then jumped. Only the photo layer may move.
    const measured = viewer.indexOf('onLayout={measurePage}');
    const transformed = viewer.indexOf('photoStyle]}');
    expect(measured).toBeGreaterThan(-1);
    expect(transformed).toBeGreaterThan(-1);
    // The transform is applied INSIDE the measured box, not around it.
    expect(transformed).toBeGreaterThan(measured);
    expect(viewer).toContain('<Animated.View style={[StyleSheet.absoluteFill, photoStyle]}>');
  });

  it('never scales the native paging scroll view', () => {
    // Scaling the pager while it is settling a swipe is what rendered the
    // photo askew; translation alone is enough to carry it off screen.
    const photoStyle = viewer.slice(
      viewer.indexOf('const photoStyle = useAnimatedStyle'),
      viewer.indexOf('const backdropStyle'),
    );
    expect(photoStyle).toContain('translateY: dragY.value');
    expect(photoStyle).not.toContain('scale');
  });

  it('never drives opacity negative', () => {
    // `1 - progress * 1.6` bottoms out at -0.6, and a negative opacity is not
    // a dimmer view — it is an invalid value that renders as corruption.
    for (const style of ['backdropStyle', 'chromeStyle']) {
      const body = viewer.slice(viewer.indexOf(`const ${style} = useAnimatedStyle`));
      expect(body.slice(0, 200), `${style} must clamp`).toContain('clamp(');
    }
  });

  it('declares every UI-thread helper as a worklet', () => {
    // `useAnimatedStyle` bodies run on the UI thread and can only call
    // worklets. A plain helper declared in the component body reads
    // identically at the call site but throws "Tried to synchronously call a
    // non-worklet function on the UI thread" on every frame, from the moment
    // the screen mounts — not on first use, so it is easy to ship.
    for (const helper of ['clamp', 'dismissProgress']) {
      expect(viewer, `${helper} must be a worklet`).toMatch(
        new RegExp(`function ${helper}\\([^)]*\\)[^{]*\\{\\s*'worklet';`),
      );
    }
    // Module scope, never redeclared inside the component where it would
    // silently stop being workletized.
    expect(viewer).not.toMatch(/const (clamp|dismissProgress) = /);
  });

  it('does not layer a native fade over the Reanimated dismiss', () => {
    const modal = viewer.slice(viewer.indexOf('<Modal'), viewer.indexOf('</Modal>'));
    expect(modal).toContain('animationType="none"');
    expect(modal).not.toContain('animationType="fade"');
  });

  it('keeps the terminal drag position through teardown, then resets for the next opening', () => {
    const dismissHandler = viewer.slice(
      viewer.indexOf('const handleModalDismissed'),
      viewer.indexOf('useEffect(() => {', viewer.indexOf('const handleModalDismissed')),
    );
    const hiddenEffect = viewer.slice(
      viewer.indexOf('// React state can be cleared as soon as closing starts.'),
      viewer.indexOf('// `initialScrollIndex`'),
    );

    expect(hiddenEffect).not.toContain('dragY.value = 0');
    expect(dismissHandler).toContain('dragY.value = 0');
    expect(viewer).toContain('onDismiss={handleModalDismissed}');
  });

  it('needs a transparent Modal for the backdrop it animates', () => {
    // An opaque Modal has nothing to uncover as the photo is dragged away.
    expect(viewer).toContain('transparent');
    expect(viewer).not.toContain('transparent={false}');
    expect(viewer).toContain('backgroundColor: \'#000\' }, backdropStyle]');
  });
});

/**
 * Screenshots and screen recording of the user's own private photos are
 * intentionally allowed. Only the iOS app-switcher preview blur remains
 * (`photoVaultScreenProtection.ts`), orchestrated centrally by the lock state
 * machine — no UI component may reach for capture blocking on its own.
 */
describe('screenshots and screen recording stay allowed in the UI', () => {
  it.each(UI_FILES)('%s never calls screen-capture prevention directly', (file) => {
    const source = readCode(file);
    expect(source).not.toContain('preventScreenCaptureAsync');
    expect(source).not.toContain('allowScreenCaptureAsync');
    expect(source).not.toContain('photoVaultScreenProtection');
  });

  it('opening, navigating and closing the viewer never touch screen protection', () => {
    const viewer = read('src/components/photoVault/PhotoVaultViewer.tsx');
    expect(viewer).not.toContain('ScreenProtection');
    expect(viewer).not.toContain('ScreenCapture');
  });
});
