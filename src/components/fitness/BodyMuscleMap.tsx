import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { MuscleId } from '../../types/exercise';
import { resolveMuscleIntensity } from '../../lib/muscleFillIntensity';
import { muscleForPartId } from '../../lib/muscleMapRegions';
import { BODY_MUSCLE_MAP_MALE, type MuscleMapDiagram } from '../../data/bodyMuscleMapAnatomy';

/**
 * Visual-only projection of session muscles onto a real anatomical body map.
 * Reads `primaryMuscles`/`secondaryMuscles` (from `deriveSessionMuscles`) and
 * never decides anything about the workout itself.
 *
 * Renders the vendored `@musclemap/assets` path data (see
 * `src/data/bodyMuscleMapAnatomy.ts` and `THIRD_PARTY_NOTICES.md` for
 * provenance/license) — hand-traced anatomical illustrations, not the
 * geometric Circle/Rect/Ellipse placeholder this replaced. Which muscles
 * appear in which view (front vs back) is entirely determined by which
 * paths each vendored diagram actually contains — see
 * `src/lib/muscleMapRegions.ts` for the `MuscleId` -> region mapping.
 */
export interface BodyMuscleMapProps {
  /** Muscles to render at full intensity. */
  primaryMuscles: readonly MuscleId[];
  /** Muscles to render at reduced intensity — always visually subordinate to primary. */
  secondaryMuscles?: readonly MuscleId[];
  /**
   * Set false to hide secondary muscles entirely (still safe to pass them —
   * `deriveSessionMuscles`'s primary/secondary split is preserved by the
   * caller regardless of this prop, only the visual is affected).
   */
  showSecondary?: boolean;
  /** Width of EACH silhouette (front + back are rendered side by side). */
  size?: number;
  activeColor?: string;
  /** Fill opacity used for secondary muscles. Clamped below 1 (primary) — enforced via Math.min. */
  secondaryOpacity?: number;
  baseColor?: string;
  outlineColor?: string;
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_SIZE = 58;
const DEFAULT_SECONDARY_OPACITY = 0.35;

function DiagramView({
  diagram,
  size,
  primarySet,
  secondarySet,
  activeColor,
  secondaryOpacity,
  baseColor,
  outlineColor,
}: {
  diagram: MuscleMapDiagram;
  size: number;
  primarySet: ReadonlySet<MuscleId>;
  secondarySet: ReadonlySet<MuscleId>;
  activeColor: string;
  secondaryOpacity: number;
  baseColor: string;
  outlineColor: string;
}) {
  const [, , vbWidth, vbHeight] = diagram.viewBox.split(' ');
  const height = (size * Number(vbHeight)) / Number(vbWidth);

  return (
    <Svg width={size} height={height} viewBox={diagram.viewBox}>
      {diagram.outline.map((part, index) => (
        <Path key={`outline-${index}`} d={part.d} fill={baseColor} stroke={outlineColor} strokeWidth={2} />
      ))}
      {diagram.muscles.map((muscle, index) => {
        const muscleId = muscleForPartId(muscle.id);
        const intensity = muscleId ? resolveMuscleIntensity(muscleId, primarySet, secondarySet) : 'inactive';
        const fill = intensity === 'inactive' ? baseColor : activeColor;
        const fillOpacity = intensity === 'primary' ? 1 : intensity === 'secondary' ? secondaryOpacity : 1;
        const key = muscle.id ?? `${muscle.group}-${muscle.side ?? 'center'}-${index}`;
        return <Path key={key} d={muscle.d} fill={fill} fillOpacity={fillOpacity} stroke={outlineColor} strokeWidth={1} />;
      })}
    </Svg>
  );
}

export function BodyMuscleMap({
  primaryMuscles,
  secondaryMuscles = [],
  showSecondary = true,
  size = DEFAULT_SIZE,
  activeColor = '#3B82F6',
  secondaryOpacity = DEFAULT_SECONDARY_OPACITY,
  baseColor = 'rgba(255,255,255,0.14)',
  outlineColor = 'rgba(255,255,255,0.18)',
  style,
}: BodyMuscleMapProps) {
  const primarySet = new Set(primaryMuscles);
  const secondarySet = new Set(
    (showSecondary ? secondaryMuscles : []).filter((muscle) => !primarySet.has(muscle)),
  );
  const clampedSecondaryOpacity = Math.min(Math.max(secondaryOpacity, 0), 0.9);

  const sharedProps = {
    primarySet,
    secondarySet,
    size,
    activeColor,
    secondaryOpacity: clampedSecondaryOpacity,
    baseColor,
    outlineColor,
  };

  return (
    <View style={[{ flexDirection: 'row', gap: 6 }, style]}>
      <DiagramView diagram={BODY_MUSCLE_MAP_MALE.front} {...sharedProps} />
      <DiagramView diagram={BODY_MUSCLE_MAP_MALE.back} {...sharedProps} />
    </View>
  );
}
