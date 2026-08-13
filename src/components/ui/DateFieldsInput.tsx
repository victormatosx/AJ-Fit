import { Animated, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MonoLabel } from './Display';
import { colors, fonts } from '../../theme/tokens';

/**
 * DIA/MÊS/ANO input row. Shared by the onboarding birth-date question and
 * the Avaliação Física "data da avaliação" fields — same mechanics, same
 * visual language, driven by `useDateParts`.
 */
export function DateFieldsInput({
  day,
  month,
  year,
  onDay,
  onMonth,
  onYear,
  label,
  error,
  shakeX,
  placeholder = '0',
}: {
  day: string;
  month: string;
  year: string;
  onDay: (v: string) => void;
  onMonth: (v: string) => void;
  onYear: (v: string) => void;
  label?: string;
  error?: boolean;
  shakeX?: Animated.Value;
  placeholder?: string;
}) {
  const { t } = useTranslation('common');
  // These are visible mono-style labels rendered ALL CAPS by design. The
  // translation stores natural case ("Dia"/"Day"/"Día"), so screen readers
  // announce it correctly; the visual uppercase is a presentation concern
  // handled here — never mix casing into the JSON.
  const dayLabel = t('accessibility.day').toUpperCase();
  const monthLabel = t('accessibility.month').toUpperCase();
  const yearLabel = t('accessibility.year').toUpperCase();
  return (
    <View>
      {label && (
        <MonoLabel color={error ? '#f0563f' : colors.faint} style={{ marginBottom: 6 }}>
          {label}
        </MonoLabel>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <DateBox value={day} onChange={onDay} error={error} shakeX={shakeX} flex={1} maxLength={2} placeholder={placeholder} accessibilityLabel={dayLabel} />
        <DateBox value={month} onChange={onMonth} error={error} shakeX={shakeX} flex={1} maxLength={2} placeholder={placeholder} accessibilityLabel={monthLabel} />
        <DateBox value={year} onChange={onYear} error={error} shakeX={shakeX} flex={1.3} maxLength={4} placeholder={placeholder} accessibilityLabel={yearLabel} />
      </View>
      <View style={{ flexDirection: 'row', marginTop: 4 }}>
        <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, color: colors.faint }}>
          {dayLabel}
        </Text>
        <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, color: colors.faint }}>
          {monthLabel}
        </Text>
        <Text style={{ flex: 1.3, textAlign: 'center', fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, color: colors.faint }}>
          {yearLabel}
        </Text>
      </View>
    </View>
  );
}

function DateBox({
  value,
  onChange,
  error,
  shakeX,
  flex,
  maxLength,
  placeholder,
  accessibilityLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  shakeX?: Animated.Value;
  flex: number;
  maxLength: number;
  placeholder: string;
  accessibilityLabel: string;
}) {
  const Wrapper = shakeX ? Animated.View : View;
  return (
    <Wrapper style={{ flex, transform: shakeX ? [{ translateX: shakeX }] : undefined }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: 12,
          backgroundColor: 'rgba(255,255,255,0.04)',
          borderWidth: 1,
          borderColor: error ? '#f0563f' : 'rgba(255,255,255,0.09)',
        }}
      >
        <TextInput
          value={value}
          onChangeText={(v) => onChange(v.replace(/[^0-9]/g, ''))}
          placeholder={placeholder}
          accessibilityLabel={accessibilityLabel}
          placeholderTextColor={colors.faint}
          keyboardType="number-pad"
          maxLength={maxLength}
          style={{
            flex: 1,
            minWidth: 0,
            color: '#fff',
            fontFamily: fonts.display,
            fontSize: 18,
            padding: 0,
            textAlign: 'center',
          }}
        />
      </View>
    </Wrapper>
  );
}
