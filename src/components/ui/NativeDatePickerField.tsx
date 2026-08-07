import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { MonoLabel } from './Display';
import { colors, fonts } from '../../theme/tokens';

type Props = {
  label: string;
  value: Date;
  onChange: (date: Date) => void;
  maximumDate?: Date;
  error?: boolean;
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const candidate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isoDate(candidate) === value ? candidate : null;
}

export function NativeDatePickerField({
  label,
  value,
  onChange,
  maximumDate,
  error = false,
}: Props) {
  const { t, i18n } = useTranslation('common');
  const [iosOpen, setIosOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(value);
  const [webValue, setWebValue] = useState(isoDate(value));

  useEffect(() => {
    if (!iosOpen) setDraftDate(value);
    setWebValue(isoDate(value));
  }, [iosOpen, value]);

  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode: 'date',
        display: 'default',
        maximumDate,
        positiveButton: { label: t('actions.confirm') },
        negativeButton: { label: t('actions.cancel') },
        onValueChange: (_event, selectedDate) => onChange(startOfDay(selectedDate)),
      });
      return;
    }

    setDraftDate(value);
    setIosOpen(true);
  };

  const formattedDate = new Intl.DateTimeFormat(i18n.language, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(value);

  return (
    <View>
      <MonoLabel color={error ? colors.danger : colors.faint} style={{ marginBottom: 6 }}>
        {label}
      </MonoLabel>

      {Platform.OS === 'web' ? (
        <View
          style={{
            height: 50,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: error ? colors.danger : colors.borderStrong,
            backgroundColor: colors.surfaceRaised,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            gap: 10,
          }}
        >
          <Icon name="calendar" size={17} color={colors.accentHi} />
          <TextInput
            accessibilityLabel={label}
            value={webValue}
            onChangeText={(next) => {
              setWebValue(next);
              const parsed = parseIsoDate(next);
              if (parsed && (!maximumDate || parsed <= maximumDate)) onChange(parsed);
            }}
            style={{ flex: 1, color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}
          />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${formattedDate}`}
          onPress={open}
          style={({ pressed }) => ({
            height: 50,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: error ? colors.danger : colors.borderStrong,
            backgroundColor: pressed ? colors.surfacePressed : colors.surfaceRaised,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            gap: 10,
          })}
        >
          <Icon name="calendar" size={17} color={colors.accentHi} />
          <Text
            numberOfLines={1}
            style={{ flex: 1, color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}
          >
            {formattedDate}
          </Text>
          <Icon name="chevron-down" size={15} color={colors.faint} />
        </Pressable>
      )}

      {Platform.OS === 'ios' && (
        <Modal
          visible={iosOpen}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setIosOpen(false)}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('actions.cancel')}
            onPress={() => setIosOpen(false)}
            style={{
              flex: 1,
              justifyContent: 'flex-end',
              backgroundColor: colors.overlayStrong,
            }}
          >
            <Pressable
              accessibilityRole="none"
              onPress={(event) => event.stopPropagation()}
              style={{
                borderTopLeftRadius: 18,
                borderTopRightRadius: 18,
                borderWidth: 1,
                borderColor: colors.borderStrong,
                backgroundColor: colors.bg2,
                paddingHorizontal: 18,
                paddingTop: 10,
                paddingBottom: 20,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: 44,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIosOpen(false)}
                  style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}
                >
                  <Text style={{ color: colors.textSecondary, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                    {t('actions.cancel')}
                  </Text>
                </Pressable>
                <MonoLabel>{label}</MonoLabel>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onChange(startOfDay(draftDate));
                    setIosOpen(false);
                  }}
                  style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}
                >
                  <Text style={{ color: colors.accentHi, fontFamily: fonts.uiBold, fontSize: 14 }}>
                    {t('actions.confirm')}
                  </Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={draftDate}
                mode="date"
                display="spinner"
                maximumDate={maximumDate}
                themeVariant="dark"
                textColor={colors.text}
                onValueChange={(_event, selectedDate) => setDraftDate(startOfDay(selectedDate))}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}
