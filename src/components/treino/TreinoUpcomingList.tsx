import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';

export interface TreinoUpcomingListItem {
  key: string;
  /** "TER 06" (fixed mode) or the session letter (flexible mode) — already formatted by the caller. */
  dayLabel: string;
  title: string;
  meta: string;
  accessibilityLabel: string;
  onPress: () => void;
}

/** "Próximos treinos" (Treino · Opção B §3.2.E) — plain rows, no card background, hairline between. */
export function TreinoUpcomingList({
  title,
  items,
}: {
  title: string;
  items: TreinoUpcomingListItem[];
}) {
  const { theme } = useTheme();
  if (items.length === 0) return null;

  return (
    <View style={{ paddingHorizontal: 22, marginTop: 40 }}>
      <MonoLabel style={{ marginBottom: 16 }}>{title}</MonoLabel>
      {items.map((item, index) => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={item.accessibilityLabel}
          onPress={item.onPress}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 14,
            borderTopWidth: index === 0 ? 0 : 1,
            borderTopColor: theme.colors.divider,
          }}
        >
          <Text
            numberOfLines={1}
            style={{ width: 44, fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 1, color: theme.colors.textFaint }}
          >
            {item.dayLabel}
          </Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14.5, color: theme.colors.textPrimary }}>
              {item.title}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textFaint, marginTop: 3 }}>
              {item.meta}
            </Text>
          </View>
          <Icon name="chevron-right" size={15} color={theme.colors.textFaint} />
        </Pressable>
      ))}
    </View>
  );
}
