import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workout = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');
const composer = readFileSync(
  new URL('../../components/workoutShare/WorkoutShareComposer.tsx', import.meta.url),
  'utf8',
);
const posterPhoto = readFileSync(
  new URL('../../components/workoutShare/posters/PosterPhoto.tsx', import.meta.url),
  'utf8',
);
const registry = readFileSync(
  new URL('../../components/workoutShare/posters/registry.tsx', import.meta.url),
  'utf8',
);
const icon = readFileSync(new URL('../../components/ui/Icon.tsx', import.meta.url), 'utf8');
const media = readFileSync(new URL('../../workoutShare/media.ts', import.meta.url), 'utf8');
const nativeAndroid = readFileSync(
  new URL('../../../modules/ajfit-instagram-stories/android/src/main/java/com/ajfit/instagramstories/AJFitInstagramStoriesModule.kt', import.meta.url),
  'utf8',
);
const nativeIos = readFileSync(
  new URL('../../../modules/ajfit-instagram-stories/ios/AJFitInstagramStoriesModule.swift', import.meta.url),
  'utf8',
);

const POSTER_FILES = ['PosterClassic', 'PosterMinimal', 'PosterPerformance', 'PosterBodyMap', 'PosterCreative', 'PosterSocial'] as const;
const posterSources = Object.fromEntries(
  POSTER_FILES.map((name) => [
    name,
    readFileSync(new URL(`../../components/workoutShare/posters/${name}.tsx`, import.meta.url), 'utf8'),
  ]),
);

const ART_POSTER_FILES = ['ArtPosterMinimal', 'ArtPosterPerformance', 'ArtPosterPr', 'ArtPosterStats'] as const;
const artPosterSources = Object.fromEntries(
  ART_POSTER_FILES.map((name) => [
    name,
    readFileSync(new URL(`../../components/workoutShare/artPosters/${name}.tsx`, import.meta.url), 'utf8'),
  ]),
);
const artRegistry = readFileSync(
  new URL('../../components/workoutShare/artPosters/registry.tsx', import.meta.url),
  'utf8',
);
const checkerboard = readFileSync(
  new URL('../../components/workoutShare/ArtPreviewCheckerboard.tsx', import.meta.url),
  'utf8',
);


// The exact logo size the original single-poster Classic design shipped
// with (`31 * scale`) — every design must now ship a strictly larger value.
const ORIGINAL_LOGO_SCALE_FACTOR = 31;

/** Slices out just the inner ref'd poster box for one page — the exact subtree `captureWorkoutSharePoster`/view-shot walks. */
function capturedPosterBoxSource(): string {
  const start = composer.indexOf('const mounted = Math.abs(index - selectedIndex) <= 1;');
  const end = composer.indexOf('</ScrollView>', start);
  return composer.slice(start, end);
}

