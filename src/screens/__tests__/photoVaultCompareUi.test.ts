import { readFileSync, statSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Structural guarantees for comparator selection, branded preview and export
 * (phases 15D–15G).
 *
 * The project has no component renderer, so these assert the properties that
 * would silently break the feature or the vault if they regressed: an entry
 * point that opens onto a dead end, a selection that outlives a lock, or a
 * selection that outlives a lock, or a preview that bypasses its dedicated
 * full-image controller. Capture and sharing still belong to a later phase.
 */

const COMPARE = readFileSync('src/components/photoVault/PhotoCompareScreen.tsx', 'utf8');
const POSTER = readFileSync(
  'src/components/photoVault/PhotoComparePoster.tsx',
  'utf8',
);
const SCREEN = readFileSync('src/screens/ProgressPhotosScreen.tsx', 'utf8');
const RULES = readFileSync('src/lib/photoVaultCompare.ts', 'utf8');
const CONTROLLER = readFileSync('src/lib/photoVaultCompareController.ts', 'utf8');
const EXPORT = readFileSync('src/lib/photoVaultCompareExport.ts', 'utf8');
const SHARE = readFileSync('src/lib/photoVaultCompareShare.ts', 'utf8');

/** Source with comments stripped, for assertions about what the code does. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const COMPARE_CODE = code(COMPARE);
const POSTER_CODE = code(POSTER);
const SCREEN_CODE = code(SCREEN);

describe('the gallery entry point', () => {
  it('gates the compare action on a real pair existing', () => {
    // Not `photos.length >= 2`: one front and one side is two photos and zero
    // valid pairs, so that gate would open the comparator onto a dead end.
    expect(SCREEN_CODE).toContain('canCompareProgressPhotos(gallery.photos)');
  });

  it('renders the action only when that gate passes', () => {
    expect(SCREEN_CODE).toMatch(/\{canCompare \?[\s\S]*?setCompareOpen\(true\)/);
  });

  it('opens on a tap rather than a long press', () => {
    const cta = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf('photo-vault-compare-cta'),
      SCREEN_CODE.indexOf('</Pressable>', SCREEN_CODE.indexOf('photo-vault-compare-cta')),
    );
    expect(SCREEN_CODE).toContain('testID="photo-vault-compare-cta"');
    expect(cta).not.toContain('onLongPress');
  });

  it('does not scatter comparator state across the gallery screen', () => {
    // The host owns one boolean: whether the comparator is open. The selection
    // itself lives in the comparator, which is what makes it ephemeral.
    expect(SCREEN_CODE).toContain('useState(false)');
    expect(SCREEN_CODE).not.toContain('setBeforePhoto');
    expect(SCREEN_CODE).not.toContain('setAfterPhoto');
    expect(SCREEN_CODE).not.toContain('normalizeBeforeAfter');
  });

  it('hands over only photos it already holds, plus the visibility callbacks', () => {
    const mount = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf('<PhotoCompareScreen'),
      SCREEN_CODE.indexOf('/>', SCREEN_CODE.indexOf('<PhotoCompareScreen')),
    );
    expect(mount).toContain('photos={gallery.photos}');
    expect(mount).toContain('onVisible={claimGalleryThumbnail}');
    expect(mount).toContain('onHidden={releaseGalleryThumbnail}');
  });

  it('leaves the grid’s own visibility wiring intact', () => {
    // Both surfaces claim and release independently; the controller counts
    // owners, so neither can cancel work the other is waiting on.
    const grid = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf('<PhotoVaultGrid'),
      SCREEN_CODE.indexOf('listHeader='),
    );
    expect(grid).toContain('onVisible={claimGalleryThumbnail}');
    expect(grid).toContain('onHidden={releaseGalleryThumbnail}');
  });
});

describe('the comparator closes with the vault', () => {
  it('is dismissed by the same effect that dismisses the viewer and sheet', () => {
    const effect = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf('releaseGalleryPhotoFromViewer(viewerId)'),
      SCREEN_CODE.indexOf('}, [unlocked, viewerId]);'),
    );
    expect(effect).toContain('setCompareOpen(false)');
  });

  it('discards the selection whenever it is not visible', () => {
    // Closing for any reason — cancel, back, or a lock — leaves nothing
    // behind, because the selection is state inside this component.
    const reset = COMPARE_CODE.slice(
      COMPARE_CODE.indexOf('if (!visible)'),
      COMPARE_CODE.indexOf('}, [visible]);'),
    );
    expect(reset).toContain('setFirst(null)');
    expect(reset).toContain('setSecond(null)');
    expect(reset).toContain('discardPhotoVaultComparison()');
    expect(reset).toContain('setPreviewStarted(false)');
  });

  it('drops a selected photo that disappears from the gallery', () => {
    // A delete or an account switch can remove it underneath the screen.
    expect(COMPARE_CODE).toContain('currentVersion');
    expect(COMPARE_CODE).toContain('entry.photoId === photo.photoId');
    expect(COMPARE_CODE).toContain('entry.assetId === photo.assetId');
  });

  it('never persists a selection anywhere', () => {
    expect(COMPARE).not.toContain('AsyncStorage');
    expect(COMPARE).not.toContain('SecureStore');
    expect(COMPARE).not.toContain('firebase');
    expect(COMPARE).not.toContain('expo-file-system');
  });
});

describe('the two selection steps', () => {
  it('offers only photos that have a partner as the opening pick', () => {
    expect(COMPARE_CODE).toContain('if (!first) return comparisonStartCandidates(photos)');
  });

  it('narrows the second step to the first pick’s own group', () => {
    expect(COMPARE_CODE).toContain('return comparisonCandidatesFor(first, photos)');
  });

  it('derives both steps from the in-memory list, not a new query', () => {
    const options = COMPARE_CODE.slice(
      COMPARE_CODE.indexOf('const options = useMemo'),
      COMPARE_CODE.indexOf('}, [first, photos]);'),
    );
    expect(options).not.toContain('loadGallery');
    expect(options).not.toContain('await');
  });

  it('labels the step from the selection state rather than a counter', () => {
    expect(COMPARE_CODE).toMatch(
      /const stepLabel = first\s*\?\s*t\('progress\.photos\.compare\.stepAfter'\)\s*:\s*t\('progress\.photos\.compare\.stepBefore'\)/,
    );
  });

  it('marks the opening pick as selected in the list', () => {
    expect(COMPARE_CODE).toContain('const isFirst = first?.photoId === item.photoId');
    expect(COMPARE_CODE).toContain('selected={isFirst}');
    expect(COMPARE_CODE).toContain('accessibilityState={{ selected }}');
  });

  it('owns both selected thumbnails while the review renders them', () => {
    const ownership = COMPARE_CODE.slice(
      COMPARE_CODE.indexOf('if (!visible || !pair || previewStarted)'),
      COMPARE_CODE.indexOf('}, [onHidden, onVisible, pair, previewStarted, visible]);'),
    );
    expect(ownership).toContain('onVisible(pair.before.photoId)');
    expect(ownership).toContain('onVisible(pair.after.photoId)');
    expect(ownership).toContain('onHidden(beforeOwner)');
    expect(ownership).toContain('onHidden(afterOwner)');
  });

  it('offers a way out when the first pick has no partner left', () => {
    expect(COMPARE_CODE).toContain('options.length === 0 && first');
    expect(COMPARE_CODE).toContain('<NoCandidates');
  });
});

describe('back, change and cancel', () => {
  it('steps back one stage at a time before closing', () => {
    const back = COMPARE_CODE.slice(
      COMPARE_CODE.indexOf('const handleBack = useCallback'),
      COMPARE_CODE.indexOf('}, [first, second, onClose, previewStarted]);'),
    );
    expect(back).toContain('if (previewStarted)');
    expect(back).toContain('discardPhotoVaultComparison()');
    // Order matters: the newest choice is undone first.
    expect(back.indexOf('setSecond(null)')).toBeLessThan(back.indexOf('setFirst(null)'));
    expect(back.indexOf('setFirst(null)')).toBeLessThan(back.indexOf('onClose()'));
  });

  it('is also what the hardware back button does', () => {
    expect(COMPARE_CODE).toContain('onRequestClose={handleBack}');
  });

  it('clears the second pick too when the before photo is changed', () => {
    // The new before photo may belong to another group, which would leave the
    // old after photo unpairable.
    expect(COMPARE_CODE).toMatch(
      /onChangeBefore=\{\(\) => \{\s*setFirst\(null\);\s*setSecond\(null\);\s*\}\}/,
    );
  });

  it('keeps the before photo when only the after photo is changed', () => {
    expect(COMPARE_CODE).toContain('onChangeAfter={() => setSecond(null)}');
  });

  it('cancels straight out of any step', () => {
    expect(COMPARE_CODE).toMatch(/accessibilityLabel=\{t\('progress\.photos\.compare\.cancel'\)\}/);
    expect(COMPARE_CODE).toContain('onPress={handleClose}');
  });
});

describe('the review step', () => {
  it('orders the pair by capture time rather than tap order', () => {
    expect(COMPARE_CODE).toContain('normalizeBeforeAfter(first, second)');
    expect(RULES).toContain('takenAt.getTime()');
  });

  it('refuses to present a pair the rules rejected', () => {
    expect(COMPARE_CODE).toContain('return result.ok ? result : null');
  });

  it('shows the review only once both photos are chosen', () => {
    expect(COMPARE_CODE).toContain('const reviewing = pair !== null');
    expect(COMPARE_CODE).toContain('if (!first || !second) return null');
  });

  it('loads the ordered pair, not the raw taps', () => {
    expect(COMPARE_CODE).toContain(
      'loadPhotoVaultComparison({ before: pair.before, after: pair.after })',
    );
  });
});

describe('full, capture and share responsibilities stay isolated', () => {
  const OUT_OF_SCOPE = [
    // Full loading belongs to the dedicated controller, never the UI or the
    // gallery viewer pipeline.
    'downloadProgressPhoto',
    'ensureFullPhotoLoaded',
    'fullLru',
    'viewerOwnerId',
    'claimGalleryPhotoForViewer',
    // Native capture remains isolated behind the export controller.
    'captureRef',
    'expo-sharing',
    'shareAsync',
    'createPhotoVaultShareFilePath',
    // Never in the UI layer at all.
    'photoVaultCrypto',
    'photoVaultKeyStorage',
    'MediaLibrary',
  ];

  it.each(OUT_OF_SCOPE)('the comparator UI does not reach for %s', (symbol) => {
    expect(COMPARE_CODE).not.toContain(symbol);
  });

  it('reads gallery thumbnails only during selection and fulls from controller state', () => {
    expect(COMPARE_CODE).toContain('photo.thumbnailUri');
    expect(COMPARE_CODE).not.toContain('previewUri');
    expect(COMPARE_CODE).toContain('fullState.beforeFullUri');
    expect(COMPARE_CODE).toContain('fullState.afterFullUri');
  });

  it('keeps Firebase, Storage and crypto behind the secure service', () => {
    for (const symbol of ['firebase/firestore', 'firebase/storage', 'getDownloadURL']) {
      expect(CONTROLLER).not.toContain(symbol);
    }
    expect(CONTROLLER).toContain('downloadProgressPhoto(metadata)');
  });

  it('keeps expo-sharing isolated behind the share controller', () => {
    expect(COMPARE_CODE).not.toContain("from 'expo-sharing'");
    expect(COMPARE_CODE).toContain('sharePhotoVaultComparison()');
    expect(SHARE).toContain("from 'expo-sharing'");
    expect(SHARE).toContain('Sharing.shareAsync(exportUri');
  });

  it('keeps the pairing rules free of every side effect', () => {
    for (const symbol of ['firebase', 'expo-file-system', 'expo-crypto', 'react', 'AsyncStorage']) {
      expect(RULES).not.toContain(symbol);
    }
  });
});

describe('list behaviour', () => {
  it('uses one virtualised selection list and one bounded preview scroller', () => {
    expect(COMPARE_CODE.match(/<FlatList/g)).toHaveLength(1);
    expect(COMPARE_CODE.match(/<ScrollView/g)).toHaveLength(1);
    expect(COMPARE_CODE).not.toContain('<SectionList');
  });

  it('keeps the windowing bounded rather than rendering everything', () => {
    expect(COMPARE_CODE).toContain('initialNumToRender=');
    expect(COMPARE_CODE).toContain('windowSize=');
  });

  it('announces visibility so decryption follows the viewport', () => {
    const cell = COMPARE_CODE.slice(
      COMPARE_CODE.indexOf('function CompareCell'),
      COMPARE_CODE.indexOf('const MemoCompareCell'),
    );
    expect(cell).toContain('onVisible(photo.photoId)');
    expect(cell).toContain('return () => onHidden(owner)');
  });

  it('memoises the cell so a re-render does not remount every thumbnail', () => {
    expect(COMPARE_CODE).toContain('memo(CompareCell)');
  });
});

describe('presentation', () => {
  it('renders no user-facing string outside i18n', () => {
    // Any literal with two consecutive letters inside JSX text.
    const jsxText =
      `${COMPARE_CODE}\n${POSTER_CODE}`.match(
        />\s*[A-Za-z][A-Za-z ]{3,}\s*</g,
      ) ?? [];
    expect(jsxText).toEqual([]);
  });

  it('renders a responsive 9:16 full-image poster with conservative cover crop', () => {
    expect(POSTER_CODE).toContain('testID="photo-vault-compare-capture-view"');
    expect(POSTER_CODE).toContain(
      'PHOTO_COMPARE_POSTER_ASPECT_RATIO = 9 / 16',
    );
    expect(COMPARE_CODE).toContain(
      'const posterHeight = posterWidth / PHOTO_COMPARE_POSTER_ASPECT_RATIO',
    );
    expect(POSTER_CODE).toContain('source={{ uri }}');
    expect(POSTER_CODE).toContain('resizeMode="cover"');
  });

  it('uses the extra story height intentionally instead of stretching the old layout', () => {
    expect(POSTER_CODE).toContain('const safeTop = height * 0.058');
    expect(POSTER_CODE).toContain('const safeBottom = height * 0.042');
    expect(POSTER_CODE).toContain('const brandingHeight = height * 0.209');
    expect(POSTER_CODE).toContain('const footerHeight = height * 0.105');
    expect(POSTER_CODE).toContain('height: photoMetaHeight');
    expect(POSTER_CODE).toContain('testID="photo-vault-compare-poster-photos"');
    expect(POSTER_CODE).toMatch(
      /testID="photo-vault-compare-poster-photos"[\s\S]*?flex: 1/,
    );
  });

  it('makes the photographs the dominant vertical element', () => {
    expect(POSTER_CODE).toContain('const photoMetaHeight = width * 0.094');
    const expectedPhotoHeightRatio =
      1 - 0.058 - 0.042 - 0.209 - 0.105 - 0.094 * (9 / 16);
    const expectedComparisonBlockRatio =
      expectedPhotoHeightRatio + 0.094 * (9 / 16);
    expect(expectedPhotoHeightRatio).toBeGreaterThan(0.53);
    expect(expectedPhotoHeightRatio).toBeLessThan(0.54);
    expect(expectedComparisonBlockRatio).toBeGreaterThan(0.58);
  });

  it('matches the reference photo width and narrow central channel', () => {
    expect(POSTER_CODE).toContain('const horizontalPadding = width * 0.0265');
    expect(POSTER_CODE).toContain('const photoGap = width * 0.052');
    expect(POSTER_CODE).toContain('source={AJ_FIT_COMPARISON_BACKGROUND}');
    expect(POSTER_CODE).not.toContain('dividerWidth');
  });

  it('uses the fixed local AVIF as the sole decorative background', () => {
    expect(statSync('assets/background-comparacao.avif').isFile()).toBe(true);
    expect(POSTER_CODE).toContain("import { Image as ExpoImage } from 'expo-image'");
    expect(POSTER_CODE).toContain('backgroundColor: colors.bg');
    expect(POSTER_CODE).toContain(
      "require('../../../assets/background-comparacao.avif')",
    );
    expect(POSTER_CODE).toContain(
      'testID="photo-vault-compare-poster-background"',
    );
    expect(POSTER_CODE).toContain('source={AJ_FIT_COMPARISON_BACKGROUND}');
    expect(POSTER_CODE).toContain('contentFit="cover"');
    expect(POSTER_CODE).toContain('contentPosition="center"');
    expect(POSTER_CODE).toContain('accessible={false}');
    expect(POSTER_CODE).not.toContain('LinearGradient');
    expect(POSTER_CODE).not.toContain('photo-vault-compare-poster-divider');
    expect(POSTER_CODE).not.toContain('photo-vault-compare-poster-top-left-accent');
    expect(POSTER_CODE).not.toContain('photo-vault-compare-poster-top-right-accent');
    expect(POSTER_CODE).not.toContain('photo-vault-compare-poster-bottom-accent');
  });

  it('places the decorative background inside and across the captured tree', () => {
    const captureRoot = POSTER_CODE.indexOf(
      'testID="photo-vault-compare-capture-view"',
    );
    const background = POSTER_CODE.indexOf(
      'testID="photo-vault-compare-poster-background"',
      captureRoot,
    );
    const dynamicBranding = POSTER_CODE.indexOf(
      'testID="photo-vault-compare-poster-branding"',
      background,
    );
    const backgroundNode = POSTER_CODE.slice(background, dynamicBranding);

    expect(captureRoot).toBeGreaterThan(0);
    expect(background).toBeGreaterThan(captureRoot);
    expect(dynamicBranding).toBeGreaterThan(background);
    expect(backgroundNode).toContain("position: 'absolute'");
    expect(backgroundNode).toContain('top: 0');
    expect(backgroundNode).toContain('right: 0');
    expect(backgroundNode).toContain('bottom: 0');
    expect(backgroundNode).toContain('left: 0');
    expect(backgroundNode).toContain('accessible={false}');
  });

  it('keeps a readable minimum preview and lets the existing outer scroller handle short screens', () => {
    expect(COMPARE_CODE).toContain('const minimumPreviewWidth = Math.min(240, availableWidth)');
    expect(COMPARE_CODE).toContain(
      'availableHeight * PHOTO_COMPARE_POSTER_ASPECT_RATIO',
    );
    expect(COMPARE_CODE).toContain('<ScrollView');
    expect(POSTER_CODE).not.toContain('<ScrollView');
  });

  it('renders the official transparent logo inside the captured poster', () => {
    expect(POSTER).toContain("require('../../../assets/aj-logo.png')");
    const poster = POSTER_CODE.slice(
      POSTER_CODE.indexOf('testID="photo-vault-compare-capture-view"'),
      POSTER_CODE.indexOf(
        '/>',
        POSTER_CODE.indexOf('testID="photo-vault-compare-logo"'),
      ),
    );
    expect(poster).toContain('testID="photo-vault-compare-logo"');
    expect(poster).toContain('source={AJ_FIT_LOGO}');
    expect(poster).toContain('resizeMode="contain"');
    expect(poster).toContain('width: width * 0.125');
    expect(poster).toContain('height: width * 0.125');
    expect(poster).toContain('accessible={false}');
    expect(POSTER_CODE).not.toContain('>AJ FIT<');
    expect(POSTER_CODE).not.toContain('data:image/png;base64');
  });

  it('captures only after the two fulls, background, poster and logo are ready', () => {
    expect(COMPARE_CODE).toContain(
      'posterLaidOut &&\n    beforeRendered &&\n    afterRendered &&\n    backgroundReady &&\n    logoReady',
    );
    expect(COMPARE_CODE).toContain(
      'onBackgroundLoad={() => setBackgroundReady(true)}',
    );
    expect(COMPARE_CODE).toContain(
      'onBackgroundError={() => setBackgroundReady(false)}',
    );
    expect(COMPARE_CODE).toContain('onLogoLoad={() => setLogoReady(true)}');
    expect(COMPARE_CODE).toContain('posterRef,');
    expect(COMPARE_CODE).toContain('posterReady,');
    expect(COMPARE_CODE).toContain('logoReady,');
    expect(EXPORT).toContain('input.posterRef.current !== null');
    expect(EXPORT).toContain("full.status === 'ready'");
  });

  it('keeps controls and status outside the captured View', () => {
    const posterStart = COMPARE_CODE.indexOf('<PhotoComparePoster');
    const button = COMPARE_CODE.indexOf('<CtaButton', posterStart);
    expect(button).toBeGreaterThan(posterStart);
    expect(COMPARE_CODE.slice(posterStart, button)).toContain('/>');
    expect(COMPARE_CODE).toContain('ref={posterRef}');
    expect(POSTER_CODE).toContain('collapsable={false}');
  });

  it('uses one premium social poster for both preview and export', () => {
    expect(COMPARE_CODE.match(/<PhotoComparePoster/g)).toHaveLength(1);
    expect(COMPARE_CODE).toContain('<PhotoComparePoster');
    expect(COMPARE_CODE).toContain('ref={posterRef}');
    expect(COMPARE_CODE).toContain('capturePhotoVaultComparison({');
    expect(COMPARE_CODE).toContain('posterRef,');
    expect(COMPARE_CODE).not.toContain('PosterExport');
    expect(COMPARE_CODE).not.toContain('PosterPreview');
  });

  it('contains no remaining 4:5 or 1080x1350 poster contract', () => {
    const posterFeature = `${COMPARE_CODE}\n${POSTER_CODE}\n${code(EXPORT)}`;
    expect(posterFeature).not.toContain('4:5');
    expect(posterFeature).not.toContain('1350');
    expect(posterFeature).not.toContain('posterWidth * 1.25');
  });

  it('keeps PhotoComparePoster purely visual', () => {
    for (const forbidden of [
      'firebase',
      'Storage',
      'photoVaultCrypto',
      'VaultKey',
      'photoVaultCompareController',
      'photoVaultCompareExport',
      'photoVaultCompareShare',
      'captureRef',
      'shareAsync',
      'downloadProgressPhoto',
    ]) {
      expect(POSTER_CODE).not.toContain(forbidden);
    }
  });

  it('builds the requested branding and headline hierarchy from localized copy', () => {
    expect(POSTER_CODE).toContain('testID="photo-vault-compare-poster-branding"');
    expect(POSTER_CODE).toContain('testID="photo-vault-compare-poster-headline"');
    expect(POSTER_CODE).toContain('{copy.headlinePrimary}');
    expect(POSTER_CODE).toContain('{copy.headlineAccent}');
    expect(POSTER_CODE).toContain(
      'testID="photo-vault-compare-poster-subheadline"',
    );
    expect(POSTER_CODE).toContain('{copy.subheadline}');
  });

  it('keeps before left, after right, with real dates and two full images', () => {
    const before = POSTER_CODE.indexOf(
      "side('before', beforeUri, copy.before, beforeDate, onBeforeLoad)",
    );
    const after = POSTER_CODE.indexOf(
      "side('after', afterUri, copy.after, afterDate, onAfterLoad)",
    );
    expect(before).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(before);
    expect(COMPARE_CODE).toContain('posterDateFormatter.format(before.takenAt)');
    expect(COMPARE_CODE).toContain('posterDateFormatter.format(after.takenAt)');
    expect(COMPARE_CODE).toContain(
      'i18n.resolvedLanguage ?? i18n.language',
    );
    expect(POSTER_CODE.match(/resizeMode="cover"/g)).toHaveLength(1);
  });

  it('overlays only the real civil-day badge on the background-owned divider', () => {
    expect(POSTER_CODE).not.toContain('testID="photo-vault-compare-poster-divider"');
    expect(POSTER_CODE).toContain('testID="photo-vault-compare-poster-period"');
    expect(POSTER_CODE).toContain('{`+${daysDifference}`}');
    expect(COMPARE_CODE).toContain(
      'const daysDifference = comparisonElapsedDays(before, after)',
    );
    expect(RULES).toContain('photo.dateKey');
    expect(RULES).toContain('Date.UTC(year, month - 1, day)');
  });

  it('includes the localized lower signature and AJ Fit hashtag', () => {
    expect(POSTER_CODE).toContain('testID="photo-vault-compare-poster-footer"');
    expect(POSTER_CODE).toContain('{copy.footerMethod}');
    expect(POSTER_CODE).toContain('{`${copy.footerYou} `}');
    expect(POSTER_CODE).toContain('{copy.footerEvolve}');
    expect(POSTER_CODE).toContain('{copy.hashtag}');
  });

  it('does not introduce invented transformation metrics', () => {
    for (const metric of [
      'body fat',
      'muscle mass',
      'calories',
      'streak',
      'score',
      'weight lost',
    ]) {
      expect(`${COMPARE_CODE}\n${POSTER_CODE}`.toLowerCase()).not.toContain(metric);
    }
  });

  it('turns the ready export CTA into the generic share action', () => {
    expect(COMPARE_CODE).toContain("exportState.status === 'ready'");
    expect(COMPARE_CODE).toContain("t('progress.photos.compare.share')");
    expect(COMPARE_CODE).toContain('void sharePhotoVaultComparison()');
    expect(COMPARE_CODE).not.toContain('Instagram');
    expect(COMPARE_CODE).not.toContain('WhatsApp');
  });

  it('invalidates share UI state before export cleanup on close', () => {
    const close = COMPARE_CODE.slice(
      COMPARE_CODE.indexOf('const handleClose = useCallback'),
      COMPARE_CODE.indexOf('}, [onClose]);'),
    );
    expect(close).toContain('discardPhotoVaultComparisonShare()');
    expect(close).toContain('discardPhotoVaultComparisonExport()');
    expect(close.indexOf('discardPhotoVaultComparisonShare()')).toBeLessThan(
      close.indexOf('discardPhotoVaultComparisonExport()'),
    );
  });

  it('exposes accessible busy, failure and completed share states', () => {
    expect(COMPARE_CODE).toContain("shareState.status === 'sharing'");
    expect(COMPARE_CODE).toContain("shareState.status === 'completed'");
    expect(COMPARE_CODE).toContain("shareState.issue === 'compareShareUnavailable'");
    expect(COMPARE_CODE).toContain('accessibilityLiveRegion="assertive"');
    expect(COMPARE_CODE).toContain('accessibilityLiveRegion="polite"');
    expect(COMPARE_CODE).toContain('busy: actionBusy');
  });

  it('has loading, controlled error and retry states', () => {
    expect(COMPARE_CODE).toContain('<ComparisonLoading');
    expect(COMPARE_CODE).toContain('<ComparisonLoadError');
    expect(COMPARE_CODE).toContain('retryPhotoVaultComparison()');
  });

  it('has no leftover diagnostics', () => {
    expect(COMPARE_CODE).not.toContain('console.');
  });

  it('labels every control for assistive technology', () => {
    const buttons = COMPARE_CODE.match(/accessibilityRole="button"/g) ?? [];
    const labels = COMPARE_CODE.match(/accessibilityLabel=/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(labels.length).toBeGreaterThanOrEqual(buttons.length);
  });
});
