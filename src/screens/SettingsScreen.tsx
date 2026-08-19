import { useMemo, useState } from 'react';
import { View, ScrollView, Pressable, Modal, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { MonoLabel } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { SettingsSection } from '../components/ui/SettingsSection';
import { useAuth } from '../state/AuthContext';
import { colors, fonts } from '../theme/tokens';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../types/language';
import { normalizeLanguage } from '../i18n/normalizeLanguage';
import { changeLocalLanguage } from '../i18n/changeLocalLanguage';
import { changeLanguageForUser } from '../i18n/syncLanguage';
import { logError } from '../lib/logError';
import {
  UNITS_PREFERENCES,
  type UnitsPreference,
} from '../types/units';
import { writeStoredUnitsPreference } from '../units/unitsStorage';
import { changeUnitsForUser } from '../units/syncUnits';
import { getUnitsSummaryKey } from '../units/unitsPresentation';
import { useUnits } from '../state/UnitsContext';

type UnitsOptionCopy = {
  label: string;
  description: string;
};

export function SettingsScreen({
  onBack,
  onOpenEditProfile,
  onOpenSecurity,
  onOpenHelpCenter,
  onReportProblem,
  onSendSuggestion,
  onOpenDeleteAccount,
}: {
  onBack?: () => void;
  onOpenEditProfile?: () => void;
  onOpenSecurity?: () => void;
  onOpenHelpCenter?: () => void;
  onReportProblem?: () => void;
  onSendSuggestion?: () => void;
  onOpenDeleteAccount?: () => void;
}) {
  const { user, profile } = useAuth();
  const { t, i18n } = useTranslation(['common', 'settings']);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [langError, setLangError] = useState<string | null>(null);
  const [savingLang, setSavingLang] = useState<SupportedLanguage | null>(null);
  const [unitsPickerOpen, setUnitsPickerOpen] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [savingUnits, setSavingUnits] = useState<UnitsPreference | null>(null);
  const { preference: currentUnits, resolvedUnits } = useUnits();

  // `i18n.language` is the runtime source of truth — DO NOT read
  // `profile.preferences.language` here. That field will diverge from the
  // local i18n state while remote reconciliation is pending; picking the
  // profile value as "the truth" here creates a flicker on cold start. Normalize
  // to be safe against any transient state during Fast Refresh / tests.
  const currentLang = normalizeLanguage(i18n.language);

  // The native language names ("Português", "English", "Español") are
  // rendered identically in every locale — they live in each settings.json
  // so future locale-specific display tweaks stay in the translation layer,
  // not sprinkled through code.
  const languageOptions = useMemo(
    () =>
      t('settings:language.options', { returnObjects: true }) as Record<
        SupportedLanguage,
        string
      >,
    [t],
  );

  const unitsOptions = useMemo(
    () =>
      t('settings:units.options', { returnObjects: true }) as Record<
        UnitsPreference,
        UnitsOptionCopy
      >,
    [t],
  );

  const themeLabel =
    profile?.preferences.theme === 'dark'
      ? t('settings:values.darkTheme')
      : profile?.preferences.theme ?? '—';
  const unitsLabel = t(getUnitsSummaryKey(currentUnits, resolvedUnits));
  const appVersion = Constants.expoConfig?.version;
  const appVersionLabel = appVersion ? `v${appVersion}` : '—';

  const handleSelectLanguage = async (next: SupportedLanguage) => {
    setLangError(null);
    if (next === currentLang) {
      setLangPickerOpen(false);
      return;
    }
    setSavingLang(next);
    try {
      // Authenticated path goes through syncLanguage. The awaited part is
      // fast (local i18n + AsyncStorage + pending write). The remote push is
      // returned as a background promise — DO NOT await it here: the Firebase
      // JS SDK leaves updateDoc's promise pending indefinitely while offline,
      // which would freeze the picker forever. Pre-auth (`user === null`)
      // keeps the local-only fast path.
      if (user) {
        const { remote } = await changeLanguageForUser({ uid: user.uid, next });
        setLangPickerOpen(false);
        // Fire-and-track: the sheet is already closed. When the server
        // eventually responds, we only need to log — the rollback (if any)
        // already happened inside syncLanguage. A toast layer will pick this
        // up in a later phase; for now, logging is enough observability.
        remote.then((outcome) => {
          if (outcome.status === 'rolled-back') {
            logError(
              'settings:remote-language-rolled-back',
              outcome.error,
              { uid: user.uid, attempted: next, previous: currentLang },
            );
          }
        });
      } else {
        await changeLocalLanguage(next);
        setLangPickerOpen(false);
      }
    } catch (err) {
      logError('settings:change-language', err, {
        next,
        previous: currentLang,
        authenticated: !!user,
      });
      setLangError(t('settings:language.errors.changeFailed'));
    } finally {
      setSavingLang(null);
    }
  };

  const handleSelectUnits = async (next: UnitsPreference) => {
    setUnitsError(null);
    if (next === currentUnits) {
      setUnitsPickerOpen(false);
      return;
    }

    const previous = currentUnits;
    setSavingUnits(next);

    try {
      if (user) {
        const { remote } = await changeUnitsForUser({ uid: user.uid, next });
        setUnitsPickerOpen(false);
        remote.then((outcome) => {
          if (outcome.status === 'rolled-back') {
            logError('settings:remote-units-rolled-back', outcome.error, {
              uid: user.uid,
              attempted: next,
              previous,
            });
          }
        });
      } else {
        await writeStoredUnitsPreference(next);
        setUnitsPickerOpen(false);
      }
    } catch (err) {
      logError('settings:change-units', err, {
        next,
        previous,
        authenticated: !!user,
      });
      setUnitsError(t('settings:units.errors.changeFailed'));
    } finally {
      setSavingUnits(null);
    }
  };

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View
          style={{
            paddingHorizontal: 22,
            paddingBottom: 8,
            paddingTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('common:actions.back')}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.09)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="arrow-left" size={17} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <MonoLabel>{t('settings:screenTitle').toUpperCase()}</MonoLabel>
          </View>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingTop: 14, paddingBottom: 28 }}
          showsVerticalScrollIndicator={false}
        >
          <SettingsSection
            title={t('settings:sections.account').toUpperCase()}
            items={[
              { icon: 'user', label: t('settings:items.editProfile'), onPress: onOpenEditProfile },
              { icon: 'shield', label: t('settings:items.security'), onPress: onOpenSecurity },
            ]}
          />

          <SettingsSection
            title={t('settings:sections.notifications').toUpperCase()}
            items={[
              { icon: 'bell', label: t('settings:items.notifications'), onPress: () => {} },
              { icon: 'timer', label: t('settings:items.timersAndSounds'), onPress: () => {} },
            ]}
          />

          <SettingsSection
            title={t('settings:sections.preferences').toUpperCase()}
            items={[
              { icon: 'moon', label: t('settings:items.theme'), value: themeLabel, onPress: () => {} },
              {
                icon: 'globe',
                label: t('settings:language.title'),
                value: languageOptions[currentLang],
                onPress: () => {
                  setLangError(null);
                  setLangPickerOpen(true);
                },
              },
              {
                icon: 'ruler',
                label: t('settings:units.title'),
                value: unitsLabel,
                onPress: () => {
                  setUnitsError(null);
                  setUnitsPickerOpen(true);
                },
              },
            ]}
          />

          <SettingsSection
            title={t('settings:sections.privacyAndData').toUpperCase()}
            items={[
              { icon: 'shield', label: t('settings:items.privacyPolicy'), onPress: () => {} },
              { icon: 'file-text', label: t('settings:items.termsOfUse'), onPress: () => {} },
              { icon: 'check', label: t('settings:items.acceptedConsents'), onPress: () => {} },
              { icon: 'download', label: t('settings:items.exportData'), onPress: () => {} },
              {
                icon: 'trash',
                label: t('settings:items.deleteAccount'),
                danger: true,
                onPress: onOpenDeleteAccount ?? (() => {}),
              },
            ]}
          />

          <SettingsSection
            title={t('settings:sections.support').toUpperCase()}
            items={[
              { icon: 'help-circle', label: t('settings:items.helpCenter'), onPress: onOpenHelpCenter },
              { icon: 'alert-triangle', label: t('settings:items.reportProblem'), onPress: onReportProblem },
              { icon: 'message', label: t('settings:items.sendSuggestion'), onPress: onSendSuggestion },
            ]}
          />

          <SettingsSection
            title={t('settings:sections.about').toUpperCase()}
            items={[
              { icon: 'info', label: t('settings:items.version'), value: appVersionLabel },
              { icon: 'file-text', label: t('settings:items.licenses'), onPress: () => {} },
            ]}
          />
        </ScrollView>
      </SafeAreaView>

      <LanguagePickerSheet
        visible={langPickerOpen}
        current={currentLang}
        options={languageOptions}
        savingLang={savingLang}
        error={langError}
        onSelect={handleSelectLanguage}
        onDismiss={() => setLangPickerOpen(false)}
        cancelLabel={t('common:actions.cancel')}
        title={t('settings:language.chooseTitle')}
      />
      <UnitsPickerSheet
        visible={unitsPickerOpen}
        current={currentUnits}
        options={unitsOptions}
        savingUnits={savingUnits}
        error={unitsError}
        onSelect={handleSelectUnits}
        onDismiss={() => setUnitsPickerOpen(false)}
        cancelLabel={t('common:actions.cancel')}
        title={t('settings:units.chooseTitle')}
      />
    </ScreenBg>
  );
}

