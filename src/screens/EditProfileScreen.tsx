import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import { Display, MonoLabel, Slash } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { colors, fonts } from '../theme/tokens';
import { useAuth } from '../state/AuthContext';
import { useUnits } from '../state/UnitsContext';
import { updateUserProfile } from '../services/userProfile';
import {
  cmToFeetInches,
  feetInchesToCm,
} from '../units/heightConversions';
import {
  deleteProfilePhoto,
  compressProfilePhoto,
  uploadProfilePhoto,
  type LocalProfilePhoto,
} from '../services/profilePhoto';
import { parseDateParts } from '../lib/dateUtils';
import {
  DISPLAY_NAME_MAX_LENGTH,
  normalizeDisplayName,
  validateDisplayName,
  validateProfileBirthDate,
  validateProfileHeight,
  type BirthDateError,
  type DisplayNameError,
  type HeightError,
} from '../lib/userProfileValidation';
import { logError } from '../lib/logError';
import { useScreenFocusEffect } from '../state/ScreenActivity';

type PendingPhoto = LocalProfilePhoto | null | undefined;

function dateParts(date: Date | null) {
  return date
    ? {
        day: String(date.getDate()).padStart(2, '0'),
        month: String(date.getMonth() + 1).padStart(2, '0'),
        year: String(date.getFullYear()),
      }
    : { day: '', month: '', year: '' };
}

function calendarKey(date: Date | null): string {
  return date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : '';
}

function selectedAsset(result: ImagePicker.ImagePickerResult): LocalProfilePhoto | null {
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType,
    fileSize: asset.fileSize,
    width: asset.width,
    height: asset.height,
  };
}

