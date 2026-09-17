/**
 * Pure UI-state predicates for `WorkoutShareComposer`, pulled out so the
 * "no photo yet" vs "photo selected" branching is a tested function instead
 * of an inline ternary duplicated between the remove-button overlay and the
 * photo-actions row.
 */
export type PhotoActionsMode = 'add' | 'change';

/** `'add'` (camera/gallery visible) with no photo, `'change'` (discreet swap action) once one exists. */
export function resolvePhotoActionsMode(photoUri: string | null | undefined): PhotoActionsMode {
  return photoUri ? 'change' : 'add';
}

/** The circular remove-photo (X) control only ever shows once a photo exists. */
export function shouldShowRemovePhotoButton(photoUri: string | null | undefined): boolean {
  return Boolean(photoUri);
}