function LanguagePickerSheet({
  visible,
  current,
  options,
  savingLang,
  error,
  onSelect,
  onDismiss,
  cancelLabel,
  title,
}: {
  visible: boolean;
  current: SupportedLanguage;
  options: Record<SupportedLanguage, string>;
  savingLang: SupportedLanguage | null;
  error: string | null;
  onSelect: (next: SupportedLanguage) => void;
  onDismiss: () => void;
  cancelLabel: string;
  title: string;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable
        onPress={onDismiss}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: '#0a0620',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: 1,
            borderColor: 'rgba(255,255,255,0.09)',
            paddingBottom: 24,
          }}
        >
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: 18,
              paddingBottom: 14,
              borderBottomWidth: 1,
              borderColor: 'rgba(255,255,255,0.06)',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 11,
                letterSpacing: 1.8,
                color: colors.faint,
              }}
            >
              {title.toUpperCase()}
            </Text>
            <Pressable onPress={onDismiss} hitSlop={10}>
              <Text
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  letterSpacing: 1.5,
                  color: colors.faint,
                }}
              >
                {cancelLabel.toUpperCase()}
              </Text>
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: 12, paddingTop: 6 }}>
            {SUPPORTED_LANGUAGES.map((lang) => {
              const active = lang === current;
              const busy = savingLang === lang;
              return (
                <Pressable
                  key={lang}
                  onPress={() => onSelect(lang)}
                  disabled={savingLang !== null}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, busy }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingVertical: 16,
                    paddingHorizontal: 14,
                    marginVertical: 3,
                    borderRadius: 12,
                    backgroundColor: active
                      ? 'rgba(11,112,249,0.16)'
                      : pressed
                        ? 'rgba(255,255,255,0.04)'
                        : 'transparent',
                    borderWidth: 1,
                    borderColor: active ? '#0b70f9' : 'rgba(255,255,255,0.06)',
                    opacity: savingLang !== null && !busy ? 0.4 : 1,
                  })}
                >
                  <View style={{ width: 22, alignItems: 'center' }}>
                    {active ? (
                      <Icon name="check" size={16} color={colors.accentHi} />
                    ) : null}
                  </View>
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: fonts.uiSemi,
                      fontSize: 15,
                      color: active ? '#fff' : 'rgba(255,255,255,0.85)',
                    }}
                  >
                    {options[lang]}
                  </Text>
                  <Text
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 10,
                      letterSpacing: 1.5,
                      color: colors.faint,
                    }}
                  >
                    {lang.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {error ? (
            <View
              style={{
                marginTop: 6,
                marginHorizontal: 14,
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: 'rgba(255,86,86,0.10)',
                borderWidth: 1,
                borderColor: 'rgba(255,86,86,0.32)',
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.ui,
                  fontSize: 13,
                  color: '#ffb3b3',
                }}
              >
                {error}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function UnitsPickerSheet({
  visible,
  current,
  options,
  savingUnits,
  error,
  onSelect,
  onDismiss,
  cancelLabel,
  title,
}: {
  visible: boolean;
  current: UnitsPreference;
  options: Record<UnitsPreference, UnitsOptionCopy>;
  savingUnits: UnitsPreference | null;
  error: string | null;
  onSelect: (next: UnitsPreference) => void;
  onDismiss: () => void;
  cancelLabel: string;
  title: string;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable
        onPress={onDismiss}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: '#0a0620',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: 1,
            borderColor: 'rgba(255,255,255,0.09)',
            paddingBottom: 24,
          }}
        >
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: 18,
              paddingBottom: 14,
              borderBottomWidth: 1,
              borderColor: 'rgba(255,255,255,0.06)',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 11,
                letterSpacing: 1.8,
                color: colors.faint,
              }}
            >
              {title.toUpperCase()}
            </Text>
            <Pressable onPress={onDismiss} hitSlop={10}>
              <Text
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  letterSpacing: 1.5,
                  color: colors.faint,
                }}
              >
                {cancelLabel.toUpperCase()}
              </Text>
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: 12, paddingTop: 6 }}>
            {UNITS_PREFERENCES.map((preference) => {
              const active = preference === current;
              const busy = savingUnits === preference;
              const option = options[preference];

              return (
                <Pressable
                  key={preference}
                  onPress={() => onSelect(preference)}
                  disabled={savingUnits !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`${option.label}. ${option.description}`}
                  accessibilityState={{ selected: active, busy }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingVertical: 14,
                    paddingHorizontal: 14,
                    marginVertical: 3,
                    borderRadius: 12,
                    backgroundColor: active
                      ? 'rgba(11,112,249,0.16)'
                      : pressed
                        ? 'rgba(255,255,255,0.04)'
                        : 'transparent',
                    borderWidth: 1,
                    borderColor: active ? '#0b70f9' : 'rgba(255,255,255,0.06)',
                    opacity: savingUnits !== null && !busy ? 0.4 : 1,
                  })}
                >
                  <View style={{ width: 22, alignItems: 'center' }}>
                    {active ? (
                      <Icon name="check" size={16} color={colors.accentHi} />
                    ) : null}
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text
                      style={{
                        fontFamily: fonts.uiSemi,
                        fontSize: 15,
                        color: active ? '#fff' : 'rgba(255,255,255,0.85)',
                      }}
                    >
                      {option.label}
                    </Text>
                    <Text
                      style={{
                        fontFamily: fonts.ui,
                        fontSize: 12,
                        color: colors.faint,
                      }}
                    >
                      {option.description}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {error ? (
            <View
              style={{
                marginTop: 6,
                marginHorizontal: 14,
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: 'rgba(255,86,86,0.10)',
                borderWidth: 1,
                borderColor: 'rgba(255,86,86,0.32)',
              }}
            >
              <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: '#ffb3b3' }}>
                {error}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