export function EditProfileScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation(['profile', 'common']);
  const { user, profile, questionnaire, refreshProfile } = useAuth();
  const { resolvedUnits } = useUnits();
  const athleteFallback = t('profile:fallback.athlete');
  const savedName =
    profile?.profile.name?.trim() ||
    user?.displayName?.trim() ||
    user?.email?.split('@')[0] ||
    '';
  const email = profile?.profile.email || user?.email || '';
  const savedBirthDate =
    profile?.profile.birthDate?.toDate() ?? questionnaire?.answers.birthDate ?? null;
  const sinceYear = profile?.metadata.createdAt
    ? String(profile.metadata.createdAt.toDate().getFullYear())
    : '—';
  const savedHeight = profile?.profile.height ?? questionnaire?.answers.height ?? null;

  const initialDate = dateParts(savedBirthDate);
  const initialHeightImperial = cmToFeetInches(savedHeight ?? 0);
  const [name, setName] = useState(savedName);
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto>(undefined);
  const [birthDay, setBirthDay] = useState(initialDate.day);
  const [birthMonth, setBirthMonth] = useState(initialDate.month);
  const [birthYear, setBirthYear] = useState(initialDate.year);
  const [heightCmText, setHeightCmText] = useState(savedHeight ? String(savedHeight) : '');
  const [heightFeetText, setHeightFeetText] = useState(
    savedHeight ? String(initialHeightImperial.feet) : '',
  );
  const [heightInchesText, setHeightInchesText] = useState(
    savedHeight ? String(initialHeightImperial.inches) : '',
  );
  const [nameFocused, setNameFocused] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [birthTouched, setBirthTouched] = useState(false);
  const [heightTouched, setHeightTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const saveLock = useRef(false);
  const photoSelectionLock = useRef(false);

  useEffect(() => {
    setName(savedName);
  }, [savedName]);

  // EditProfileScreen is prewarmed + kept materialized (docs/23_navegacao_e_
  // lifecycle.md §14) — it no longer unmounts between openings, so nothing
  // above can rely on remount to "start fresh" anymore. This is the explicit
  // replacement: every field, draft and touched flag resets to the CURRENT
  // saved profile at the start of every editing session (every `active`
  // transition from false to true) — not just `name`, which is all the old
  // per-field `useEffect` above ever covered. A discard ("descartar
  // alterações") only clears the in-memory draft; the source of truth this
  // reads from is untouched, so the next activation always shows exactly
  // what's actually saved, never a value from an abandoned attempt.
  //
  // Deliberately NOT reset here: `saving`, `processingPhoto`,
  // `uploadProgress`, `saveLock`, `photoSelectionLock`. Each already
  // self-clears in a `finally` block the instant its async operation
  // actually finishes (see `handleSave`/`acceptPhoto`/`chooseFromLibrary`/
  // `takePhoto`) — so if one of them is still truthy at the moment of a new
  // activation, an operation from a previous session is *genuinely* still
  // in flight (e.g. the user backed out mid-upload). Forcing it back to
  // false here would hide that real state and let a second save/upload
  // start concurrently with the first.
  useScreenFocusEffect(() => {
    setName(savedName);
    setPendingPhoto(undefined);
    setBirthDay(initialDate.day);
    setBirthMonth(initialDate.month);
    setBirthYear(initialDate.year);
    setHeightCmText(savedHeight ? String(savedHeight) : '');
    setHeightFeetText(savedHeight ? String(initialHeightImperial.feet) : '');
    setHeightInchesText(savedHeight ? String(initialHeightImperial.inches) : '');
    setNameFocused(false);
    setNameTouched(false);
    setBirthTouched(false);
    setHeightTouched(false);
    setSubmitError(null);
  });

  const normalizedName = normalizeDisplayName(name);
  const parsedBirthDate = parseDateParts(
    Number(birthDay),
    Number(birthMonth),
    Number(birthYear),
  );
  const nameError = useMemo(() => validateDisplayName(name), [name]);
  const birthDateError = useMemo(
    () => validateProfileBirthDate(parsedBirthDate),
    [parsedBirthDate],
  );

  const parsedHeight: number | null =
    resolvedUnits === 'imperial'
      ? heightFeetText && heightInchesText
        ? feetInchesToCm(Number(heightFeetText), Number(heightInchesText))
        : null
      : heightCmText
        ? Number(heightCmText)
        : null;
  const heightError = useMemo(() => validateProfileHeight(parsedHeight), [parsedHeight]);

  const renderNameError = (err: DisplayNameError): string => {
    switch (err.code) {
      case 'nameRequired':
        return t('profile:edit.validation.nameRequired');
      case 'nameTooShort':
        return t('profile:edit.validation.nameTooShort', err.params);
      case 'nameTooLong':
        return t('profile:edit.validation.nameTooLong', err.params);
    }
  };
  const renderBirthDateError = (err: BirthDateError): string => {
    switch (err.code) {
      case 'birthDateRequired':
        return t('profile:edit.validation.birthDateRequired');
      case 'birthDateFuture':
        return t('profile:edit.validation.birthDateFuture');
      case 'birthDateAgeRange':
        return t('profile:edit.validation.birthDateAgeRange', err.params);
    }
  };
  const renderHeightError = (err: HeightError): string => {
    switch (err.code) {
      case 'heightRequired':
        return t('profile:edit.validation.heightRequired');
      case 'heightRange':
        return t('profile:edit.validation.heightRange', err.params);
    }
  };

  const hasNameChanges = normalizedName !== normalizeDisplayName(savedName);
  const hasBirthDateChanges = calendarKey(parsedBirthDate) !== calendarKey(savedBirthDate);
  const hasHeightChanges = parsedHeight !== savedHeight;
  const hasPhotoChanges = pendingPhoto !== undefined;
  const hasChanges = hasNameChanges || hasBirthDateChanges || hasHeightChanges || hasPhotoChanges;
  const currentPhotoURL =
    pendingPhoto === undefined ? profile?.profile.photoURL : pendingPhoto?.uri ?? null;
  const busy = saving || processingPhoto;
  const canSave =
    !!user &&
    hasChanges &&
    !nameError &&
    (!hasBirthDateChanges || !birthDateError) &&
    (!hasHeightChanges || !heightError) &&
    !busy;

  function handleBack() {
    if (!hasChanges || busy) {
      onBack();
      return;
    }

    Alert.alert(
      t('profile:edit.discard.title'),
      t('profile:edit.discard.message'),
      [
        { text: t('profile:edit.discard.cancel'), style: 'cancel' },
        { text: t('profile:edit.discard.confirm'), style: 'destructive', onPress: onBack },
      ],
    );
  }

  async function acceptPhoto(photo: LocalProfilePhoto | null) {
    if (!photo) return;
    setProcessingPhoto(true);
    setSubmitError(null);
    try {
      setPendingPhoto(await compressProfilePhoto(photo));
    } catch (err) {
      logError('profile:compress-photo', err);
      const message = err instanceof Error ? err.message : '';
      Alert.alert(
        t('profile:photo.errors.compressTitle'),
        message === 'profile-photo-too-large'
          ? t('profile:photo.errors.tooLarge')
          : t('profile:photo.errors.compressGeneric'),
      );
    } finally {
      setProcessingPhoto(false);
    }
  }

  async function chooseFromLibrary() {
    if (photoSelectionLock.current || busy) return;
    photoSelectionLock.current = true;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      await acceptPhoto(selectedAsset(result));
    } catch (err) {
      logError('profile:pick-photo', err);
      Alert.alert(
        t('profile:photo.errors.libraryTitle'),
        t('profile:photo.errors.genericRetry'),
      );
    } finally {
      photoSelectionLock.current = false;
    }
  }

  async function takePhoto() {
    if (photoSelectionLock.current || busy) return;
    photoSelectionLock.current = true;
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          t('profile:photo.errors.cameraPermissionTitle'),
          t('profile:photo.errors.cameraPermissionMessage'),
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
        cameraType: ImagePicker.CameraType.front,
      });
      await acceptPhoto(selectedAsset(result));
    } catch (err) {
      logError('profile:take-photo', err);
      Alert.alert(
        t('profile:photo.errors.cameraTitle'),
        t('profile:photo.errors.genericRetry'),
      );
    } finally {
      photoSelectionLock.current = false;
    }
  }

  function openPhotoMenu() {
    if (busy) return;
    Alert.alert(t('profile:photo.menu.title'), t('profile:photo.menu.message'), [
      { text: t('profile:photo.menu.takePhoto'), onPress: () => void takePhoto() },
      { text: t('profile:photo.menu.chooseFromLibrary'), onPress: () => void chooseFromLibrary() },
      ...(currentPhotoURL
        ? [
            {
              text: t('profile:photo.menu.removePhoto'),
              style: 'destructive' as const,
              onPress: () => setPendingPhoto(null),
            },
          ]
        : []),
      { text: t('profile:photo.menu.cancel'), style: 'cancel' as const },
    ]);
  }

  async function handleSave() {
    if (!user || !canSave || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setUploadProgress(null);
    setSubmitError(null);

    try {
      let nextPhotoURL: string | null | undefined;
      if (pendingPhoto && typeof pendingPhoto === 'object') {
        nextPhotoURL = await uploadProfilePhoto(user.uid, pendingPhoto, setUploadProgress);
      } else if (pendingPhoto === null) {
        await deleteProfilePhoto(user.uid);
        nextPhotoURL = null;
      }

      await updateUserProfile(user.uid, {
        ...(hasNameChanges ? { name: normalizedName } : {}),
        ...(hasBirthDateChanges ? { birthDate: parsedBirthDate } : {}),
        ...(hasHeightChanges ? { height: parsedHeight } : {}),
        ...(hasPhotoChanges ? { photoURL: nextPhotoURL ?? null } : {}),
      });

      await refreshProfile();
      onBack();
    } catch (err) {
      logError('profile:update', err);
      const message = err instanceof Error ? err.message : '';
      setSubmitError(
        message === 'profile-photo-too-large'
          ? t('profile:edit.errors.photoTooLarge')
          : t('profile:edit.errors.saveFailed'),
      );
    } finally {
      setSaving(false);
      setUploadProgress(null);
      saveLock.current = false;
    }
  }

  const changeDatePart = (
    setter: (value: string) => void,
    maxLength: number,
  ) => (value: string) => {
    setter(value.replace(/\D/g, '').slice(0, maxLength));
    setBirthTouched(true);
    setSubmitError(null);
  };

  const changeHeightPart = (
    setter: (value: string) => void,
    maxLength: number,
  ) => (value: string) => {
    setter(value.replace(/\D/g, '').slice(0, maxLength));
    setHeightTouched(true);
    setSubmitError(null);
  };
  const heightUnitLabel = resolvedUnits === 'imperial' ? '' : 'cm';

  const emptyNameFallback = athleteFallback.toUpperCase();
  const identityDisplayName = normalizedName.toUpperCase() || emptyNameFallback;

  return (
    <ScreenBg>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.safeArea}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profile:edit.accessibility.back')}
              onPress={handleBack}
              disabled={busy}
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
                busy && styles.disabled,
              ]}
            >
              <Icon name="arrow-left" size={17} color="#fff" />
            </Pressable>
            <View style={styles.headerTitle}>
              <MonoLabel>{t('profile:edit.title').toUpperCase()}</MonoLabel>
            </View>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <View style={styles.identityCard}>
              <ProfileAvatar
                displayName={normalizedName || athleteFallback}
                photoURL={currentPhotoURL}
                photoVersion={pendingPhoto === undefined ? profile?.profile.photoVersion : undefined}
                size={58}
                editable
                onPress={busy ? undefined : openPhotoMenu}
              />

              <View style={styles.identityCopy}>
                <MonoLabel color={colors.accentHi}>
                  {t('profile:header.memberSinceInline', { year: sinceYear }).toUpperCase()}
                </MonoLabel>
                <Display size={22} style={styles.identityName} numberOfLines={1}>
                  {identityDisplayName}
                </Display>
                <Pressable
                  onPress={openPhotoMenu}
                  disabled={busy}
                  hitSlop={8}
                  style={[styles.photoAction, busy && styles.disabled]}
                >
                  <Text style={styles.photoActionText}>
                    {(processingPhoto
                      ? t('profile:photo.actions.optimizing')
                      : currentPhotoURL
                        ? t('profile:photo.actions.change')
                        : t('profile:photo.actions.add')
                    ).toUpperCase()}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.statusDot} />
            </View>

            <View style={styles.formSection}>
              <Slash style={styles.sectionTitle}>
                {t('profile:edit.sections.personalData').toUpperCase()}
              </Slash>
              <View style={styles.formCard}>
                <View style={styles.fieldBlock}>
                  <View style={styles.fieldLabelRow}>
                    <Text style={styles.fieldLabel}>
                      {t('profile:edit.fields.displayName').toUpperCase()}
                    </Text>
                    {nameFocused ? (
                      <Text style={styles.counter}>
                        {name.length}/{DISPLAY_NAME_MAX_LENGTH}
                      </Text>
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.inputShell,
                      nameFocused && styles.inputShellFocused,
                      nameTouched && nameError && styles.inputShellInvalid,
                    ]}
                  >
                    <Icon
                      name="user"
                      size={16}
                      color={nameFocused ? colors.accentHi : colors.faint}
                    />
                    <TextInput
                      accessibilityLabel={t('profile:edit.fields.displayName')}
                      value={name}
                      onChangeText={(value) => {
                        setName(value);
                        setSubmitError(null);
                      }}
                      onFocus={() => setNameFocused(true)}
                      onBlur={() => {
                        setNameFocused(false);
                        setNameTouched(true);
                      }}
                      editable={!busy}
                      maxLength={DISPLAY_NAME_MAX_LENGTH}
                      autoCapitalize="words"
                      autoCorrect={false}
                      autoComplete="name"
                      returnKeyType="done"
                      placeholder={t('profile:edit.identity.namePlaceholder')}
                      placeholderTextColor={colors.faint}
                      selectionColor={colors.accentHi}
                      style={styles.input}
                    />
                  </View>
                  {nameTouched && nameError ? (
                    <Text style={styles.validationText}>{renderNameError(nameError)}</Text>
                  ) : null}
                </View>

                <View style={styles.divider} />

                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>
                    {t('profile:edit.fields.birthDate').toUpperCase()}
                  </Text>
                  <View style={styles.dateRow}>
                    <DatePartInput
                      part="day"
                      value={birthDay}
                      maxLength={2}
                      onChangeText={changeDatePart(setBirthDay, 2)}
                      editable={!busy}
                    />
                    <Text style={styles.dateSeparator}>/</Text>
                    <DatePartInput
                      part="month"
                      value={birthMonth}
                      maxLength={2}
                      onChangeText={changeDatePart(setBirthMonth, 2)}
                      editable={!busy}
                    />
                    <Text style={styles.dateSeparator}>/</Text>
                    <DatePartInput
                      part="year"
                      value={birthYear}
                      maxLength={4}
                      wide
                      onChangeText={changeDatePart(setBirthYear, 4)}
                      editable={!busy}
                    />
                  </View>
                  {birthTouched && birthDateError ? (
                    <Text style={styles.validationText}>{renderBirthDateError(birthDateError)}</Text>
                  ) : null}
                </View>

                <View style={styles.divider} />

                <View style={styles.fieldBlock}>
                  <View style={styles.fieldLabelRow}>
                    <Text style={styles.fieldLabel}>
                      {t('profile:edit.fields.height').toUpperCase()}
                    </Text>
                    {heightUnitLabel ? (
                      <Text style={styles.counter}>{heightUnitLabel}</Text>
                    ) : null}
                  </View>
                  {resolvedUnits === 'imperial' ? (
                    <View style={styles.dateRow}>
                      <DatePartInput
                        part="heightFeet"
                        value={heightFeetText}
                        maxLength={1}
                        onChangeText={changeHeightPart(setHeightFeetText, 1)}
                        editable={!busy}
                      />
                      <DatePartInput
                        part="heightInches"
                        value={heightInchesText}
                        maxLength={2}
                        onChangeText={changeHeightPart(setHeightInchesText, 2)}
                        editable={!busy}
                      />
                    </View>
                  ) : (
                    <View style={styles.dateRow}>
                      <DatePartInput
                        part="heightCm"
                        value={heightCmText}
                        maxLength={3}
                        wide
                        onChangeText={changeHeightPart(setHeightCmText, 3)}
                        editable={!busy}
                      />
                    </View>
                  )}
                  {heightTouched && heightError ? (
                    <Text style={styles.validationText}>{renderHeightError(heightError)}</Text>
                  ) : null}
                </View>
              </View>
            </View>

            <View style={styles.accountSection}>
              <Slash style={styles.sectionTitle}>
                {t('profile:edit.sections.account').toUpperCase()}
              </Slash>
              <View style={styles.formCard}>
                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>
                    {t('profile:edit.fields.email').toUpperCase()}
                  </Text>
                  <View style={[styles.inputShell, styles.inputShellReadOnly]}>
                    <Icon name="mail" size={16} color={colors.faint} />
                    <Text numberOfLines={1} style={styles.readOnlyValue}>
                      {email || t('profile:edit.fields.emailUnavailable')}
                    </Text>
                    <Icon name="lock" size={13} color={colors.faint} />
                  </View>
                </View>
              </View>
              <View style={styles.securityNote}>
                <Icon name="shield" size={14} color={colors.accentHi} />
                <Text style={styles.securityText}>
                  {t('profile:edit.fields.emailSecurityNote')}
                </Text>
              </View>
            </View>

            <View style={styles.footer}>
              {submitError ? (
                <View accessibilityRole="alert" style={styles.errorBox}>
                  <Icon name="alert-triangle" size={16} color="#ff9a9a" />
                  <Text style={styles.errorText}>{submitError}</Text>
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('profile:edit.accessibility.save')}
                onPress={handleSave}
                disabled={!canSave}
                style={({ pressed }) => [
                  styles.saveButton,
                  !canSave && styles.saveButtonDisabled,
                  pressed && canSave && styles.saveButtonPressed,
                ]}
              >
                <LinearGradient
                  colors={['#1f82ff', colors.accent]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.saveButtonGradient}
                >
                  {saving ? (
                    <>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={styles.saveButtonText}>
                        {(uploadProgress === null
                          ? t('profile:edit.actions.saving')
                          : t('profile:edit.actions.uploadingPhoto', {
                              percent: Math.round(uploadProgress * 100),
                            })
                        ).toUpperCase()}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.saveButtonText}>
                        {t('profile:edit.actions.save').toUpperCase()}
                      </Text>
                      <Icon name="arrow-right" size={16} color="#fff" stroke={2} />
                    </>
                  )}
                </LinearGradient>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBg>
  );
}

