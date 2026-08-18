import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { CtaButton } from '../ui/CtaButton';
import { Icon } from '../ui/Icon';
import { Display, MonoLabel, Slash } from '../ui/Display';
import {
  PHOTO_COMPARE_POSTER_ASPECT_RATIO,
  PhotoComparePoster,
} from './PhotoComparePoster';
import { colors, fonts, sizes, spacing } from '../../theme/tokens';
import type {
  GalleryPhoto,
  GalleryThumbnailOwner,
} from '../../lib/photoVaultGallery';
import {
  comparisonCandidatesFor,
  comparisonElapsedDays,
  comparisonGroupOf,
  comparisonStartCandidates,
  normalizeBeforeAfter,
  type ComparisonGroup,
} from '../../lib/photoVaultCompare';
import {
  discardPhotoVaultComparison,
  getPhotoVaultCompareState,
  loadPhotoVaultComparison,
  markPhotoVaultComparePreviewReady,
  retryPhotoVaultComparison,
  subscribeToPhotoVaultCompare,
  type PhotoVaultCompareState,
} from '../../lib/photoVaultCompareController';
import {
  capturePhotoVaultComparison,
  discardPhotoVaultComparisonExport,
  getPhotoVaultCompareExportState,
  subscribeToPhotoVaultCompareExport,
  type PhotoVaultCompareExportState,
} from '../../lib/photoVaultCompareExport';
import {
  discardPhotoVaultComparisonShare,
  getPhotoVaultCompareShareState,
  sharePhotoVaultComparison,
  subscribeToPhotoVaultCompareShare,
  type PhotoVaultCompareShareState,
} from '../../lib/photoVaultCompareShare';

/**
 * Picks the two photos a progress comparison is built from.
 *
 * Selection uses only gallery-owned thumbnails. The review CTA then hands the
 * ordered pair to a dedicated full-image controller and renders its two
 * temporary URIs in a normal React Native View. The explicit share action
 * captures the branded poster into this comparator session's temporary file
 * and immediately hands it to the native share sheet; opening the preview
 * itself creates no composed plaintext.
 *
 * Owns its own selection state, so the host screen only has to open it, hand
 * over the photos it already has, and be told when it closes. The selection is
 * ephemeral by construction — it lives in this component and dies with it,
 * which is also what makes a lock safe (see `visible` below).
 */

interface Props {
  visible: boolean;
  /** The gallery as the controller currently knows it. */
  photos: GalleryPhoto[];
  /** Asks the controller to fetch and decrypt a thumbnail that scrolled in. */
  onVisible: (photoId: string) => GalleryThumbnailOwner;
  /** Gives up this surface's claim on a thumbnail. */
  onHidden: (owner: GalleryThumbnailOwner) => void;
  onClose: () => void;
  formatDate: (date: Date) => string;
}

const CELL_HEIGHT = 170;

/** A selectable thumbnail. Deliberately not `PhotoVaultDayRow`'s cell: that one
 * carries the day-grid's own concerns, and threading selection state through
 * it would add a mode to a component used everywhere else. */
