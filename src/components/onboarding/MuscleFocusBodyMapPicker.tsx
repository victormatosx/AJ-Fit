import { useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BodyMuscleMap } from '../fitness/BodyMuscleMap';
import { useAjFunnelDirector } from './AjFunnelStage';
import { useTheme } from '../../theme';
import type { Sex } from '../../state/AppState';
import type { MuscleId } from '../../types/exercise';
import {
  SELECTABLE_MUSCLE_FOCUS_MAP_MUSCLES,
  mapMusclesForVisualGroups,
  toggleMuscleFocusVisualGroup,
  visualGroupForMapMuscle,
  type MuscleFocusVisualGroup,
} from '../../onboarding/muscleFocusBodyMap';

// All four @musclemap/assets v1.0.1 diagrams share `0 0 1024 1536`.
// Keep layout independent from either sex-specific anatomy export.
const DIAGRAM_ASPECT_RATIO = 1536 / 1024;

const MAP_GAP = 16;
const MIN_MAP_SIZE = 120;
const MAX_MAP_SIZE = 260;

export function MuscleFocusBodyMapPicker({
  sex,
  value,
  onChange,
  maxSelections,
}: {
  sex: Sex;
  value: MuscleFocusVisualGroup[];
  onChange: (value: MuscleFocusVisualGroup[]) => void;
  maxSelections: number;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const aj = useAjFunnelDirector();
  const selectedMapMuscles = mapMusclesForVisualGroups(value);

  // The map row's actual box (not the window) drives sizing, since the
  // leftover space between the title and the CTA button varies with title
  // length, locale, and device height. `stretchAnswerControl` on
  // `QuestionStepScreen` makes this component's flex:1 wrapper fill exactly
  // that leftover space, so measuring it here gives the true budget.
  const [mapAreaSize, setMapAreaSize] = useState<{ width: number; height: number } | null>(null);
  const onMapAreaLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setMapAreaSize((current) => (
      current && current.width === width && current.height === height ? current : { width, height }
    ));
  };

  const widthBudget = mapAreaSize ? (mapAreaSize.width - MAP_GAP) / 2 : MIN_MAP_SIZE;
  const heightBudget = mapAreaSize ? mapAreaSize.height / DIAGRAM_ASPECT_RATIO : MIN_MAP_SIZE;
  const mapSize = Math.round(
    Math.min(MAX_MAP_SIZE, Math.max(MIN_MAP_SIZE, Math.min(widthBudget, heightBudget))),
  );

  const accessibilityLabel = (muscle: MuscleId) => {
    const group = visualGroupForMapMuscle(muscle);
    return group ? t(`muscleFocus.groups.${group}`) : '';
  };

  const selectedNames = value
    .map((group) => t(`muscleFocus.groups.${group}`))
    .join(' · ');

  return (
    <View
      style={{
        flex: 1,
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: 16,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surfaceMuted,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 10,
            letterSpacing: 1.3,
            color: theme.colors.textMuted,
          }}
        >
          {t('muscleFocus.selection').toUpperCase()}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 11,
            letterSpacing: 1.1,
            color: theme.colors.primaryEmphasis,
          }}
        >
          {value.length}/{maxSelections}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: MAP_GAP, alignSelf: 'center', marginBottom: 6 }}>
        <Text
          style={{
            width: mapSize,
            textAlign: 'center',
            fontFamily: theme.fonts.mono,
            fontSize: 10,
            letterSpacing: 1.4,
            color: theme.colors.textFaint,
          }}
        >
          {t('muscleFocus.front').toUpperCase()}
        </Text>
        <Text
          style={{
            width: mapSize,
            textAlign: 'center',
            fontFamily: theme.fonts.mono,
            fontSize: 10,
            letterSpacing: 1.4,
            color: theme.colors.textFaint,
          }}
        >
          {t('muscleFocus.back').toUpperCase()}
        </Text>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onLayout={onMapAreaLayout}>
        <BodyMuscleMap
          sex={sex}
          primaryMuscles={selectedMapMuscles}
          showSecondary={false}
          size={mapSize}
          gap={MAP_GAP}
          activeColor={theme.colors.primaryEmphasis}
          baseColor={theme.colors.choiceBorder}
          // White, per the calibrated reference map — the silhouette has to
          // read as an outline drawing, not as a dim shape.
          outlineColor={theme.colors.textPrimary}
          selectableMuscles={SELECTABLE_MUSCLE_FOCUS_MAP_MUSCLES}
          muscleAccessibilityLabel={accessibilityLabel}
          onMusclePress={(muscle) => {
            const next = toggleMuscleFocusVisualGroup(value, muscle, maxSelections);
            // AJ watches the map and reacts to the gesture. Presentation only:
            // the selection itself is `toggleMuscleFocusVisualGroup`'s, with
            // the same max it always had.
            aj.setLook([0, 2.2]);
            aj.play(next.length > value.length ? 'hop' : 'nod');
            onChange(next);
          }}
        />
      </View>

      <Text
        accessibilityLiveRegion="polite"
        style={{
          minHeight: 22,
          marginTop: 10,
          textAlign: 'center',
          fontFamily: theme.fonts.uiSemi,
          fontSize: 14,
          color: selectedNames ? theme.colors.textPrimary : theme.colors.textMuted,
        }}
      >
        {selectedNames || t('muscleFocus.noneSelected')}
      </Text>
    </View>
  );
}
