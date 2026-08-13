import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card } from './Card';
import { Slash } from './Display';
import { Icon, type IconName } from './Icon';
import { colors, fonts, spacing } from '../../theme/tokens';

export type SmartAlertItem = {
  id: string;
  icon: IconName;
  title: string;
  description: string;
  onPress?: () => void;
};

/** Presentational slot only. Alert selection and business rules live elsewhere. */
export function SmartAlertsSection({
  title,
  items,
}: {
  title: string;
  items: SmartAlertItem[];
}) {
  if (items.length === 0) return null;

  return (
    <View style={{ paddingHorizontal: spacing[5.5], paddingBottom: spacing[4] }}>
      <Slash style={{ marginBottom: spacing[2.5] }}>{title}</Slash>
      <View style={{ gap: spacing[2] }}>
        {items.map((item) => (
          <Pressable key={item.id} onPress={item.onPress} disabled={!item.onPress}>
            {({ pressed }) => (
              <Card
                style={{
                  padding: spacing[4],
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing[3],
                  backgroundColor: pressed ? colors.surfacePressed : undefined,
                }}
              >
                <Icon name={item.icon} size={18} color={colors.warning} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                    {item.title}
                  </Text>
                  <Text
                    style={{
                      color: colors.textSecondary,
                      fontFamily: fonts.ui,
                      fontSize: 12.5,
                      lineHeight: 18,
                      marginTop: spacing[1],
                    }}
                  >
                    {item.description}
                  </Text>
                </View>
                {item.onPress ? (
                  <Icon name="chevron-right" size={14} color={colors.faint} />
                ) : null}
              </Card>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