function CompareCell({
  photo,
  label,
  selected,
  selectionLabel,
  onVisible,
  onHidden,
  onPress,
}: {
  photo: GalleryPhoto;
  label: string;
  selected: boolean;
  selectionLabel: string | null;
  onVisible: (photoId: string) => GalleryThumbnailOwner;
  onHidden: (owner: GalleryThumbnailOwner) => void;
  onPress: () => void;
}) {
  /**
   * Announcing visibility is what queues the decrypt, so scrolling drives the
   * work instead of the screen fetching the whole gallery at once.
   *
   * Releasing here is safe because the controller counts owners rather than
   * tracking a single visible set. The gallery grid stays mounted beneath
   * this modal and holds its own claim on the same photos, so letting go of
   * one cell cannot cancel a decrypt the grid is still waiting on.
   */
  useEffect(() => {
    const owner = onVisible(photo.photoId);
    return () => onHidden(owner);
  }, [photo.photoId, onVisible, onHidden]);

  const uri = photo.thumbnailUri;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={{
        flex: 1,
        height: CELL_HEIGHT,
        borderRadius: 12,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface,
        borderWidth: selected ? 2 : sizes.hairline,
        borderColor: selected ? colors.accent : colors.border,
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          resizeMode="cover"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : photo.thumbnailLoading ? (
        <View
          testID="photo-vault-compare-skeleton"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.surfaceRaised,
          }}
        />
      ) : (
        <Icon name="camera" size={20} color={colors.faint} />
      )}

      {selectionLabel ? (
        <View
          style={{
            position: 'absolute',
            top: spacing[2],
            left: spacing[2],
            paddingHorizontal: spacing[2],
            paddingVertical: spacing[1],
            borderRadius: 6,
            backgroundColor: colors.accent,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontFamily: fonts.mono,
              fontSize: 8.5,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}
          >
            {selectionLabel}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const MemoCompareCell = memo(CompareCell);

export function PhotoCompareScreen({
  visible,
  photos,
  onVisible,
  onHidden,
  onClose,
  formatDate,
}: Props) {
  const { t } = useTranslation('home');
  const [first, setFirst] = useState<GalleryPhoto | null>(null);
  const [second, setSecond] = useState<GalleryPhoto | null>(null);
  const [previewStarted, setPreviewStarted] = useState(false);
  const [fullState, setFullState] = useState<PhotoVaultCompareState>(
    getPhotoVaultCompareState,
  );

  useEffect(() => subscribeToPhotoVaultCompare(setFullState), []);

  // A parent navigation unmount can bypass Modal's close callback.
  useEffect(
    () => () => {
      discardPhotoVaultComparisonShare();
      discardPhotoVaultComparisonExport();
      discardPhotoVaultComparison();
    },
    [],
  );

  // Opening always starts a clean selection. Closing — for any reason,
  // including the vault locking underneath — leaves nothing behind: the
  // selection is component state, so it dies with the unmount.
  useEffect(() => {
    if (!visible) {
      discardPhotoVaultComparisonShare();
      discardPhotoVaultComparisonExport();
      discardPhotoVaultComparison();
      setPreviewStarted(false);
      setFirst(null);
      setSecond(null);
    }
  }, [visible]);

  /**
   * A selected photo can disappear underneath the screen: a delete, a lock
   * clearing the gallery, or an account switch replacing it. Dropping the
   * stale reference keeps the review step from showing a photo that no longer
   * exists.
   */
  useEffect(() => {
    const currentVersion = (photo: GalleryPhoto | null) =>
      photo === null
        ? null
        : (photos.find(
            (entry) =>
              entry.photoId === photo.photoId && entry.assetId === photo.assetId,
          ) ?? null);
    const currentFirst = currentVersion(first);
    const currentSecond = currentVersion(second);
    if (first && !currentFirst) {
      discardPhotoVaultComparisonShare();
      discardPhotoVaultComparisonExport();
      discardPhotoVaultComparison();
      setPreviewStarted(false);
      setFirst(null);
      setSecond(null);
    } else if (second && !currentSecond) {
      discardPhotoVaultComparisonShare();
      discardPhotoVaultComparisonExport();
      discardPhotoVaultComparison();
      setPreviewStarted(false);
      setSecond(null);
    } else {
      // Gallery patches replace the changed entry object. Follow that current
      // object so a thumbnail that finishes after selection appears in review.
      if (first && currentFirst !== first) setFirst(currentFirst);
      if (second && currentSecond !== second) setSecond(currentSecond);
    }
  }, [photos, first, second]);

  const poseLabels: Record<ComparisonGroup, string> = {
    front: t('progress.photos.poses.front'),
    side: t('progress.photos.poses.side'),
    back: t('progress.photos.poses.back'),
    unclassified: t('progress.photos.compare.unclassified'),
  };

  // Step 1 offers only photos that actually have a partner; step 2 narrows to
  // the first pick's own group. Both are derived from the same in-memory list
  // — no query, no refetch, no new decrypt.
  const options = useMemo(() => {
    if (!first) return comparisonStartCandidates(photos);
    return comparisonCandidatesFor(first, photos);
  }, [first, photos]);

  const pair = useMemo(() => {
    if (!first || !second) return null;
    const result = normalizeBeforeAfter(first, second);
    return result.ok ? result : null;
  }, [first, second]);

  // The review is a second thumbnail surface after the virtualised cells
  // unmount. Hold one balanced claim for each selected image while that review
  // is visible, then release both before the full-image preview takes over.
  useEffect(() => {
    if (!visible || !pair || previewStarted) return undefined;
    const beforeOwner = onVisible(pair.before.photoId);
    const afterOwner = onVisible(pair.after.photoId);
    return () => {
      onHidden(beforeOwner);
      onHidden(afterOwner);
    };
  }, [onHidden, onVisible, pair, previewStarted, visible]);

  const handleSelect = useCallback(
    (photo: GalleryPhoto) => {
      if (!first) {
        setFirst(photo);
        return;
      }
      setSecond(photo);
    },
    [first],
  );

  const handleBack = useCallback(() => {
    // Preview goes back to its thumbnail review and releases both full files.
    if (previewStarted) {
      discardPhotoVaultComparisonShare();
      discardPhotoVaultComparisonExport();
      discardPhotoVaultComparison();
      setPreviewStarted(false);
      return;
    }
    // Step 2 goes back to step 1; step 1 closes the comparator.
    if (second) {
      setSecond(null);
      return;
    }
    if (first) {
      setFirst(null);
      return;
    }
    discardPhotoVaultComparisonShare();
    discardPhotoVaultComparisonExport();
    discardPhotoVaultComparison();
    onClose();
  }, [first, second, onClose, previewStarted]);

  const handleClose = useCallback(() => {
    discardPhotoVaultComparisonShare();
    discardPhotoVaultComparisonExport();
    discardPhotoVaultComparison();
    setPreviewStarted(false);
    onClose();
  }, [onClose]);

  const handleContinue = useCallback(() => {
    if (!pair) return;
    setPreviewStarted(true);
    void loadPhotoVaultComparison({ before: pair.before, after: pair.after });
  }, [pair]);

  const reviewing = pair !== null;
  const stepLabel = first
    ? t('progress.photos.compare.stepAfter')
    : t('progress.photos.compare.stepBefore');
  const stepTitle = first
    ? t('progress.photos.compare.chooseAfter')
    : t('progress.photos.compare.chooseBefore');

  const header = (
    <View style={{ paddingHorizontal: sizes.screenGutter, paddingBottom: spacing[4] }}>
      {reviewing ? (
        <Slash style={{ marginBottom: spacing[3] }}>
          {t('progress.photos.compare.review').toUpperCase()}
        </Slash>
      ) : (
        <>
          <MonoLabel color={colors.accentHi}>{stepLabel.toUpperCase()}</MonoLabel>
          <Text
            style={{
              color: colors.text,
              fontFamily: fonts.uiSemi,
              fontSize: 15,
              marginTop: spacing[2],
            }}
          >
            {stepTitle}
          </Text>
        </>
      )}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={handleBack}>
      {/* A native Modal has its own root view, so it needs its own provider
          for the inset to be measured against that window — same reason the
          viewer does this. */}
      <SafeAreaProvider style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'right', 'bottom', 'left']}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: sizes.screenGutter,
                paddingTop: spacing[3],
                paddingBottom: spacing[4],
              }}
            >
              <Pressable
                onPress={handleBack}
                accessibilityRole="button"
                accessibilityLabel={t('progress.photos.compare.back')}
                hitSlop={12}
                style={{ padding: spacing[1.5] }}
              >
                <Icon name="arrow-left" size={20} color={colors.text} />
              </Pressable>
              <Display size={20}>
                {t('progress.photos.compare.title').toUpperCase()}
              </Display>
              <Pressable
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel={t('progress.photos.compare.cancel')}
                hitSlop={12}
                style={{ padding: spacing[1.5] }}
              >
                <Icon name="x" size={20} color={colors.mute} />
              </Pressable>
            </View>

            {previewStarted && pair ? (
              fullState.status === 'ready' &&
              fullState.beforeFullUri &&
              fullState.afterFullUri ? (
                <ComparisonPreview
                  before={pair.before}
                  after={pair.after}
                  beforeFullUri={fullState.beforeFullUri}
                  afterFullUri={fullState.afterFullUri}
                  poseLabel={poseLabels[comparisonGroupOf(pair.before)]}
                />
              ) : fullState.status === 'error' ? (
                <ComparisonLoadError
                  failedSide={fullState.failedSide}
                  onRetry={() => void retryPhotoVaultComparison()}
                />
              ) : (
                <ComparisonLoading loadedBefore={fullState.beforeFullUri !== null} />
              )
            ) : reviewing && pair ? (
              <ComparisonReview
                before={pair.before}
                after={pair.after}
                poseLabels={poseLabels}
                formatDate={formatDate}
                onChangeBefore={() => {
                  setFirst(null);
                  setSecond(null);
                }}
                onChangeAfter={() => setSecond(null)}
                onContinue={handleContinue}
              />
            ) : options.length === 0 && first ? (
              <NoCandidates
                onChooseAnother={() => setFirst(null)}
                poseLabel={poseLabels[comparisonGroupOf(first)]}
              />
            ) : (
              <FlatList
                testID="photo-vault-compare-list"
                data={options}
                numColumns={2}
                keyExtractor={(photo) => photo.photoId}
                ListHeaderComponent={header}
                columnWrapperStyle={{
                  paddingHorizontal: sizes.screenGutter,
                  gap: spacing[2.5],
                }}
                contentContainerStyle={{ paddingBottom: spacing[8], gap: spacing[2.5] }}
                initialNumToRender={6}
                maxToRenderPerBatch={4}
                updateCellsBatchingPeriod={50}
                windowSize={3}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                  const isFirst = first?.photoId === item.photoId;
                  return (
                    <MemoCompareCell
                      photo={item}
                      selected={isFirst}
                      selectionLabel={
                        isFirst ? t('progress.photos.compare.before').toUpperCase() : null
                      }
                      label={t('progress.photos.a11y.selectComparePhoto', {
                        pose: poseLabels[comparisonGroupOf(item)],
                        date: formatDate(item.takenAt),
                      })}
                      onVisible={onVisible}
                      onHidden={onHidden}
                      onPress={() => handleSelect(item)}
                    />
                  );
                }}
              />
            )}
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

