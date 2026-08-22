import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { CtaButton } from '../ui/CtaButton';
import { Icon } from '../ui/Icon';
import { Display, MonoLabel, Slash } from '../ui/Display';
import { sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import { POSE_SLOTS } from '../../lib/photoVaultDayGrouping';
import {
  EMPTY_POSE_DRAFTS,
  filledPoses,
  partitionSavablePoses,
  setPoseDraft,
  shouldWarnSlotTaken,
  stagedDraftUris,
  type PoseDrafts as PoseDraftMap,
} from '../../lib/photoVaultPoseDrafts';
import { type ProgressPhotoPose } from '../../lib/photoVaultIdentity';
import type { PhotoVaultIssue } from '../../lib/photoVaultErrors';
import type { PickerOutcome } from '../../services/photoVaultPicker';

/**
 * The "new photo" session: up to three independent photos, one per pose.
 *
 * The three drafts are genuinely separate. Selecting a pose only changes which
 * draft is being viewed and edited — it never moves, copies or clears another
 * pose's photo, and each draft keeps its own capture time, so three pictures
 * taken on three different days are stored on those three days rather than
 * collapsed onto one.
 *
 * Nothing is uploaded while the session is being assembled. The drafts are
 * local staged files until the user commits with the final CTA.
 *
 * Neither source requests a permission on mount — the camera and library
 * permissions are only asked for after the user picks that specific option
 * (see services/photoVaultPicker).
 *
 * The sheet supplies exactly two things per upload: the pose and the picked
 * image. It never sees or invents an asset id, a document id, a storage path
 * or a day — the service derives all of those.
 */

/** Exactly what the picker returned on success, minus its status tag. */
export type PickedPhoto = Omit<Extract<PickerOutcome, { status: 'picked' }>, 'status'>;

export type PoseDrafts = PoseDraftMap<PickedPhoto>;

export interface SavePoseResult {
  ok: boolean;
  issue?: PhotoVaultIssue;
}

type PoseState =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'success' }
  | { status: 'error'; issue?: PhotoVaultIssue };

type PoseStates = Record<ProgressPhotoPose, PoseState>;

const EMPTY_DRAFTS = EMPTY_POSE_DRAFTS as PoseDrafts;
const IDLE_STATES: PoseStates = {
  front: { status: 'idle' },
  side: { status: 'idle' },
  back: { status: 'idle' },
};

interface Props {
  visible: boolean;
  /** Pre-selects a pose when the flow was opened from an empty slot. */
  initialPose?: ProgressPhotoPose;
  onClose: () => void;
  onPickCamera: () => Promise<PickerOutcome>;
  onPickLibrary: () => Promise<PickerOutcome>;
  /** Reports a picker outcome the sheet cannot act on (denied, unsupported). */
  onPickerIssue: (outcome: PickerOutcome) => void;
  /** Releases a staged file no draft references any more. */
  onDiscard: (uri: string | null) => void;
  /** Uploads one pose. Called once per filled draft. */
  onSavePose: (photo: PickedPhoto, pose: ProgressPhotoPose) => Promise<SavePoseResult>;
  /** Whether the client already knows of a photo for this day and pose. */
  isSlotTaken: (dateKey: string, pose: ProgressPhotoPose) => boolean;
  /**
   * Swaps the photo already occupying a slot. Distinct from `onSavePose` on
   * purpose: replacing destroys something the user owns and must never be
   * reachable by accident.
   */
  onReplacePose: (photo: PickedPhoto, pose: ProgressPhotoPose) => Promise<SavePoseResult>;
  formatDate: (date: Date) => string;
}

