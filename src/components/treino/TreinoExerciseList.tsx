import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { MonoLabel } from '../ui/Display';
import { useTheme } from '../../theme';

export interface TreinoExerciseListItem {
  id: string;
  name: string;
}

function ExerciseRow({ index, name, isFirst }: { index: number; name: string; isFirst: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 13,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: theme.colors.divider,
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          borderWidth: 1,
          borderColor: theme.colors.borderStrong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.textMuted }}
        >
          {String(index + 1).padStart(2, '0')}
        </Text>
      </View>
      <Text
        numberOfLines={2}
        style={{
          flex: 1,
          fontFamily: theme.fonts.uiSemi,
          fontSize: 14.5,
          color: theme.colors.textPrimary,
        }}
      >
        {name}
      </Text>
    </View>
  );
}

/**
 * "Exercícios" (Treino · Opção B §3.2.D). Shows the first `visibleCount`
 * exercises; the rest reveal with a 250ms fade + 14px rise (collapse is
 * instant — the spec only describes an entrance animation).
 */
export function TreinoExerciseList({
  title,
  exercises,
  visibleCount = 4,
  showAllLabel,
  showLessLabel,
}: {
  title: string;
  exercises: TreinoExerciseListItem[];
  visibleCount?: number;
  showAllLabel: (count: number) => string;
  showLessLabel: string;
}) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const revealAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!expanded) return;
    Animated.timing(revealAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [expanded, revealAnim]);

  if (exercises.length === 0) return null;

  const visible = exercises.slice(0, visibleCount);
  const hidden = exercises.slice(visibleCount);

  return (
    <View style={{ paddingHorizontal: 22, marginTop: 40 }}>
      <MonoLabel style={{ marginBottom: 16 }}>{title}</MonoLabel>
      {visible.map((exercise, index) => (
        <ExerciseRow
          key={`${exercise.id}-${index}`}
          index={index}
          name={exercise.name}
          isFirst={index === 0}
        />
      ))}
      {expanded && (
        <Animated.View
          style={{
            opacity: revealAnim,
            transform: [
              { translateY: revealAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            ],
          }}
        >
          {hidden.map((exercise, offset) => (
            <ExerciseRow
              key={`${exercise.id}-${visibleCount + offset}`}
              index={visibleCount + offset}
              name={exercise.name}
              isFirst={false}
            />
          ))}
        </Animated.View>
      )}
      {hidden.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => {
            if (expanded) revealAnim.setValue(0);
            setExpanded((value) => !value);
          }}
          hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
          style={{ marginTop: 12, alignItems: 'center', paddingVertical: 6 }}
        >
          <Text
            style={{
              fontFamily: theme.fonts.uiSemi,
              fontSize: 13.5,
              color: theme.colors.textSecondary,
            }}
          >
            {expanded ? showLessLabel : showAllLabel(exercises.length)}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