/** The two chosen photos, already ordered by capture time. */
function ComparisonReview({
  before,
  after,
  poseLabels,
  formatDate,
  onChangeBefore,
  onChangeAfter,
  onContinue,
}: {
  before: GalleryPhoto;
  after: GalleryPhoto;
  poseLabels: Record<ComparisonGroup, string>;
  formatDate: (date: Date) => string;
  onChangeBefore: () => void;
  onChangeAfter: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation('home');

  const side = (
    photo: GalleryPhoto,
    caption: string,
    onChange: () => void,
    changeLabel: string,
  ) => (
    <View style={{ flex: 1, gap: spacing[2] }}>
      <View
        style={{
          height: 220,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: colors.surface,
          borderWidth: sizes.hairline,
          borderColor: colors.border,
        }}
      >
        {photo.thumbnailUri ? (
          <Image
            source={{ uri: photo.thumbnailUri }}
            resizeMode="cover"
            style={{ width: '100%', height: '100%' }}
          />
        ) : null}
      </View>
      <MonoLabel color={colors.accentHi}>{caption.toUpperCase()}</MonoLabel>
      <Text style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 12.5 }}>
        {formatDate(photo.takenAt)}
      </Text>
      <Pressable
        onPress={onChange}
        accessibilityRole="button"
        accessibilityLabel={changeLabel}
        hitSlop={8}
      >
        <MonoLabel size={9}>{t('progress.photos.compare.change').toUpperCase()}</MonoLabel>
      </Pressable>
    </View>
  );

  return (
    <View style={{ flex: 1, paddingHorizontal: sizes.screenGutter }}>
      <MonoLabel size={9} style={{ marginBottom: spacing[4] }}>
        {poseLabels[comparisonGroupOf(before)].toUpperCase()}
      </MonoLabel>

      <View style={{ flexDirection: 'row', gap: spacing[3] }}>
        {side(
          before,
          t('progress.photos.compare.before'),
          onChangeBefore,
          t('progress.photos.a11y.changeBefore'),
        )}
        {side(
          after,
          t('progress.photos.compare.after'),
          onChangeAfter,
          t('progress.photos.a11y.changeAfter'),
        )}
      </View>

      <View style={{ marginTop: 'auto', paddingBottom: spacing[5] }}>
        <CtaButton
          onPress={onContinue}
          accessibilityLabel={t('progress.photos.compare.continue')}
          style={{ alignSelf: 'stretch' }}
        >
          {t('progress.photos.compare.continue')}
        </CtaButton>
      </View>
    </View>
  );
}