describe('post-workout share architecture', () => {
  it('exposes the composer only inside the durable-success branch, as the terminal screen', () => {
    const finished = workout.slice(workout.indexOf('if (finished) {'), workout.indexOf('if (showCardioFinisher'));
    expect(finished.indexOf('if (!completionConfirmed && !completionFailed)')).toBeLessThan(finished.indexOf('<WorkoutShareComposer'));
    expect(finished.indexOf('if (completionFailed)')).toBeLessThan(finished.indexOf('<WorkoutShareComposer'));
    expect(finished).toContain('data={buildWorkoutShareData');
    expect(finished).not.toContain('<WorkoutDone');
  });

  it('the composer is the terminal screen: its onDone is the only exit, and it never runs lifecycle mutations itself', () => {
    expect(composer).not.toContain('onSessionCompleted');
    expect(composer).not.toContain('finalize');
    expect(composer).toContain('onDone: () => void');
    expect(composer).toContain('onPress={finish}');
  });

  it('supports camera and gallery, shared across every poster design, with no textual "use without photo" action', () => {
    expect(media).toContain('requestCameraPermissionsAsync');
    expect(media).toContain('requestMediaLibraryPermissionsAsync');
    expect(media).toContain("mediaTypes: ['images']");
    for (const source of Object.values(posterSources)) {
      expect(source).toContain('workout-share-poster');
    }
    expect(composer).not.toContain('shareComposer.noPhoto');
    expect(composer).not.toMatch(/label=\{t\('done\.shareComposer\.(noPhoto|library|camera)'\)\}\s+icon="x"/);
  });

  it('camera and gallery are both reachable without scrolling and without an existing photo', () => {
    expect(composer).toContain("icon: 'camera' | 'plus' | 'swap'");
    expect(composer).toContain('icon="plus"');
    expect(composer).toContain('icon="camera"');
    expect(composer).toContain("resolvePhotoActionsMode(photo?.uri) === 'change'");
  });

  it('there is no separate model-preview strip — the carousel lives directly on the poster', () => {
    expect(composer).not.toContain('ModelSelector');
    expect(composer).not.toContain('workout-share-model-selector');
    // `pointerEvents="none"` does legitimately appear once now — on the
    // hidden off-screen HD export stage, which is not a preview strip at
    // all (see the dedicated HD-stage tests below).
    const withoutHdStage = composer.slice(0, composer.indexOf('{hdMountedPosterId ? (() => {'));
    expect(withoutHdStage).not.toContain('pointerEvents="none"');
  });

  it('swiping the poster itself switches designs (a paging carousel wraps the poster pages)', () => {
    expect(composer).toContain('testID="workout-share-poster-carousel"');
    expect(composer).toContain('pagingEnabled');
    expect(composer).toContain('WORKOUT_SHARE_POSTERS.map((poster, index) =>');
    // The carousel scroll handler is what drives layout selection.
    expect(composer).toContain('onMomentumScrollEnd={updateSelectedIndexFromOffset}');
  });

  it('shows a minimalist nav arrow on each side only when a model exists in that direction', () => {
    expect(composer).toContain('function ModelNavArrow');
    expect(composer).toContain("name={direction === 'left' ? 'arrow-left' : 'arrow-right'}");
    // Gated strictly on index bounds — never rendered unconditionally.
    expect(composer).toContain('{selectedIndex > 0 ? (');
    expect(composer).toContain('{selectedIndex < WORKOUT_SHARE_POSTERS.length - 1 ? (');
    expect(composer).toContain('direction="left"');
    expect(composer).toContain('direction="right"');
    expect(composer).toContain("t('done.shareComposer.previousModel')");
    expect(composer).toContain("t('done.shareComposer.nextModel')");
    // Tapping an arrow reuses the exact same navigation as the dots/swipe.
    expect(composer).toContain('onPress={() => scrollToIndex(selectedIndex - 1)}');
    expect(composer).toContain('onPress={() => scrollToIndex(selectedIndex + 1)}');
  });

  it('renders the nav arrow as a bare glyph — no circle/background — outside the poster box in its own reserved slot', () => {
    const arrowSource = composer.slice(composer.indexOf('function ModelNavArrow'), composer.indexOf('function PageDots'));
    expect(arrowSource).not.toContain('backgroundColor');
    expect(arrowSource).not.toContain('borderWidth');
    expect(arrowSource).not.toContain('borderRadius');
    expect(arrowSource).toContain("color=\"rgba(255,255,255,0.75)\"");
    // The arrow slots are separate flex siblings of the poster box, not
    // absolutely-positioned overlays on top of the photo.
    expect(composer).toContain("<View style={{ width: ARROW_SLOT_WIDTH, alignItems: 'center' }}>");
  });

  it('keeps the nav arrows out of the captured poster subtree — they are overlay siblings, not descendants', () => {
    const captured = capturedPosterBoxSource();
    expect(captured).not.toContain('ModelNavArrow');
  });

  it('gates photo repositioning to two fingers so it never fights the swipe-to-change-design gesture living on the same poster', () => {
    expect(posterPhoto).toContain('Gesture.Pinch()');
    expect(posterPhoto).toContain('Gesture.Pan()');
    expect(posterPhoto).toContain('.minPointers(2)');
    expect(posterPhoto).toContain('.maxPointers(2)');
    expect(posterPhoto).toContain('Gesture.Simultaneous(pinch, pan)');
  });

  it('every design covering its full canvas with the photo keeps it full-screen — never a thumbnail, never a partial/cropped block', () => {
    // Feed Post (Creative) intentionally only shows the photo behind its
    // BodyMap panel (bottom half); Social Feed intentionally shows it inside
    // a bounded photo card — see the dedicated tests below for both
    // documented exceptions.
    const partialPhotoDesigns = ['PosterCreative', 'PosterSocial'];
    for (const [name, source] of Object.entries(posterSources)) {
      if (partialPhotoDesigns.includes(name)) continue;
      expect(source, name).toMatch(/<PosterPhoto[^>]*width=\{width\}[^>]*height=\{height\}/s);
      expect(source.toLowerCase(), `${name} must not size the photo as a thumbnail`).not.toMatch(/thumb/);
    }
  });

  it('Feed Post (Creative) uses the fixed gym artwork behind its BodyMap panel only', () => {
    const creative = posterSources.PosterCreative;
    expect(creative).not.toContain("from './PosterPhoto'");
    expect(creative).toContain('data, posterRef, width, height');
    expect(creative).toContain('useWorkoutShareGymArtSource()');
    expect(creative).toContain('height: bodyMapHeight');
    // Only within the BodyMap panel — the top info column never shows it.
    const bodyMapPanelStart = creative.indexOf('{hasBodyMap ? (');
    expect(bodyMapPanelStart).toBeGreaterThan(-1);
    expect(creative.indexOf('source={gymArtSource}')).toBeGreaterThan(bodyMapPanelStart);
  });

  it('captures the currently selected layout via its own stable ref — never a poster scrolled out of focus', () => {
    expect(composer).toContain('WORKOUT_SHARE_POSTERS');
    expect(composer).toContain('const posterRefs = useMemo(');
    expect(composer).toContain('refs[poster.id] = createRef<View>()');
    expect(composer).toContain('const ref = posterRefs[selectedPoster.id]');
    expect(composer).toContain('captureWorkoutSharePoster(ref,');
    expect(composer).toContain('width: selectedPoster.exportWidth');
    expect(composer).toContain('height: selectedPoster.exportHeight');
    expect(composer).not.toMatch(/layout(Id)?\s*===\s*['"]/);
  });

  it('renders 6 layouts from one registry, mapped without scattered conditionals', () => {
    expect(registry).toContain('PosterClassic');
    expect(registry).toContain('PosterMinimal');
    expect(registry).toContain('PosterPerformance');
    expect(registry).toContain('PosterBodyMap');
    expect(registry).toContain('PosterCreative');
    expect(registry).toContain('PosterSocial');
    expect(registry).not.toMatch(/if\s*\(.*id\s*===/);
  });

  it('windows poster rendering to the selected page and its neighbors, so swiping stays cheap', () => {
    expect(composer).toContain('Math.abs(index - selectedIndex) <= 1');
  });

  it('grew the on-screen preview now that the thumbnail strip is gone, while the export/aspect ratio stay fixed', () => {
    expect(composer).toContain('PREVIEW_ASPECT_RATIO = 9 / 16');
    expect(composer).toContain('PREVIEW_WIDTH_RATIO = 0.78');
    expect(composer).toContain('PREVIEW_MIN_WIDTH = 190');
    expect(composer).toContain('PREVIEW_MAX_WIDTH = 270');
    expect(composer).toContain('aspectRatio: PREVIEW_ASPECT_RATIO');
    expect(composer).not.toContain('containFit');
  });

  it('keeps the remove-photo X out of the captured poster subtree — it is a sibling overlay, not a descendant', () => {
    const captured = capturedPosterBoxSource();
    expect(composer).toContain('shouldShowRemovePhotoButton(photo?.uri)');
    expect(composer).toContain("t('done.shareComposer.removePhoto')");
    // The exact subtree passed to `captureWorkoutSharePoster` — each page's
    // ref'd poster box — must not contain the remove-photo control at all.
    expect(captured).not.toContain('removePhoto');
    expect(captured).not.toContain('shouldShowRemovePhotoButton');
  });

  it('renders the header, remove-photo, gallery and camera controls as bare icons without circular chrome', () => {
    const iconAction = composer.slice(
      composer.indexOf('function IconAction'),
      composer.indexOf('// A fixed-width slot'),
    );
    expect(iconAction).not.toContain('borderRadius');
    expect(iconAction).not.toContain('borderWidth');
    expect(iconAction).not.toContain('backgroundColor');
    expect(iconAction).toContain('<Icon name={icon}');
    expect(iconAction).toContain('{label}');

    const headerCloseStart = composer.indexOf("accessibilityLabel={t('done.shareComposer.close')}");
    const headerClose = composer.slice(headerCloseStart, composer.indexOf('</Pressable>', headerCloseStart));
    expect(headerClose).not.toContain('borderRadius');
    expect(headerClose).not.toContain('borderWidth');
    expect(headerClose).not.toContain('backgroundColor');
    expect(headerClose).toContain('name="x"');

    const removePhotoStart = composer.indexOf('{shouldShowRemovePhotoButton(photo?.uri) ? (');
    const removePhoto = composer.slice(removePhotoStart, composer.indexOf('</Pressable>', removePhotoStart));
    expect(removePhoto).not.toContain('borderRadius');
    expect(removePhoto).not.toContain('borderWidth');
    expect(removePhoto).not.toContain('backgroundColor');
    expect(removePhoto).toContain('name="x"');
  });

  it('keeps the inline "Compartilhar em" row inside the normal scroll flow — never a fixed/sticky footer that could sit on top of the photo actions', () => {
    const scrollStart = composer.indexOf("<ScrollView\n            style={{ flex: 1 }}");
    // The outer content ScrollView wraps the poster carousel — an inner
    // ScrollView of its own — so its matching close is the LAST
    // `</ScrollView>` in the file, not the first one after `scrollStart`.
    const scrollEnd = composer.lastIndexOf('</ScrollView>') + '</ScrollView>'.length;
    expect(scrollStart).toBeGreaterThan(0);
    expect(scrollEnd).toBeGreaterThan(scrollStart + '</ScrollView>'.length);
    const scrollableContent = composer.slice(scrollStart, scrollEnd);

    expect(scrollableContent).toContain('<ShareToRow');
    const photoActionsIndex = scrollableContent.indexOf("resolvePhotoActionsMode(photo?.uri) === 'change'");
    const shareToRowIndex = scrollableContent.indexOf('<ShareToRow');
    expect(photoActionsIndex).toBeGreaterThan(-1);
    expect(photoActionsIndex).toBeLessThan(shareToRowIndex);
    // Nothing *visible* renders after the ScrollView closes but before the
    // modal ends — no separate footer sibling, no destination-picker modal.
    // The one exception is the hidden HD export stage: `position: absolute`
    // and off-screen, so it can never visually sit on top of the photo
    // actions or any other content — it just has to live outside the
    // scrollable area so swiping the carousel can't unmount it mid-capture.
    const afterScroll = composer.slice(scrollEnd, composer.indexOf('</SafeAreaView>')).trim();
    expect(afterScroll).toContain('{hdMountedPosterId ? (() => {');
    const withoutHdStageComment = afterScroll.replace(/\{\/\*[\s\S]*?\*\/\}\s*/, '').trim();
    expect(withoutHdStageComment.startsWith('{hdMountedPosterId ? (() => {')).toBe(true);
    expect(withoutHdStageComment.endsWith('})() : null}')).toBe(true);
    expect(composer).not.toContain('<Modal\n        visible={shareModalVisible}');
  });

  it('removed the destination-picker modal — every destination shares directly from the inline row, no intermediate choice screen', () => {
    expect(composer).not.toContain('shareModalVisible');
    expect(composer).not.toContain('setShareModalVisible');
    expect(composer).not.toContain('destinationHint');
    expect(composer).not.toContain('<CtaButton');
    expect(composer).toContain("import { ShareToRow } from './ShareToRow'");
    expect(composer).toContain('<ShareToRow');
    expect(composer).toContain('disabled={busy || previewWidth === 0}');
    expect(composer).toContain("onSelect={(id) => { void share(id); }}");
  });

  it('the share callback accepts any registry destination and forwards it straight to the controller', () => {
    const shareBody = composer.slice(
      composer.indexOf('const share = useCallback'),
      composer.indexOf('}, [busy, controller, posterRefs, selectedPoster, t]);'),
    );
    expect(composer).toContain("import { createWorkoutShareController, type WorkoutShareDestination } from '../../workoutShare/share'");
    expect(shareBody).toContain('async (destination: WorkoutShareDestination)');
    expect(shareBody).toContain('controller.share(uri, destination)');
    expect(shareBody).not.toMatch(/destination\s*===\s*['"]/);
  });

  it('measures safe-area insets inside the native modal without changing any poster', () => {
    const modalStart = composer.indexOf('<Modal visible');
    const modalEnd = composer.indexOf('</Modal>', modalStart);
    const modal = composer.slice(modalStart, modalEnd);
    expect(modal).toContain('<SafeAreaProvider style={{ flex: 1 }}>');
    expect(modal).toContain("edges={['top', 'right', 'bottom', 'left']}");
    expect(modal.indexOf('<SafeAreaProvider')).toBeLessThan(modal.indexOf('<SafeAreaView'));

    for (const source of Object.values(posterSources)) {
      expect(source).not.toContain('SafeAreaProvider');
      expect(source).not.toContain('SafeAreaView');
    }
  });

  it('the header close button is the composer\'s only "back/exit" control', () => {
    expect(composer).toContain("accessibilityLabel={t('done.shareComposer.close')}");
    expect(composer).toContain('onPress={finish}');
    expect(composer).not.toContain("t('done.backHome')");
  });

  it('does not add any finalization or cardio side effect to the composer', () => {
    expect(composer).not.toContain('finalizeWorkoutSession');
    expect(composer).not.toContain('onSessionCompleted');
    expect(composer).not.toContain('restLiveActivity');
    expect(composer).not.toContain('onCardioCompleted');
  });

  it('switching layouts never touches the photo or the WorkoutShareData prop', () => {
    expect(composer).not.toContain('setData(');
    expect(composer).not.toContain('data.workoutName =');
    // The scroll-driven selection handler only ever calls `setSelectedIndex`.
    const handlerSource = composer.slice(
      composer.indexOf('const updateSelectedIndexFromOffset'),
      composer.indexOf('const scrollToIndex'),
    );
    expect(handlerSource).not.toContain('setPhoto');
    expect(handlerSource).not.toContain('discardWorkoutSharePhoto');
  });

  it('renders every poster with the same 4-field WorkoutShareData plus the audited bodyMap field, and invents no other metric', () => {
    for (const [name, source] of Object.entries(posterSources)) {
      expect(source, name).toContain('data.workoutName');
      expect(source, name).toContain('data.exerciseCount');
      expect(source, name).toContain('data.completedSetCount');
      expect(source, name).toContain('data.durationSeconds');
      for (const forbidden of ['volume', 'calor', 'recorde', 'newPr', ' PR ', 'personalRecord']) {
        expect(source.toLowerCase(), `${name} must not invent "${forbidden}"`).not.toContain(forbidden.toLowerCase());
      }
    }
    // BodyMap and the Feed Post (Creative) design both show the real body
    // map — every other layout must not touch `bodyMap` at all.
    const bodyMapAware = ['PosterBodyMap', 'PosterCreative'];
    for (const name of bodyMapAware) {
      expect(posterSources[name], name).toContain('data.bodyMap');
    }
    for (const [name, source] of Object.entries(posterSources)) {
      if (bodyMapAware.includes(name)) continue;
      expect(source, name).not.toContain('data.bodyMap');
    }
  });

  it('uses the app blue, never green, for the Performance completion label', () => {
    const performance = posterSources.PosterPerformance;
    expect(performance).toContain('color: theme.colors.primaryEmphasis');
    expect(performance).not.toContain("#7FE0A8");
  });

  it('every body-map-aware layout reuses the existing BodyMuscleMap component and never fabricates muscles when none resolve', () => {
    for (const name of ['PosterBodyMap', 'PosterCreative']) {
      const source = posterSources[name];
      expect(source, name).toContain("from '../../fitness/BodyMuscleMap'");
      expect(source, name).toContain('primaryMuscles={data.bodyMap.primary}');
      expect(source, name).toContain('secondaryMuscles={data.bodyMap.secondary}');
      expect(source, name).toContain('data.bodyMap.primary.length > 0');
    }
  });

  it('the Feed Post design shows the real signed-in user — avatar and name from useAuth/ProfileAvatar, never a fabricated identity', () => {
    const creative = posterSources.PosterCreative;
    expect(creative).toContain("from '../../../state/AuthContext'");
    expect(creative).toContain('const { user, profile } = useAuth()');
    expect(creative).toContain('<ProfileAvatar');
    expect(creative).toContain('photoURL={profile?.profile.photoURL}');
    expect(creative).toContain('getDisplayFirstName({');
    expect(creative).toContain('profileName: profile?.profile.name');
    expect(creative).toContain('authDisplayName: user?.displayName');
    expect(creative).toContain('{displayName}');
    expect(creative).toContain("t('done.shareComposer.postTimestamp'");
    expect(creative).toContain('new Date()');
  });

  it('highlights the Feed Post BodyMap in the same color Home uses for its own body map', () => {
    const creative = posterSources.PosterCreative;
    expect(creative).toContain('activeColor={theme.colors.primaryEmphasis}');
    // Home's own BodyMuscleMap uses this exact same token (`TODAY_WORKOUT_THEME.colors.primaryEmphasis`, darkTheme).
    const home = readFileSync(new URL('../HomeScreen.tsx', import.meta.url), 'utf8');
    expect(home).toContain('activeColor={TODAY_WORKOUT_THEME.colors.primaryEmphasis}');
  });

  it('gives the BodyMap panel an even 50/50 split with the info column above it', () => {
    const creative = posterSources.PosterCreative;
    expect(creative).toContain('const topHeight = hasBodyMap ? height / 2 : height');
    expect(creative).toContain('const bodyMapHeight = height - topHeight');
    expect(creative).toContain('height: topHeight');
    expect(creative).toContain('height: bodyMapHeight');
  });

  it('shows the same hollow "AJ" watermark ProfileScreen uses, top-right and semi-opaque', () => {
    const creative = posterSources.PosterCreative;
    const profile = readFileSync(new URL('../ProfileScreen.tsx', import.meta.url), 'utf8');
    expect(creative).toContain("from '../../ui/OutlineNumber'");
    expect(creative).toContain('<OutlineNumber');
    expect(creative).toMatch(/<OutlineNumber[\s\S]*?>\s*AJ\s*<\/OutlineNumber>/);
    expect(creative).toMatch(/opacity:\s*0\.35/);
    // Same component/recipe ProfileScreen's own header watermark uses.
    expect(profile).toContain('<OutlineNumber');
    expect(profile).toContain('opacity: 0.35');
  });

  it('closes the BodyMap panel with the white AJ Fit mark + wordmark', () => {
    const creative = posterSources.PosterCreative;
    expect(creative).toContain('useAjLogoWhiteSource()');
    expect(creative).toContain('tintColor="#FFFFFF"');
    expect(creative).toContain('AJ Fit App');
  });

  it('veils the BodyMap panel gym artwork with a near-opaque blue layer', () => {
    const creative = posterSources.PosterCreative;
    expect(creative).toMatch(/rgba\(2,\s?32,\s?88,\s?0\.92\)/);
  });

  it('Social Feed shows the real signed-in user — avatar and name from useAuth/ProfileAvatar, never a fabricated identity', () => {
    const social = posterSources.PosterSocial;
    expect(social).toContain("from '../../../state/AuthContext'");
    expect(social).toContain('const { user, profile } = useAuth()');
    expect(social).toContain('<ProfileAvatar');
    expect(social).toContain('photoURL={profile?.profile.photoURL}');
    expect(social).toContain('getDisplayFirstName({');
    expect(social).toContain('{displayName}');
    expect(social).toContain("t('done.shareComposer.postTimestamp'");
    expect(social).toContain('new Date()');
  });

  it('Social Feed\'s headline uses the real workout name, never an invented one', () => {
    const social = posterSources.PosterSocial;
    expect(social).toContain("t('done.shareComposer.postCompletedTitle', { name: data.workoutName })");
  });

  it('Social Feed shows the shared, user-picked photo in a bounded card (its own flex:1 slot) — repositionable, but not full-screen', () => {
    const social = posterSources.PosterSocial;
    expect(social).toContain("from './PosterPhoto'");
    expect(social).toContain('const [photoBoxHeight, setPhotoBoxHeight] = useState(0)');
    expect(social).toContain('onLayout={(event) => setPhotoBoxHeight(Math.round(event.nativeEvent.layout.height))}');
    expect(social).toMatch(/<PosterPhoto[\s\S]*?height=\{photoBoxHeight\}/);
    // Falls back to a gradient card, never a stock image, when no photo was picked.
    expect(social).not.toContain('gym.png');
    expect(social).toContain('photo ?');
  });

  it('Social Feed\'s like/comment/share row is purely decorative — no fabricated counts', () => {
    const social = posterSources.PosterSocial;
    expect(social).toContain('<Icon name="heart" size={20 * scale} color={theme.colors.danger} filled />');
    expect(icon).toContain("fill={filled ? color : 'none'}");
    expect(social).toContain('name="message"');
    expect(social).toContain('name="share"');
    // No numeric like/comment count anywhere near that row.
    expect(social).not.toMatch(/likes?Count|commentsCount|shareCount/i);
  });

  it('Social Feed closes with the same white AJ Fit wordmark the Feed Post design uses', () => {
    const social = posterSources.PosterSocial;
    expect(social).toContain('useAjLogoWhiteSource()');
    expect(social).toContain('tintColor="#FFFFFF"');
    expect(social).toContain('AJ Fit App');
  });

  it('bumps the AJ Fit logo bigger than the original single-poster size on every design that shows it', () => {
    // Feed Post (Creative) and Social Feed both show the real user's own
    // avatar as the primary identity mark, with only a small closing
    // wordmark logo — see the dedicated tests for both.
    const smallFooterLogoDesigns = ['PosterCreative', 'PosterSocial'];
    for (const [name, source] of Object.entries(posterSources)) {
      if (smallFooterLogoDesigns.includes(name)) continue;
      const sizeMatches = [...source.matchAll(/source=\{logoSource\}[\s\S]{0,220}?width:\s*(\d+(?:\.\d+)?)\s*\*\s*scale/g)];
      expect(sizeMatches.length, `${name} must render the AJ Fit logo`).toBeGreaterThan(0);
      for (const match of sizeMatches) {
        expect(Number(match[1]), name).toBeGreaterThan(ORIGINAL_LOGO_SCALE_FACTOR);
      }
    }
  });

  it('every poster works without a user-selected photo', () => {
    for (const [name, source] of Object.entries(posterSources)) {
      if (name === 'PosterCreative') {
        expect(source).toContain('useWorkoutShareGymArtSource()');
        continue;
      }
      expect(source, name).toMatch(/photo \?/);
    }
  });

  it('uses the supported public Instagram Stories mechanisms', () => {
    expect(nativeAndroid).toContain('com.instagram.share.ADD_TO_STORY');
    expect(nativeAndroid).toContain('FLAG_GRANT_READ_URI_PERMISSION');
    expect(nativeAndroid).toContain('putExtra("source_application", metaAppId)');
    expect(nativeAndroid).toContain('setDataAndType(contentUri, JPEG_MIME)');
    expect(nativeIos).toContain('instagram-stories://share');
    expect(nativeIos).toContain('URLQueryItem(name: "source_application", value: metaAppID)');
    expect(nativeIos).toContain('com.instagram.sharedSticker.backgroundImage');
    expect(nativeIos.indexOf('UIPasteboard.general.setItems')).toBeLessThan(
      nativeIos.indexOf('openStoriesURL(urlScheme)'),
    );
    expect(nativeIos).toContain('expirationDate: Date().addingTimeInterval');
  });

  it('exposes a FOTO/ARTE segmented control that drives which carousel renders, and never regresses the FOTO JSX', () => {
    expect(composer).toContain('function ModeSegmentedControl');
    expect(composer).toContain("mode === 'photo'");
    expect(composer).toContain("const [mode, setMode] = useState<ShareMode>('photo')");
    // The FOTO branch keeps every pre-existing invariant: carousel, photo
    // actions, and the inline ShareToRow destinations.
    expect(composer).toContain('<ShareToRow');
    expect(composer).toContain("resolvePhotoActionsMode(photo?.uri) === 'change'");
  });

  it('renders 4 ARTE designs from one registry, mapped without scattered conditionals', () => {
    expect(artRegistry).toContain('ArtPosterMinimal');
    expect(artRegistry).toContain('ArtPosterPerformance');
    expect(artRegistry).toContain('ArtPosterPr');
    expect(artRegistry).toContain('ArtPosterStats');
    expect(artRegistry).not.toMatch(/if\s*\(.*id\s*===/);
  });

  it('filters the ARTE carousel to only the layouts available for this workout (artPr gated on a personal record)', () => {
    expect(composer).toContain('const availableArtPosters = useMemo(');
    expect(composer).toContain('isWorkoutShareArtLayoutAvailable(poster.id, summaryData)');
  });

  it('every ARTE poster leaves its root (ref\'d) View fully transparent — no backgroundColor on that exact tag', () => {
    // Decorative accent elements further down the tree (e.g. a thin
    // primaryEmphasis rule) legitimately use `backgroundColor` — only the
    // one `View` carrying `ref={posterRef}` (what view-shot actually
    // captures) must never set it.
    for (const [name, source] of Object.entries(artPosterSources)) {
      const rootTagMatch = source.match(/<View[^>]*ref=\{posterRef\}[^>]*>/s);
      expect(rootTagMatch, `${name} must render a View with ref={posterRef}`).not.toBeNull();
      expect(rootTagMatch![0], name).not.toContain('backgroundColor');
      expect(source, name).toContain('testID="workout-share-art-poster"');
    }
  });

  it('captures the HD export from a dedicated off-screen stage — never the small on-screen preview instance', () => {
    const captureBody = composer.slice(
      composer.indexOf('const captureSelectedArt = useCallback('),
      composer.indexOf('const copyArt = useCallback'),
    );
    expect(captureBody).toContain('captureWorkoutShareArt(hdPosterRef,');
    expect(captureBody).toContain('width: poster.exportWidth');
    expect(captureBody).toContain('height: poster.exportHeight');
    // Never captures `artPosterRefs` (the small, swipeable on-screen
    // preview) — that ref only ever backs the visible carousel now.
    expect(captureBody).not.toContain('artPosterRefs[');
  });

  it('lays the hidden HD stage out at workoutShareArtRenderSize, not the on-screen preview size, before capturing it', () => {
    expect(composer).toContain("import { captureWorkoutShareArt, workoutShareArtRenderSize } from '../../workoutShare/exportArt'");
    const hdStage = composer.slice(composer.indexOf('{hdMountedPosterId ? (() => {'), composer.indexOf('})() : null}'));
    expect(hdStage).toContain('workoutShareArtRenderSize(hdPoster.exportWidth, hdPoster.exportHeight)');
    expect(hdStage).toContain('width={hdSize.width}');
    expect(hdStage).toContain('height={hdSize.height}');
    expect(hdStage).toContain('posterRef={hdPosterRef}');
    // Never visually hidden via opacity — some native capture paths render
    // the view's current presentation state, so an opacity:0 view would
    // capture blank. It's hidden by position only.
    expect(hdStage).not.toMatch(/opacity:\s*0\b/);
    expect(hdStage).toContain("position: 'absolute'");
  });

  it('waits for the hidden HD stage\'s first layout before capturing it — never captures a not-yet-laid-out view', () => {
    const captureBody = composer.slice(
      composer.indexOf('const captureSelectedArt = useCallback('),
      composer.indexOf('const copyArt = useCallback'),
    );
    expect(captureBody).toContain('const layoutPromise = new Promise<void>((resolve) => {');
    expect(captureBody).toContain('hdLayoutResolveRef.current = resolve;');
    expect(captureBody).toContain('setHdMountedPosterId(poster.id);');
    expect(captureBody).toContain('await layoutPromise;');
    // Unmounted again once captured — the stage never stays mounted between actions.
    expect(captureBody).toContain('setHdMountedPosterId(null);');
  });

  it('caches the generated HD PNG by template + data, so copy/save on the same art reuse one file instead of re-rendering', () => {
    const captureBody = composer.slice(
      composer.indexOf('const captureSelectedArt = useCallback('),
      composer.indexOf('const copyArt = useCallback'),
    );
    expect(captureBody).toContain('cached.posterId === poster.id && cached.shareData === data && cached.summaryData === summaryData');
    expect(captureBody).toContain("hdCacheRef.current = { posterId: poster.id, shareData: data, summaryData, uri };");
    // Every action calls through captureSelectedArt — neither of them capture directly.
    const copyBody = composer.slice(composer.indexOf('const copyArt = useCallback'), composer.indexOf('const saveArt = useCallback'));
    const saveBody = composer.slice(composer.indexOf('const saveArt = useCallback'), composer.indexOf('const onPreviewLayout'));
    for (const body of [copyBody, saveBody]) {
      expect(body).toContain('await captureSelectedArt();');
      // Neither action discards the file itself anymore — it's a shared
      // cache entry, only ever discarded on invalidation/unmount.
      expect(body).not.toContain('discardWorkoutShareFile(uri)');
    }
  });

  it('invalidates the cached HD export when the template changes, and cleans it up when the composer unmounts', () => {
    expect(composer).toMatch(/useEffect\(\(\) => \{\s*const cached = hdCacheRef\.current;\s*if \(cached && cached\.posterId !== selectedArtPoster\?\.id\) \{\s*discardWorkoutShareFile\(cached\.uri\);\s*hdCacheRef\.current = null;\s*\}\s*\}, \[selectedArtPoster\?\.id\]\);/);
    expect(composer).toMatch(/useEffect\(\(\) => \(\) => \{\s*if \(hdCacheRef\.current\) discardWorkoutShareFile\(hdCacheRef\.current\.uri\);\s*\}, \[\]\);/);
  });

  it('logs workout_share_art_generated with the real export dimensions, pixel ratio and file size — not just the layout id', () => {
    const captureBody = composer.slice(
      composer.indexOf('const captureSelectedArt = useCallback('),
      composer.indexOf('const copyArt = useCallback'),
    );
    expect(captureBody).toContain("logInfo('workout_share', 'workout_share_art_generated', {");
    expect(captureBody).toContain('width: poster.exportWidth,');
    expect(captureBody).toContain('height: poster.exportHeight,');
    expect(captureBody).toContain('pixelRatio,');
    expect(captureBody).toContain('fileSize,');
    expect(captureBody).toContain("new File(uri).size");
  });

  it('offers only Copiar arte / Salvar PNG as the ARTE actions — no separate "Compartilhar" button', () => {
    expect(composer).toContain("t('done.shareComposer.artActions.copy')");
    expect(composer).toContain("t('done.shareComposer.artActions.save')");
    expect(composer).toContain('icon="copy"');
    expect(composer).toContain('onPress={() => { void copyArt(); }}');
    expect(composer).toContain('onPress={() => { void saveArt(); }}');
    expect(composer).not.toContain('artActions.share');
    expect(composer).not.toContain('shareArt');
  });

  it('renders the preview-only checkerboard as a plain sibling of the ARTE poster component — it never takes/forwards a ref, so it can never become part of what view-shot captures', () => {
    expect(checkerboard).not.toMatch(/\bref=\{/);
    // The checkerboard call site in the composer sits before the poster
    // component in the same page wrapper — a preceding sibling, not a parent.
    const pageWrapperStart = composer.indexOf('<ArtPreviewCheckerboard');
    const posterComponentStart = composer.indexOf('<ArtPosterComponent');
    expect(pageWrapperStart).toBeGreaterThan(-1);
    expect(pageWrapperStart).toBeLessThan(posterComponentStart);
  });

  it('windows ARTE poster rendering to the selected page and its neighbors, so swiping stays cheap', () => {
    expect(composer).toContain('Math.abs(index - selectedArtIndex) <= 1');
  });

  it('every ARTE poster uses the already-computed shareData/summaryData — no second data pipeline', () => {
    for (const [name, source] of Object.entries(artPosterSources)) {
      expect(source, name).toMatch(/shareData|summaryData/);
    }
    expect(artPosterSources.ArtPosterPr).toContain('summaryData.personalRecords');
    expect(artPosterSources.ArtPosterPerformance).toContain('summaryData.volumeKg');
  });

  it('auto-dismisses the "Arte copiada"/"PNG salvo" confirmation after 3s, without a stray timer wiping a later, unrelated message', () => {
    expect(composer).toContain('const MESSAGE_AUTO_DISMISS_MS = 3_000;');
    expect(composer).toContain('const showAutoDismissingMessage = useCallback(');
    // Only the two terminal success toasts auto-dismiss — loading/error
    // states still use the plain, non-expiring `setMessage`.
    expect(composer).toContain("showAutoDismissingMessage(t('done.shareComposer.artCopied'))");
    expect(composer).toContain("showAutoDismissingMessage(t('done.shareComposer.artSaved'))");
    expect(composer).not.toContain("showAutoDismissingMessage(t('done.shareComposer.generating'))");
    expect(composer).not.toContain("showAutoDismissingMessage(t('done.shareComposer.artCopyFailed'))");
    expect(composer).not.toContain("showAutoDismissingMessage(t('done.shareComposer.artSaveFailed'))");
    // `setMessage` itself is the one choke point that cancels any pending
    // dismiss timer — every other call site (FOTO or ARTE, success or
    // error) goes through it and is therefore automatically protected.
    const setMessageBody = composer.slice(
      composer.indexOf('const setMessage = useCallback('),
      composer.indexOf('const showAutoDismissingMessage = useCallback('),
    );
    expect(setMessageBody).toContain('clearTimeout(messageDismissTimeoutRef.current)');
    expect(setMessageBody).toContain('setMessageState(text)');
    // The pending timer is also cleared on unmount, never left running
    // against an unmounted component.
    expect(composer).toMatch(/useEffect\(\(\) => \(\) => \{\s*if \(messageDismissTimeoutRef\.current\) clearTimeout\(messageDismissTimeoutRef\.current\);\s*\}, \[\]\);/);
  });
});
