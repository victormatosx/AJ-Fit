import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { MuscleId } from '../../types/exercise';
import type { Sex } from '../../state/AppState';
import { resolveMuscleIntensity } from '../../lib/muscleFillIntensity';
import { muscleForPartId } from '../../lib/muscleMapRegions';
import {
  bodyMuscleMapDiagramKey,
  bodyMuscleMapPathKey,
  type BodyMuscleMapDiagramKey,
} from '../../lib/bodyMuscleMapKeys';
import { getBodyMuscleMapAnatomy, type MuscleMapDiagram } from '../../data/bodyMuscleMapAnatomy';

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
  /** Resolved questionnaire sex. This component never guesses a fallback. */
  sex: Sex;
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
  /** Optional interaction layer. Existing read-only consumers omit it. */
  onMusclePress?: (muscle: MuscleId) => void;
  /** Limits which anatomical regions respond to touch. */
  selectableMuscles?: readonly MuscleId[];
  muscleAccessibilityLabel?: (muscle: MuscleId) => string;
  gap?: number;
  /**
   * Visual-only horizontal shift of the FRONT silhouette, in px. The back
   * silhouette never moves. Default `0` is a no-op — every existing call
   * site (Home's/Treino's Today poster, onboarding, workout summary,
   * posters) keeps its current layout untouched.
   */
  frontOffsetX?: number;
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_SIZE = 58;
const DEFAULT_SECONDARY_OPACITY = 0.35;

function DiagramView({
  diagramKey,
  diagram,
  size,
  primarySet,
  secondarySet,
  activeColor,
  secondaryOpacity,
  baseColor,
  outlineColor,
  onMusclePress,
  selectableSet,
  muscleAccessibilityLabel,
}: {
  diagramKey: BodyMuscleMapDiagramKey;
  diagram: MuscleMapDiagram;
  size: number;
  primarySet: ReadonlySet<MuscleId>;
  secondarySet: ReadonlySet<MuscleId>;
  activeColor: string;
  secondaryOpacity: number;
  baseColor: string;
  outlineColor: string;
  onMusclePress?: (muscle: MuscleId) => void;
  selectableSet: ReadonlySet<MuscleId> | null;
  muscleAccessibilityLabel?: (muscle: MuscleId) => string;
}) {
  const [, , vbWidth, vbHeight] = diagram.viewBox.split(' ');
  const height = (size * Number(vbHeight)) / Number(vbWidth);

  return (
    <Svg width={size} height={height} viewBox={diagram.viewBox}>
      {diagram.outline.map((part, index) => (
        <Path
          key={bodyMuscleMapPathKey(diagramKey, 'outline', part, index)}
          d={part.d}
          fill={baseColor}
          stroke={outlineColor}
          strokeWidth={2}
        />
      ))}
      {diagram.muscles.map((muscle, index) => {
        const muscleId = muscleForPartId(muscle.id);
        const interactive = Boolean(
          muscleId
          && onMusclePress
          && (!selectableSet || selectableSet.has(muscleId)),
        );
        if (!interactive || !muscleId) return null;
        return (
          <Path
            key={bodyMuscleMapPathKey(diagramKey, 'hit', muscle, index)}
            d={muscle.d}
            fill="rgba(0,0,0,0.001)"
            stroke="rgba(0,0,0,0.001)"
            // Roughly 7 px at the onboarding map size. This makes thin
            // anatomical paths easier to hit without widening their fill.
            strokeWidth={48}
            strokeLinejoin="round"
            onPress={() => onMusclePress?.(muscleId)}
          />
        );
      })}
      {diagram.muscles.map((muscle, index) => {
        const muscleId = muscleForPartId(muscle.id);
        const intensity = muscleId ? resolveMuscleIntensity(muscleId, primarySet, secondarySet) : 'inactive';
        const fill = intensity === 'inactive' ? baseColor : activeColor;
        const fillOpacity = intensity === 'primary' ? 1 : intensity === 'secondary' ? secondaryOpacity : 1;
        const interactive = Boolean(
          muscleId
          && onMusclePress
          && (!selectableSet || selectableSet.has(muscleId)),
        );
        return (
          <Path
            key={bodyMuscleMapPathKey(diagramKey, 'visual', muscle, index)}
            d={muscle.d}
            fill={fill}
            fillOpacity={fillOpacity}
            stroke={outlineColor}
            strokeWidth={1}
            accessible={interactive}
            accessibilityLabel={interactive && muscleId ? muscleAccessibilityLabel?.(muscleId) : undefined}
            onPress={interactive && muscleId ? () => onMusclePress?.(muscleId) : undefined}
          />
        );
      })}
    </Svg>
  );
}

export function BodyMuscleMap({
  sex,
  primaryMuscles,
  secondaryMuscles = [],
  showSecondary = true,
  size = DEFAULT_SIZE,
  activeColor = '#3B82F6',
  secondaryOpacity = DEFAULT_SECONDARY_OPACITY,
  baseColor = 'rgba(255,255,255,0.14)',
  outlineColor = 'rgba(255,255,255,0.18)',
  onMusclePress,
  selectableMuscles,
  muscleAccessibilityLabel,
  gap = 6,
  frontOffsetX = 0,
  style,
}: BodyMuscleMapProps) {
  const anatomy = getBodyMuscleMapAnatomy(sex);
  const primarySet = new Set(primaryMuscles);
  const secondarySet = new Set(
    (showSecondary ? secondaryMuscles : []).filter((muscle) => !primarySet.has(muscle)),
  );
  const clampedSecondaryOpacity = Math.min(Math.max(secondaryOpacity, 0), 0.9);
  const selectableSet = selectableMuscles ? new Set(selectableMuscles) : null;

  const sharedProps = {
    primarySet,
    secondarySet,
    size,
    activeColor,
    secondaryOpacity: clampedSecondaryOpacity,
    baseColor,
    outlineColor,
    onMusclePress,
    selectableSet,
    muscleAccessibilityLabel,
  };

  return (
    <View style={[{ flexDirection: 'row', gap }, style]}>
      <View style={frontOffsetX ? { transform: [{ translateX: frontOffsetX }] } : undefined}>
        <DiagramView
          diagramKey={bodyMuscleMapDiagramKey(sex, 'front')}
          diagram={anatomy.front}
          {...sharedProps}
        />
      </View>
      <DiagramView
        diagramKey={bodyMuscleMapDiagramKey(sex, 'back')}
        diagram={anatomy.back}
        {...sharedProps}
      />
    </View>
  );
}