function ComparisonLoading({ loadedBefore }: { loadedBefore: boolean }) {
  const { t } = useTranslation('home');
  return (
    <View
      testID="photo-vault-compare-loading"
      accessibilityLiveRegion="polite"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: sizes.screenGutter,
        gap: spacing[4],
      }}
    >
      <ActivityIndicator color={colors.accentHi} />
      <Slash>{t('progress.photos.compare.preview').toUpperCase()}</Slash>
      <Text
        style={{
          color: colors.mute,
          fontFamily: fonts.ui,
          fontSize: 14,
          lineHeight: 21,
          textAlign: 'center',
        }}
      >
        {t('progress.photos.compare.loading')}
      </Text>
      <MonoLabel size={9}>
        {t(
          loadedBefore
            ? 'progress.photos.compare.after'
            : 'progress.photos.compare.before',
        ).toUpperCase()}
      </MonoLabel>
    </View>
  );
}

function ComparisonLoadError({
  failedSide,
  onRetry,
}: {
  failedSide: PhotoVaultCompareState['failedSide'];
  onRetry: () => void;
}) {
  const { t } = useTranslation('home');
  return (
    <View
      testID="photo-vault-compare-load-error"
      accessibilityLiveRegion="assertive"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: sizes.screenGutter,
        gap: spacing[4],
      }}
    >
      <Icon name="alert-triangle" size={26} color={colors.warning} />
      {failedSide ? (
        <MonoLabel color={colors.accentHi}>
          {t(`progress.photos.compare.${failedSide}`).toUpperCase()}
        </MonoLabel>
      ) : null}
      <Text
        style={{
          color: colors.mute,
          fontFamily: fonts.ui,
          fontSize: 14,
          lineHeight: 21,
          textAlign: 'center',
        }}
      >
        {t('progress.photos.compare.loadFailed')}
      </Text>
      <CtaButton
        onPress={onRetry}
        accessibilityLabel={t('progress.photos.compare.retry')}
        style={{ alignSelf: 'stretch' }}
      >
        {t('progress.photos.compare.retry')}
      </CtaButton>
    </View>
  );
}