function PoseOption({
  pose,
  label,
  selected,
  state,
  filled,
  onPress,
}: {
  pose: ProgressPhotoPose;
  label: string;
  selected: boolean;
  state: PoseState;
  filled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  const colors = theme.colors;
  const fonts = theme.fonts;
  const failed = state.status === 'error';
  const uploading = state.status === 'uploading';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={t('progress.photos.a11y.selectPose', { pose: label })}
      accessibilityHint={filled ? t('progress.photos.a11y.poseFilled') : undefined}
      testID={`photo-vault-pose-${pose}`}
      style={{
        flex: 1,
        paddingVertical: spacing[3.5],
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing[1],
        borderRadius: 10,
        borderWidth: 1,
        borderColor: failed ? colors.danger : selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accentSoft : colors.surface,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: selected ? colors.text : colors.mute,
        }}
      >
        {label}
      </Text>

      {/* One discreet marker: assembled, saving, saved or failed. */}
      <View style={{ height: 10, justifyContent: 'center' }}>
        {uploading ? (
          <ActivityIndicator size="small" color={colors.accentHi} />
        ) : state.status === 'success' ? (
          <Icon name="check" size={10} color={colors.success} />
        ) : failed ? (
          <Icon name="alert-triangle" size={10} color={colors.danger} />
        ) : filled ? (
          <View
            testID={`photo-vault-pose-${pose}-filled`}
            style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accentHi }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

function SourceButton({
  icon,
  label,
  accessibilityLabel,
  onPress,
  disabled,
}: {
  icon: 'camera' | 'plus';
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const fonts = theme.fonts;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={{
        flex: 1,
        alignItems: 'center',
        gap: spacing[2],
        paddingVertical: spacing[5],
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon name={icon} size={20} color={colors.accentHi} />
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 9.5,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          color: colors.text,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function AddPhotoSheet({
  visible,
  initialPose,
  onClose,
  onPickCamera,
  onPickLibrary,
  onPickerIssue,
  onDiscard,
  onSavePose,
  isSlotTaken,
  onReplacePose,
  formatDate,
}: Props) {
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  const colors = theme.colors;
  const fonts = theme.fonts;
  const [pose, setPose] = useState<ProgressPhotoPose>(initialPose ?? 'front');
  const [drafts, setDrafts] = useState<PoseDrafts>(EMPTY_DRAFTS);
  const [states, setStates] = useState<PoseStates>(IDLE_STATES);
  const [saving, setSaving] = useState(false);
  /** The pose awaiting an explicit confirmation before its photo is swapped. */
  const [confirmingReplace, setConfirmingReplace] = useState<ProgressPhotoPose | null>(null);

  /**
   * Mirrors `drafts` so the close/lock cleanup can release staged files
   * without depending on a captured render's value.
   */
  const draftsRef = useRef<PoseDrafts>(EMPTY_DRAFTS);
  draftsRef.current = drafts;

  const poseLabels: Record<ProgressPhotoPose, string> = {
    front: t('progress.photos.poses.front'),
    side: t('progress.photos.poses.side'),
    back: t('progress.photos.poses.back'),
  };

  const releaseAll = useCallback(() => {
    for (const uri of stagedDraftUris(draftsRef.current)) onDiscard(uri);
    draftsRef.current = EMPTY_DRAFTS;
    setDrafts(EMPTY_DRAFTS);
    setStates(IDLE_STATES);
  }, [onDiscard]);

  // Opening starts a clean session and honours the slot the user tapped.
  useEffect(() => {
    if (visible) {
      setPose(initialPose ?? 'front');
      setDrafts(EMPTY_DRAFTS);
      setStates(IDLE_STATES);
      setSaving(false);
      setConfirmingReplace(null);
    }
  }, [visible, initialPose]);

  // Closing for ANY reason — cancel, or the vault locking underneath — must
  // leave no staged plaintext behind. This covers the paths that never reach
  // the cancel handler.
  useEffect(() => {
    if (!visible) releaseAll();
  }, [visible, releaseAll]);

  const draft = drafts[pose];
  /**
   * The day the SELECTED pose will be filed under.
   *
   * Per pose, never global: three library photos from three different days
   * must keep their own days rather than inherit the first one's.
   */
  const effectiveDate = draft?.takenAt ?? new Date();
  const { savable: savablePoses, blocked: blockedPoses } = partitionSavablePoses(
    drafts,
    isSlotTaken,
  );
  const slotTaken = shouldWarnSlotTaken({
    hasDraft: draft !== null,
    // While this pose is uploading, the slot is held by the optimistic card
    // this very save created — see `shouldWarnSlotTaken`.
    uploading: states[pose].status === 'uploading',
    pose,
    blocked: blockedPoses,
  });

  const setDraft = useCallback((slot: ProgressPhotoPose, next: PickedPhoto | null) => {
    setDrafts((current) => {
      // Replacing or clearing a draft releases the file it was holding.
      const { drafts: updated, released } = setPoseDraft(current, slot, next);
      if (released) onDiscard(released);
      return updated;
    });
    setStates((current) => ({ ...current, [slot]: { status: 'idle' } }));
  }, [onDiscard]);

  const handlePick = useCallback(
    async (pick: () => Promise<PickerOutcome>) => {
      // Captured now: the picker is async and the user could switch poses
      // while it is open. The photo belongs to the pose that requested it.
      const target = pose;
      const outcome = await pick();
      if (outcome.status !== 'picked') {
        if (outcome.status !== 'cancelled') onPickerIssue(outcome);
        return;
      }
      setDraft(target, {
        sourceUri: outcome.sourceUri,
        takenAt: outcome.takenAt,
        mimeType: outcome.mimeType,
        width: outcome.width,
        height: outcome.height,
      });
    },
    [onPickerIssue, pose, setDraft],
  );

  const handleClose = useCallback(() => {
    if (saving) return;
    // `releaseAll` also runs from the visibility effect; clearing here first
    // means the second pass has nothing left to discard.
    releaseAll();
    onClose();
  }, [onClose, releaseAll, saving]);

  /**
   * Uploads every filled, unblocked pose.
   *
   * Sequential on purpose. Each single upload already runs two Storage
   * transfers in parallel and holds two encrypted blobs, so three photos at
   * once would triple that peak for no perceptible gain on at most three
   * items — and it would make per-pose progress and partial failure much
   * harder to report honestly.
   *
   * Each pose is an independent entity: a failure never rolls back a sibling
   * that already succeeded, because there is no cross-photo transaction that
   * could do so safely.
   */
  const handleSave = useCallback(async () => {
    if (savablePoses.length === 0 || saving) return;
    setSaving(true);

    const failed: ProgressPhotoPose[] = [];
    for (const slot of savablePoses) {
      const photo = draftsRef.current[slot];
      if (!photo) continue;

      setStates((current) => ({ ...current, [slot]: { status: 'uploading', progress: 0 } }));
      const result = await onSavePose(photo, slot);

      if (result.ok) {
        setStates((current) => ({ ...current, [slot]: { status: 'success' } }));
        // The controller owns the staged file once the upload succeeded.
        setDrafts((current) => ({ ...current, [slot]: null }));
        draftsRef.current = { ...draftsRef.current, [slot]: null };
      } else {
        failed.push(slot);
        setStates((current) => ({
          ...current,
          [slot]: { status: 'error', issue: result.issue },
        }));
      }
    }

    setSaving(false);
    // Everything the user asked for landed: nothing left to review.
    if (failed.length === 0 && blockedPoses.length === 0) {
      onClose();
    } else if (failed.length > 0) {
      // Keep the session open on the first pose that still needs attention.
      setPose(failed[0]!);
    }
  }, [blockedPoses.length, onClose, onSavePose, savablePoses, saving]);

  /**
   * Swaps the photo in an occupied slot, after an explicit confirmation.
   *
   * Kept separate from the batch save: this is the only path that destroys
   * something already in the vault, so it is never reached by pressing the
   * normal save action.
   */
  const handleConfirmReplace = useCallback(async () => {
    const target = confirmingReplace;
    const photo = target ? draftsRef.current[target] : null;
    setConfirmingReplace(null);
    if (!target || !photo) return;

    setSaving(true);
    setStates((current) => ({ ...current, [target]: { status: 'uploading', progress: 0 } }));
    const result = await onReplacePose(photo, target);
    setSaving(false);

    if (result.ok) {
      setStates((current) => ({ ...current, [target]: { status: 'success' } }));
      setDrafts((current) => ({ ...current, [target]: null }));
      draftsRef.current = { ...draftsRef.current, [target]: null };
      // Nothing left to review once this was the only pose in the session.
      if (filledPoses(draftsRef.current).length === 0) onClose();
    } else {
      setStates((current) => ({
        ...current,
        [target]: { status: 'error', issue: result.issue },
      }));
    }
  }, [confirmingReplace, onClose, onReplacePose]);

  useEffect(() => {
    if (!confirmingReplace) return;
    const target = confirmingReplace;
    const photo = draftsRef.current[target];
    if (!photo) {
      setConfirmingReplace(null);
      return;
    }
    Alert.alert(
      t('progress.photos.replace.confirmTitle'),
      t('progress.photos.replace.confirmBody', {
        pose: poseLabels[target].toLowerCase(),
        date: formatDate(photo.takenAt),
      }),
      [
        {
          text: t('progress.photos.replace.cancel'),
          style: 'cancel',
          onPress: () => setConfirmingReplace(null),
        },
        {
          text: t('progress.photos.replace.confirm'),
          style: 'destructive',
          onPress: () => void handleConfirmReplace(),
        },
      ],
    );
    // Intentionally keyed on the pending pose only: re-running on every render
    // would stack dialogs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmingReplace]);

  const state = states[pose];
  const saveLabel =
    savablePoses.length > 1
      ? t('progress.photos.add.saveCount', { count: savablePoses.length })
      : t('progress.photos.add.save');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.modalBackdrop, justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: colors.bg2,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: 1,
            borderColor: colors.borderStrong,
            maxHeight: '92%',
          }}
        >
          <SafeAreaView edges={['bottom']}>
            <ScrollView
              contentContainerStyle={{ padding: sizes.screenGutter, paddingTop: spacing[5] }}
              showsVerticalScrollIndicator={false}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                }}
              >
                <View accessibilityRole="header">
                  <Display size={26}>{t('progress.photos.add.title').toUpperCase()}</Display>
                  <MonoLabel size={9} style={{ marginTop: spacing[1.5] }}>
                    {formatDate(effectiveDate).toUpperCase()}
                  </MonoLabel>
                </View>
                <Pressable
                  onPress={handleClose}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={t('progress.photos.add.cancel')}
                  hitSlop={12}
                  style={{ padding: spacing[1.5] }}
                >
                  <Icon name="x" size={20} color={colors.mute} />
                </Pressable>
              </View>

              <Slash style={{ marginTop: spacing[6], marginBottom: spacing[3] }}>
                {t('progress.photos.add.poseSection').toUpperCase()}
              </Slash>
              <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                {POSE_SLOTS.map((option) => (
                  <PoseOption
                    key={option}
                    pose={option}
                    label={poseLabels[option]}
                    selected={pose === option}
                    state={states[option]}
                    filled={drafts[option] !== null}
                    onPress={() => setPose(option)}
                  />
                ))}
              </View>

              {slotTaken ? (
                <View style={{ marginTop: spacing[3], gap: spacing[2.5] }}>
                  <Text
                    accessibilityLiveRegion="polite"
                    style={{
                      color: colors.warning,
                      fontFamily: fonts.ui,
                      fontSize: 12.5,
                      lineHeight: 18,
                    }}
                  >
                    {t('progress.photos.add.slotTaken', {
                      pose: poseLabels[pose].toLowerCase(),
                    })}
                  </Text>
                  {/* Replacing is offered, never performed implicitly. */}
                  <Pressable
                    onPress={() => setConfirmingReplace(pose)}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityLabel={t('progress.photos.replace.cta')}
                    testID="photo-vault-replace-cta"
                    style={{
                      alignSelf: 'flex-start',
                      paddingVertical: spacing[2],
                      paddingHorizontal: spacing[3.5],
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: colors.borderStrong,
                    }}
                  >
                    <MonoLabel color={colors.text}>
                      {t('progress.photos.replace.cta').toUpperCase()}
                    </MonoLabel>
                  </Pressable>
                </View>
              ) : null}

              {state.status === 'error' ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={{
                    marginTop: spacing[3],
                    color: colors.dangerText,
                    fontFamily: fonts.ui,
                    fontSize: 12.5,
                    lineHeight: 18,
                  }}
                >
                  {t('progress.photos.add.poseFailed', { pose: poseLabels[pose].toLowerCase() })}
                </Text>
              ) : null}

              <Slash style={{ marginTop: spacing[6], marginBottom: spacing[3] }}>
                {t(
                  draft
                    ? 'progress.photos.add.previewSection'
                    : 'progress.photos.add.photoSection',
                ).toUpperCase()}
              </Slash>

              {draft ? (
                <View>
                  <Image
                    source={{ uri: draft.sourceUri }}
                    resizeMode="cover"
                    accessibilityRole="image"
                    accessibilityLabel={t('progress.photos.a11y.posePreview', {
                      pose: poseLabels[pose],
                    })}
                    style={{
                      width: '100%',
                      height: 260,
                      borderRadius: 12,
                      backgroundColor: colors.surface,
                    }}
                  />
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: spacing[6],
                      paddingVertical: spacing[3],
                    }}
                  >
                    <Pressable
                      onPress={() => void handlePick(onPickLibrary)}
                      disabled={saving}
                      accessibilityRole="button"
                      accessibilityLabel={t('progress.photos.add.change')}
                      hitSlop={8}
                    >
                      <MonoLabel color={colors.accentHi}>
                        {t('progress.photos.add.change').toUpperCase()}
                      </MonoLabel>
                    </Pressable>
                    <Pressable
                      onPress={() => setDraft(pose, null)}
                      disabled={saving}
                      accessibilityRole="button"
                      accessibilityLabel={t('progress.photos.a11y.removePose', {
                        pose: poseLabels[pose],
                      })}
                      hitSlop={8}
                    >
                      <MonoLabel color={colors.mute}>
                        {t('progress.photos.add.remove').toUpperCase()}
                      </MonoLabel>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                  <SourceButton
                    icon="camera"
                    label={t('progress.photos.add.camera')}
                    accessibilityLabel={t('progress.photos.a11y.takePhoto')}
                    onPress={() => void handlePick(onPickCamera)}
                    disabled={saving}
                  />
                  <SourceButton
                    icon="plus"
                    label={t('progress.photos.add.library')}
                    accessibilityLabel={t('progress.photos.a11y.chooseLibrary')}
                    onPress={() => void handlePick(onPickLibrary)}
                    disabled={saving}
                  />
                </View>
              )}

              <View style={{ marginTop: spacing[7] }}>
                <CtaButton
                  onPress={() => void handleSave()}
                  disabled={savablePoses.length === 0 || saving}
                  accessibilityLabel={t('progress.photos.a11y.savePhoto')}
                  style={{ alignSelf: 'stretch' }}
                >
                  {saving ? (
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] }}
                    >
                      <ActivityIndicator color={colors.primaryForeground} />
                      <Text
                        style={{
                          color: colors.primaryForeground,
                          fontFamily: fonts.uiSemi,
                          fontSize: 14,
                        }}
                      >
                        {t('progress.photos.add.saving')}
                      </Text>
                    </View>
                  ) : (
                    saveLabel
                  )}
                </CtaButton>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
