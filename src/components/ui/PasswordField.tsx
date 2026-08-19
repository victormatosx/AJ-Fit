import { Pressable, Text, TextInput, View } from 'react-native';
import { Icon } from './Icon';
import { spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';

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
  const { theme } = useTheme();

  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={{ ...theme.typography.labelStrong, color: theme.colors.inputLabel }}>
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
          borderColor: theme.colors.inputBorder,
          backgroundColor: theme.colors.inputBackground,
          opacity: editable ? 1 : theme.opacity.inputDisabled,
        }}
      >
        <Icon name="lock" size={18} color={theme.colors.inputIcon} />
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.inputPlaceholder}
          secureTextEntry={!visible}
          editable={editable}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType={textContentType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          style={{
            flex: 1,
            color: theme.colors.inputText,
            fontFamily: theme.fonts.ui,
            fontSize: 15,
          }}
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
          <Icon
            name="eye"
            size={18}
            color={visible ? theme.colors.primaryEmphasis : theme.colors.inputIcon}
          />
        </Pressable>
      </View>
    </View>
  );
}