/**
 * Responsive 9:16 WYSIWYG poster. The dedicated ref ends at this opaque View:
 * navigation, status messages and CTA remain outside the captured tree.
 */
function ComparisonPreview({
  before,
  after,
  beforeFullUri,
  afterFullUri,
  poseLabel,
}: {
  before: GalleryPhoto;
  after: GalleryPhoto;
  beforeFullUri: string;
  afterFullUri: string;
  poseLabel: string;
}) {
  const { t, i18n } = useTranslation('home');
  const { width, height } = useWindowDimensions();
  const posterRef = useRef<View>(null);
  const [beforeRendered, setBeforeRendered] = useState(false);
  const [afterRendered, setAfterRendered] = useState(false);
  const [posterLaidOut, setPosterLaidOut] = useState(false);
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [logoReady, setLogoReady] = useState(false);
  const [exportState, setExportState] = useState<PhotoVaultCompareExportState>(
    getPhotoVaultCompareExportState,
  );
  const [shareState, setShareState] = useState<PhotoVaultCompareShareState>(
    getPhotoVaultCompareShareState,
  );

  useEffect(() => {
    const unsubscribeExport = subscribeToPhotoVaultCompareExport(setExportState);
    const unsubscribeShare = subscribeToPhotoVaultCompareShare(setShareState);
    return () => {
      unsubscribeShare();
      unsubscribeExport();
      discardPhotoVaultComparisonShare();
      discardPhotoVaultComparisonExport();
    };
  }, []);

  useEffect(() => {
    setBeforeRendered(false);
    setAfterRendered(false);
    setPosterLaidOut(false);
    setBackgroundReady(false);
    setLogoReady(false);
    discardPhotoVaultComparisonShare();
    discardPhotoVaultComparisonExport();
  }, [beforeFullUri, afterFullUri]);

  useEffect(() => {
    if (beforeRendered && afterRendered) markPhotoVaultComparePreviewReady();
  }, [afterRendered, beforeRendered]);

  const availableWidth = Math.max(
    220,
    Math.min(420, width - sizes.screenGutter * 2),
  );
  const availableHeight = Math.max(320, height - 190);
  const minimumPreviewWidth = Math.min(240, availableWidth);
  const heightFittedWidth =
    availableHeight * PHOTO_COMPARE_POSTER_ASPECT_RATIO;
  const posterWidth = Math.min(
    availableWidth,
    Math.max(minimumPreviewWidth, heightFittedWidth),
  );
  const posterHeight = posterWidth / PHOTO_COMPARE_POSTER_ASPECT_RATIO;
  const posterReady =
    posterLaidOut &&
    beforeRendered &&
    afterRendered &&
    backgroundReady &&
    logoReady;

  const handlePosterAction = useCallback(async () => {
    discardPhotoVaultComparisonShare();
    const nextExportState =
      exportState.status === 'ready' && exportState.exportUri
        ? exportState
        : await capturePhotoVaultComparison({
            posterRef,
            posterReady,
            logoReady,
            beforeFullUri,
            afterFullUri,
          });

    if (nextExportState.status === 'ready' && nextExportState.exportUri) {
      await sharePhotoVaultComparison();
    }
  }, [
    afterFullUri,
    beforeFullUri,
    exportState.exportUri,
    exportState.status,
    logoReady,
    posterReady,
  ]);

  const ctaLabel =
    shareState.status === 'sharing'
      ? t('progress.photos.compare.sharing')
      : exportState.status === 'capturing'
        ? t('progress.photos.compare.sharing')
        : exportState.status === 'error'
          ? t('progress.photos.compare.retry')
          : t('progress.photos.compare.share');

  const actionBusy =
    exportState.status === 'capturing' || shareState.status === 'sharing';
  const shareErrorMessage =
    shareState.issue === 'compareShareUnavailable'
      ? t('progress.photos.compare.shareUnavailable')
      : shareState.issue === 'compareShareFailed'
        ? t('progress.photos.compare.shareFailed')
        : null;

  const posterLocale = i18n.resolvedLanguage ?? i18n.language;
  const posterDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(posterLocale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
    [posterLocale],
  );
  const beforeDate = posterDateFormatter.format(before.takenAt);
  const afterDate = posterDateFormatter.format(after.takenAt);
  const daysDifference = comparisonElapsedDays(before, after);

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: sizes.screenGutter,
        paddingBottom: spacing[5],
        gap: spacing[4],
      }}
      showsVerticalScrollIndicator={false}
    >
      <PhotoComparePoster
        ref={posterRef}
        width={posterWidth}
        height={posterHeight}
        beforeUri={beforeFullUri}
        afterUri={afterFullUri}
        beforeDate={beforeDate}
        afterDate={afterDate}
        daysDifference={daysDifference}
        copy={{
          before: t('progress.photos.compare.before').toUpperCase(),
          after: t('progress.photos.compare.after').toUpperCase(),
          headlinePrimary: t(
            'progress.photos.compare.posterHeadlinePrimary',
          ).toUpperCase(),
          headlineAccent: t(
            'progress.photos.compare.posterHeadlineAccent',
          ).toUpperCase(),
          subheadline: t(
            'progress.photos.compare.posterSubheadline',
          ).toUpperCase(),
          daySingular: t(
            'progress.photos.compare.posterDaySingular',
          ).toUpperCase(),
          dayPlural: t(
            'progress.photos.compare.posterDayPlural',
          ).toUpperCase(),
          footerMethod: t(
            'progress.photos.compare.posterFooterMethod',
          ).toUpperCase(),
          footerYou: t(
            'progress.photos.compare.posterFooterYou',
          ).toUpperCase(),
          footerEvolve: t(
            'progress.photos.compare.posterFooterEvolve',
          ).toUpperCase(),
          hashtag: t('progress.photos.compare.posterHashtag').toUpperCase(),
        }}
        accessibilityLabel={t(
          'progress.photos.compare.posterAccessibility',
          {
            pose: poseLabel,
            beforeDate,
            afterDate,
            count: daysDifference,
          },
        )}
        onBeforeLoad={() => setBeforeRendered(true)}
        onAfterLoad={() => setAfterRendered(true)}
        onBackgroundLoadStart={() => setBackgroundReady(false)}
        onBackgroundLoad={() => setBackgroundReady(true)}
        onBackgroundError={() => setBackgroundReady(false)}
        onLogoLoadStart={() => setLogoReady(false)}
        onLogoLoad={() => setLogoReady(true)}
        onLogoError={() => setLogoReady(false)}
        onLayout={(event) => {
          const { width: laidOutWidth, height: laidOutHeight } =
            event.nativeEvent.layout;
          setPosterLaidOut(laidOutWidth > 0 && laidOutHeight > 0);
        }}
      />

      <View style={{ width: posterWidth, gap: spacing[2] }}>
        {shareErrorMessage || exportState.status === 'error' ? (
          <Text
            accessibilityLiveRegion="assertive"
            style={{
              color: colors.warning,
              fontFamily: fonts.ui,
              fontSize: 12.5,
              lineHeight: 18,
              textAlign: 'center',
            }}
          >
            {shareErrorMessage ?? t('progress.photos.compare.captureFailed')}
          </Text>
        ) : shareState.status === 'completed' ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{
              color: colors.accentHi,
              fontFamily: fonts.mono,
              fontSize: 10,
              letterSpacing: 0.8,
              textAlign: 'center',
              textTransform: 'uppercase',
            }}
          >
            {t('progress.photos.compare.shareReady')}
          </Text>
        ) : null}
        <CtaButton
          onPress={handlePosterAction}
          disabled={!posterReady || actionBusy}
          accessibilityLabel={ctaLabel}
          accessibilityState={{
            busy: actionBusy,
            disabled: !posterReady || actionBusy,
          }}
          style={{ alignSelf: 'stretch' }}
        >
          {ctaLabel}
        </CtaButton>
      </View>
    </ScrollView>
  );
}

