import React, { type ReactElement } from 'react';
import { FlatList, Platform } from 'react-native';

import { PhotoVaultDayRow } from './PhotoVaultDayRow';
import { spacing } from '../../theme/tokens';
import type { ProgressDay, ProgressPhotoFilter } from '../../lib/photoVaultDayGrouping';
import type { ProgressPhotoPose } from '../../lib/photoVaultIdentity';
import type { GalleryThumbnailOwner } from '../../lib/photoVaultGallery';

/**
 * The private gallery, one row per day.
 *
 * Still a single flat `FlatList`, deliberately: each item is a whole day, so
 * month headings render inline from `day.startsMonth` rather than through a
 * `SectionList` or nested lists, either of which would cost the virtualization
 * that keeps a large private gallery cheap.
 *
 * Uses React Native's own `Image` (inside the row) rather than `expo-image`:
 * the latter's disk cache would copy decrypted photos into a durable cache
 * outside the vault's control, which is exactly what the design avoids. Every
 * callback below belongs to the gallery controller — `onVisible`/`onHidden`
 * drive the download queue and the session LRU, and `onRendered` closes the
 * render-ready timing.
 */

interface Props {
  days: ProgressDay[];
  /** Narrows each row to one pose. Purely presentational. */
  filter: ProgressPhotoFilter;
  /** Asks the controller to fetch and decrypt a photo that scrolled in. */
  onVisible: (photoId: string) => GalleryThumbnailOwner;
  /** Releases render ownership; the bounded session LRU may retain it. */
  onHidden: (owner: GalleryThumbnailOwner) => void;
  onOpen: (photoId: string) => void;
  /** Opens the new-photo flow with an empty slot's pose pre-selected. */
  onAddPose: (pose: ProgressPhotoPose) => void;
  onRendered: (photoId: string) => void;
  formatDate: (date: Date) => string;
  formatMonth: (date: Date) => string;
  listHeader?: ReactElement | null;
  listFooter?: ReactElement | null;
}

export function PhotoVaultGrid({
  days,
  filter,
  onVisible,
  onHidden,
  onOpen,
  onAddPose,
  onRendered,
  formatDate,
  formatMonth,
  listHeader = null,
  listFooter = null,
}: Props) {
  return (
    <FlatList
      testID="photo-vault-grid"
      data={days}
      // A day is stable across reloads, so cells are not remounted — and a
      // remount would drop the thumbnail the LRU already holds.
      keyExtractor={(day) => day.dateKey}
      // The memoized row must re-render when the filter narrows it.
      extraData={filter}
      renderItem={({ item }) => (
        <PhotoVaultDayRow
          day={item}
          filter={filter}
          onVisible={onVisible}
          onHidden={onHidden}
          onOpen={onOpen}
          onAddPose={onAddPose}
          onRendered={onRendered}
          formatDay={formatDate}
          formatMonth={formatMonth}
        />
      )}
      ListHeaderComponent={listHeader}
      ListFooterComponent={listFooter}
      contentContainerStyle={{ paddingBottom: spacing[3] }}
      initialNumToRender={3}
      maxToRenderPerBatch={2}
      updateCellsBatchingPeriod={50}
      // Current viewport plus a small adjacent window: useful prefetch without
      // walking the whole private gallery.
      windowSize={3}
      removeClippedSubviews={Platform.OS === 'android'}
      showsVerticalScrollIndicator={false}
    />
  );
}