type DatePart = 'day' | 'month' | 'year' | 'heightFeet' | 'heightInches' | 'heightCm';

function DatePartInput({
  part,
  value,
  maxLength,
  wide,
  onChangeText,
  editable,
}: {
  part: DatePart;
  value: string;
  maxLength: number;
  wide?: boolean;
  onChangeText: (value: string) => void;
  editable: boolean;
}) {
  const { t } = useTranslation('profile');
  // Accessibility uses the natural-case translation; visible micro-label
  // (`DIA/DAY/DÍA`) uppercases the same string at render — same pattern as
  // DateFieldsInput (Phase 4). Placeholder is intentionally NOT localized
  // for month/year: DD/MM/YYYY is a locale-neutral date-format hint most
  // users recognize regardless of language. This matches the input mask
  // (numeric only, exact digit count).
  const accessibleLabel = t(`edit.datePart.${part}`);
  const displayLabel = accessibleLabel.toUpperCase();
  const placeholder =
    part === 'year'
      ? t('edit.datePart.placeholderYear')
      : part === 'month'
        ? t('edit.datePart.placeholderMonth')
        : part === 'heightCm'
          ? t('edit.datePart.placeholderHeightCm')
          : part === 'heightFeet'
            ? t('edit.datePart.placeholderHeightFeet')
            : part === 'heightInches'
              ? t('edit.datePart.placeholderHeightInches')
              : t('edit.datePart.placeholderDay');
  return (
    <View style={[styles.datePart, wide && styles.datePartWide]}>
      <TextInput
        accessibilityLabel={accessibleLabel}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        keyboardType="number-pad"
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        selectionColor={colors.accentHi}
        style={styles.dateInput}
      />
      <Text style={styles.datePartLabel}>{displayLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonPressed: { backgroundColor: 'rgba(255,255,255,0.1)' },
  disabled: { opacity: 0.45 },
  headerTitle: { flex: 1, alignItems: 'center' },
  headerSpacer: { width: 38 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 22,
  },
  identityCard: {
    minHeight: 82,
    borderRadius: 14,
    borderBottomRightRadius: 0,
    borderWidth: 1,
    borderColor: 'rgba(77,163,255,0.2)',
    backgroundColor: 'rgba(11,112,249,0.07)',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    overflow: 'hidden',
  },
  identityCopy: { flex: 1, minWidth: 0 },
  identityName: { marginTop: 3 },
  photoAction: { alignSelf: 'flex-start', marginTop: 3 },
  photoActionText: {
    color: colors.mute,
    fontFamily: fonts.monoBold,
    fontSize: 8,
    letterSpacing: 0.9,
  },
  statusDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 22,
    height: 2,
    backgroundColor: colors.accentHi,
  },
  formSection: { marginTop: 27 },
  accountSection: { marginTop: 20 },
  sectionTitle: { marginBottom: 10 },
  formCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: 'rgba(255,255,255,0.025)',
    paddingHorizontal: 14,
  },
  fieldBlock: { paddingVertical: 14 },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fieldLabel: {
    color: colors.mute,
    fontFamily: fonts.monoBold,
    fontSize: 9,
    letterSpacing: 1.1,
    marginBottom: 7,
  },
  counter: {
    color: colors.faint,
    fontFamily: fonts.mono,
    fontSize: 9,
    marginBottom: 7,
  },
  inputShell: {
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    backgroundColor: 'rgba(255,255,255,0.035)',
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inputShellFocused: {
    borderColor: 'rgba(77,163,255,0.72)',
    backgroundColor: 'rgba(11,112,249,0.08)',
  },
  inputShellInvalid: { borderColor: 'rgba(240,86,63,0.65)' },
  inputShellReadOnly: {
    backgroundColor: 'rgba(255,255,255,0.018)',
    borderColor: 'rgba(255,255,255,0.055)',
  },
  input: {
    flex: 1,
    color: '#fff',
    fontFamily: fonts.uiMed,
    fontSize: 14,
    paddingVertical: 0,
  },
  readOnlyValue: {
    flex: 1,
    color: colors.mute,
    fontFamily: fonts.ui,
    fontSize: 13.5,
  },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  datePart: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    backgroundColor: 'rgba(255,255,255,0.035)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  datePartWide: { flex: 1.35 },
  dateInput: {
    width: '100%',
    color: '#fff',
    fontFamily: fonts.uiSemi,
    fontSize: 14,
    textAlign: 'center',
    padding: 0,
  },
  datePartLabel: {
    color: colors.faint,
    fontFamily: fonts.mono,
    fontSize: 7,
    letterSpacing: 0.8,
    marginTop: 1,
  },
  dateSeparator: { color: colors.faint, fontFamily: fonts.mono, fontSize: 13 },
  validationText: {
    marginTop: 6,
    color: '#ff9a9a',
    fontFamily: fonts.ui,
    fontSize: 11,
  },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)' },
  securityNote: {
    marginTop: 11,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  securityText: {
    flex: 1,
    color: colors.faint,
    fontFamily: fonts.ui,
    fontSize: 11,
  },
  footer: {
    flex: 1,
    minHeight: 120,
    justifyContent: 'flex-end',
    paddingTop: 24,
  },
  errorBox: {
    marginBottom: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(240,86,63,0.3)',
    backgroundColor: 'rgba(240,86,63,0.07)',
    padding: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  errorText: {
    flex: 1,
    color: '#ffb0b0',
    fontFamily: fonts.ui,
    fontSize: 11.5,
  },
  saveButton: {
    height: 50,
    borderRadius: 11,
    borderBottomRightRadius: 0,
    overflow: 'hidden',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  saveButtonDisabled: { opacity: 0.32, shadowOpacity: 0 },
  saveButtonPressed: { opacity: 0.86 },
  saveButtonGradient: {
    flex: 1,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  saveButtonText: {
    color: '#fff',
    fontFamily: fonts.display,
    fontSize: 14,
    letterSpacing: 1.4,
  },
});