/**
 * The first pick turned out to have no partner.
 *
 * `comparisonStartCandidates` normally prevents this, but the gallery can
 * change underneath — a delete, or a reload dropping the only other photo of
 * that pose. Showing a way out beats crashing or freezing on an empty list.
 */
function NoCandidates({
  poseLabel,
  onChooseAnother,
}: {
  poseLabel: string;
  onChooseAnother: () => void;
}) {
  const { t } = useTranslation('home');
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: sizes.screenGutter,
        gap: spacing[4],
      }}
    >
      <Icon name="camera" size={26} color={colors.faint} />
      <MonoLabel size={9}>{poseLabel.toUpperCase()}</MonoLabel>
      <Text
        style={{
          color: colors.mute,
          fontFamily: fonts.ui,
          fontSize: 14,
          lineHeight: 21,
          textAlign: 'center',
        }}
      >
        {t('progress.photos.compare.noCandidate')}
      </Text>
      <Pressable
        onPress={onChooseAnother}
        accessibilityRole="button"
        accessibilityLabel={t('progress.photos.compare.chooseAnother')}
        style={{
          paddingVertical: spacing[3],
          paddingHorizontal: spacing[5],
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <MonoLabel color={colors.text}>
          {t('progress.photos.compare.chooseAnother').toUpperCase()}
        </MonoLabel>
      </Pressable>
    </View>
  );
}
