/**
 * Registry for the inline "Compartilhar em" row — the single source of
 * truth for which destinations exist, their order, their i18n label, and
 * which icon represents them. `WorkoutShareComposer` only maps over this
 * list; it never branches on a destination id itself (that logic lives in
 * `share.ts`'s controller).
 */
export type WorkoutShareDestinationId =
  | 'instagramStories'
  | 'instagram'
  | 'tiktok'
  | 'facebook'
  | 'whatsapp'
  | 'generic';

export type WorkoutShareDestinationIcon =
  | { kind: 'brand'; name: 'instagram' | 'tiktok' | 'facebook' | 'whatsapp' }
  /** Neutral system glyph — used only by "Outro", which has no brand mark. */
  | { kind: 'system'; name: 'share' };

export interface WorkoutShareDestinationConfig {
  id: WorkoutShareDestinationId;
  labelKey: string;
  icon: WorkoutShareDestinationIcon;
}

export const WORKOUT_SHARE_DESTINATIONS: readonly WorkoutShareDestinationConfig[] = [
  {
    id: 'instagramStories',
    labelKey: 'done.shareComposer.destinations.instagramStories',
    icon: { kind: 'brand', name: 'instagram' },
  },
  {
    id: 'instagram',
    labelKey: 'done.shareComposer.destinations.instagram',
    icon: { kind: 'brand', name: 'instagram' },
  },
  {
    id: 'tiktok',
    labelKey: 'done.shareComposer.destinations.tiktok',
    icon: { kind: 'brand', name: 'tiktok' },
  },
  {
    id: 'facebook',
    labelKey: 'done.shareComposer.destinations.facebook',
    icon: { kind: 'brand', name: 'facebook' },
  },
  {
    id: 'whatsapp',
    labelKey: 'done.shareComposer.destinations.whatsapp',
    icon: { kind: 'brand', name: 'whatsapp' },
  },
  {
    id: 'generic',
    labelKey: 'done.shareComposer.destinations.other',
    icon: { kind: 'system', name: 'share' },
  },
];
