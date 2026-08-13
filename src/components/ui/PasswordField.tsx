import { Pressable, Text, TextInput, View } from 'react-native';
import { Icon } from './Icon';
import { colors, fonts, spacing, typography } from '../../theme/tokens';

type Props = {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  onToggleVisibility: () => void;
  toggleAccessibilityLabel: string;
  editable?: boolean;
  textContentType?: 'password' | 'newPassword';
  returnKeyType?: 'next' | 'done';
  onSubmitEditing?: () => void;
};

export function PasswordField({
  label,
  placeholder,
  value,
  onChangeText,
  visible,
  onToggleVisibility,
  toggleAccessibilityLabel,
  editable = true,
  textContentType = 'password',
  returnKeyType,
  onSubmitEditing,
}: Props) {
  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={{ ...typography.labelStrong, color: colors.textSecondary }}>
        {label.toUpperCase()}
      </Text>
      <View
        style={{
          height: 56,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing[3],
          paddingHorizontal: spacing[4],
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          backgroundColor: colors.surfaceRaised,
          opacity: editable ? 1 : 0.45,
        }}
      >
        <Icon name="lock" size={18} color={colors.faint} />
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          secureTextEntry={!visible}
          editable={editable}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType={textContentType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          style={{ flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: 15 }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={toggleAccessibilityLabel}
          accessibilityState={{ expanded: visible, disabled: !editable }}
          disabled={!editable}
          hitSlop={10}
          onPress={onToggleVisibility}
          style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
        >
          <Icon name="eye" size={18} color={visible ? colors.accentHi : colors.faint} />
        </Pressable>
      </View>
    </View>
  );
}
