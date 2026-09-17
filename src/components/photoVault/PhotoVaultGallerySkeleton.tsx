import React, { memo, useEffect, useState } from 'react';
import { Image, View } from 'react-native';

import { sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import { useAuth } from '../../state/AuthContext';
import { usePhotoVault } from '../../state/PhotoVaultContext';
import { listLockedPreviewUris } from '../../services/photoVaultLockedPreviewCache';

/**
 * What sits behind the blur of the locked Photo Vault screen.
 *
 * Three states, chosen without ever touching Firestore, the vault key, or a
 * decrypt — only the signed-in Firebase uid (a different, non-biometric layer
 * of auth) and a pure local-disk read of already-cached, already-destructively
 * -degraded preview files (see `photoVaultLockedPreviewCache.ts` and
 * `photoVaultLockedPreviewGenerator.ts`):
 *
 *   - vault genuinely empty (`hasPhotoVaultContent === false`) → the same
 *     generic skeleton as before;
 *   - content exists but this device has no cached preview yet (a fresh
 *     install, or an old photo the backfill has not reached) → the same
 *     generic skeleton — never fabricated photos;
 *   - content exists and at least one preview is cached locally → a grid of
 *     those (already irreversibly degraded) previews.
 */

const CELL_HEIGHT = 148;
const SKELETON_ROWS = 3;
const GRID_COLUMNS = 3;

function SkeletonBar({ width }: { width: number }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        width,
        height: 10,
        borderRadius: 4,
        backgroundColor: theme.colors.surfaceElevated,
      }}
    />
  );
}

function SkeletonCell() {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        height: CELL_HEIGHT,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
        borderWidth: sizes.hairline,
        borderColor: theme.colors.border,
      }}
    />
  );
}

function SkeletonRow() {
  return (
    <View style={{ paddingHorizontal: sizes.screenGutter, paddingBottom: spacing[5] }}>
      <View style={{ marginBottom: spacing[2.5] }}>
        <SkeletonBar width={72} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing[2] }}>
        <SkeletonCell />
        <SkeletonCell />
        <SkeletonCell />
      </View>
    </View>
  );
}

/** The neutral fallback: empty vault, or content not cached locally yet. Never fabricated. */
function NeutralSkeleton() {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
        <SkeletonRow key={index} />
      ))}
    </>
  );
}

function PreviewCell({ uri }: { uri: string }) {
  const { theme } = useTheme();
  return (
    <Image
      source={{ uri }}
      resizeMode="cover"
      style={{
        flex: 1,
        height: CELL_HEIGHT,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
      }}
    />
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** A grid of already-degraded local previews. Never the real gallery's day/pose grouping. */
function PreviewGrid({ uris }: { uris: string[] }) {
  return (
    <>
      {chunk(uris, GRID_COLUMNS).map((row, index) => (
        <View
          key={index}
          style={{
            flexDirection: 'row',
            gap: spacing[2],
            paddingHorizontal: sizes.screenGutter,
            paddingBottom: spacing[2],
          }}
        >
          {row.map((uri) => (
            <PreviewCell key={uri} uri={uri} />
          ))}
          {Array.from({ length: GRID_COLUMNS - row.length }).map((_, index2) => (
            <View key={`pad-${index2}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </>
  );
}

export const PhotoVaultGallerySkeleton = memo(function PhotoVaultGallerySkeleton() {
  const { user } = useAuth();
  const { hasPhotoVaultContent, hasPhotoVaultContentReady } = usePhotoVault();
  const uid = user?.uid ?? null;
  const [previewUris, setPreviewUris] = useState<string[]>([]);

  useEffect(() => {
    // Pure local disk read: no network, no Firestore, no vault key, no
    // unlock required. `uid` is the signed-in Firebase account, a separate
    // layer of auth from the Photo Vault's own biometric lock.
    setPreviewUris(uid ? listLockedPreviewUris(uid) : []);
  }, [uid]);

  const showPreviews = hasPhotoVaultContentReady && hasPhotoVaultContent && previewUris.length > 0;

  return (
    <View
      testID="photo-vault-gallery-skeleton"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ paddingTop: spacing[5] }}
    >
      {showPreviews ? <PreviewGrid uris={previewUris} /> : <NeutralSkeleton />}
    </View>
  );
});
