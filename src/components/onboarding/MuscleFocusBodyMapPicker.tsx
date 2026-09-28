import { useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BodyMuscleMap } from '../fitness/BodyMuscleMap';
import { BODY_MUSCLE_MAP_MALE } from '../../data/bodyMuscleMapAnatomy';
import { useTheme } from '../../theme';
import type { MuscleId } from '../../types/exercise';
import {
  SELECTABLE_MUSCLE_FOCUS_MAP_MUSCLES,
  mapMusclesForVisualGroups,
  toggleMuscleFocusVisualGroup,
  visualGroupForMapMuscle,
  type MuscleFocusVisualGroup,
} from '../../onboarding/muscleFocusBodyMap';

// Both silhouettes share one viewBox (front/back), so their height/width
// ratio is a single constant derived at runtime instead of hardcoded, so it
// stays correct if the source anatomy is ever redrawn at a new resolution.
const [, , DIAGRAM_VB_WIDTH, DIAGRAM_VB_HEIGHT] = BODY_MUSCLE_MAP_MALE.front.viewBox
  .split(' ')
  .map(Number);
const DIAGRAM_ASPECT_RATIO = DIAGRAM_VB_HEIGHT / DIAGRAM_VB_WIDTH;

const MAP_GAP = 16;
const MIN_MAP_SIZE = 120;
const MAX_MAP_SIZE = 260;

export function MuscleFocusBodyMapPicker({
  value,
  onChange,
  maxSelections,
}: {
  value: MuscleFocusVisualGroup[];
  onChange: (value: MuscleFocusVisualGroup[]) => void;
  maxSelections: number;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
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
        borderColor: theme.colors.choiceBorder,
        backgroundColor: theme.colors.surfaceElevated,
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
          primaryMuscles={selectedMapMuscles}
          showSecondary={false}
          size={mapSize}
          gap={MAP_GAP}
          activeColor={theme.colors.primaryEmphasis}
          baseColor={theme.colors.choiceBorder}
          outlineColor={theme.colors.textMuted}
          selectableMuscles={SELECTABLE_MUSCLE_FOCUS_MAP_MUSCLES}
          muscleAccessibilityLabel={accessibilityLabel}
          onMusclePress={(muscle) => onChange(
            toggleMuscleFocusVisualGroup(value, muscle, maxSelections),
          )}
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
          color: selectedNames ? theme.colors.text : theme.colors.textMuted,
        }}
      >
        {selectedNames || t('muscleFocus.noneSelected')}
      </Text>
    </View>
  );
}
