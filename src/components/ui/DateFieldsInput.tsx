import { Animated, Text, TextInput, View } from 'react-native';
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
}) {
  return (
    <View>
      {label && (
        <MonoLabel color={error ? '#f0563f' : colors.faint} style={{ marginBottom: 6 }}>
          {label}
        </MonoLabel>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <DateBox value={day} onChange={onDay} error={error} shakeX={shakeX} flex={1} maxLength={2} />
        <DateBox value={month} onChange={onMonth} error={error} shakeX={shakeX} flex={1} maxLength={2} />
        <DateBox value={year} onChange={onYear} error={error} shakeX={shakeX} flex={1.3} maxLength={4} />
      </View>
      <View style={{ flexDirection: 'row', marginTop: 4 }}>
        <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, color: colors.faint }}>
          DIA
        </Text>
        <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, color: colors.faint }}>
          MÊS
        </Text>
        <Text style={{ flex: 1.3, textAlign: 'center', fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, color: colors.faint }}>
          ANO
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
}: {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  shakeX?: Animated.Value;
  flex: number;
  maxLength: number;
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
          placeholder="0"
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
