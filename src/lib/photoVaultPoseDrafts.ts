import { POSE_SLOTS } from './photoVaultDayGrouping';
import { localDateKey, type ProgressPhotoPose } from './photoVaultIdentity';

/**
 * The "new photo" session: up to three independent drafts, one per pose.
 *
 * Pure state transitions, extracted from the sheet so the rules that matter
 * can be exercised directly — the project has no component renderer, and
 * these are exactly the rules that were wrong before: selecting a pose used
 * to change which photo was displayed, not which photo was being edited.
 *
 * Three invariants hold throughout:
 *
 *   - a draft belongs to one pose and is never moved, copied or cleared by
 *     touching another pose;
 *   - each draft keeps its OWN capture time, so three pictures from three
 *     days are filed on those three days;
 *   - replacing or clearing a draft reports the file it released, so no
 *     staged plaintext is ever orphaned.
 */

/** The subset of a picked photo these transitions care about. */
export interface PoseDraftPhoto {
  sourceUri: string;
  takenAt: Date;
}

export type PoseDrafts<T extends PoseDraftPhoto = PoseDraftPhoto> = Record<
  ProgressPhotoPose,
  T | null
>;

export const EMPTY_POSE_DRAFTS: PoseDrafts = { front: null, side: null, back: null };

export function emptyPoseDrafts<T extends PoseDraftPhoto>(): PoseDrafts<T> {
  return { front: null, side: null, back: null };
}

/**
 * Assigns (or clears) one pose's draft.
 *
 * Returns the new map plus the URI that stopped being referenced, if any.
 * The caller releases it — this module never touches the filesystem.
 */
export function setPoseDraft<T extends PoseDraftPhoto>(
  drafts: PoseDrafts<T>,
  pose: ProgressPhotoPose,
  photo: T | null,
): { drafts: PoseDrafts<T>; released: string | null } {
  const previous = drafts[pose];
  const released =
    previous && previous.sourceUri !== photo?.sourceUri ? previous.sourceUri : null;
  return { drafts: { ...drafts, [pose]: photo }, released };
}

/** Every staged file the session currently holds. */
export function stagedDraftUris<T extends PoseDraftPhoto>(drafts: PoseDrafts<T>): string[] {
  return POSE_SLOTS.map((pose) => drafts[pose]?.sourceUri).filter(
    (uri): uri is string => uri !== undefined,
  );
}

/** Poses the user has assembled, in the fixed visual order. */
export function filledPoses<T extends PoseDraftPhoto>(
  drafts: PoseDrafts<T>,
): ProgressPhotoPose[] {
  return POSE_SLOTS.filter((pose) => drafts[pose] !== null);
}

/**
 * The day a pose's draft will be filed under.
 *
 * Per pose, never global: `null` means the pose is empty, and the caller may
 * show today purely as a hint.
 */
export function draftDateKey<T extends PoseDraftPhoto>(
  drafts: PoseDrafts<T>,
  pose: ProgressPhotoPose,
): string | null {
  const draft = drafts[pose];
  return draft ? localDateKey(draft.takenAt) : null;
}

/**
 * Splits the assembled poses into those that can be uploaded and those whose
 * (day, pose) is already occupied.
 *
 * Blocking is per pose: a taken `front` never prevents `side` and `back` from
 * being saved. The database remains the final authority — this only avoids an
 * upload that is already known to be refused.
 */
export function partitionSavablePoses<T extends PoseDraftPhoto>(
  drafts: PoseDrafts<T>,
  isSlotTaken: (dateKey: string, pose: ProgressPhotoPose) => boolean,
): { savable: ProgressPhotoPose[]; blocked: ProgressPhotoPose[] } {
  const savable: ProgressPhotoPose[] = [];
  const blocked: ProgressPhotoPose[] = [];
  for (const pose of filledPoses(drafts)) {
    const dateKey = draftDateKey(drafts, pose)!;
    if (isSlotTaken(dateKey, pose)) blocked.push(pose);
    else savable.push(pose);
  }
  return { savable, blocked };
}
