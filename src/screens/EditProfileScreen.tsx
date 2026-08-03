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
import { ScreenBg } from '../components/ui/ScreenBg';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import { Display, MonoLabel, Slash } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { colors, fonts } from '../theme/tokens';
import { useAuth } from '../state/AuthContext';
import { updateUserProfile } from '../services/userProfile';
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
} from '../lib/userProfileValidation';
import { logError } from '../lib/logError';

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
  const { user, profile, questionnaire, refreshProfile } = useAuth();
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

  const initialDate = dateParts(savedBirthDate);
  const [name, setName] = useState(savedName);
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto>(undefined);
  const [birthDay, setBirthDay] = useState(initialDate.day);
  const [birthMonth, setBirthMonth] = useState(initialDate.month);
  const [birthYear, setBirthYear] = useState(initialDate.year);
  const [nameFocused, setNameFocused] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [birthTouched, setBirthTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const saveLock = useRef(false);
  const photoSelectionLock = useRef(false);

  useEffect(() => {
    setName(savedName);
  }, [savedName]);

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

  const hasNameChanges = normalizedName !== normalizeDisplayName(savedName);
  const hasBirthDateChanges = calendarKey(parsedBirthDate) !== calendarKey(savedBirthDate);
  const hasPhotoChanges = pendingPhoto !== undefined;
  const hasChanges = hasNameChanges || hasBirthDateChanges || hasPhotoChanges;
  const currentPhotoURL =
    pendingPhoto === undefined ? profile?.profile.photoURL : pendingPhoto?.uri ?? null;
  const busy = saving || processingPhoto;
  const canSave =
    !!user &&
    hasChanges &&
    !nameError &&
    (!hasBirthDateChanges || !birthDateError) &&
    !busy;

  function handleBack() {
    if (!hasChanges || busy) {
      onBack();
      return;
    }

    Alert.alert('Descartar alterações?', 'As mudanças feitas no perfil não serão salvas.', [
      { text: 'Continuar editando', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: onBack },
    ]);
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
        'Não foi possível preparar a foto',
        message === 'profile-photo-too-large'
          ? 'Mesmo após a compressão, a imagem ultrapassou 5 MB.'
          : 'Escolha outra imagem e tente novamente.',
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
      Alert.alert('Não foi possível abrir suas fotos', 'Tente novamente em instantes.');
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
          'Acesso à câmera necessário',
          'Permita o acesso à câmera nos Ajustes para tirar uma foto de perfil.',
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
      Alert.alert('Não foi possível abrir a câmera', 'Tente novamente em instantes.');
    } finally {
      photoSelectionLock.current = false;
    }
  }

  function openPhotoMenu() {
    if (busy) return;
    Alert.alert('Foto de perfil', 'Escolha uma opção', [
      { text: 'Tirar foto', onPress: () => void takePhoto() },
      { text: 'Escolher da biblioteca', onPress: () => void chooseFromLibrary() },
      ...(currentPhotoURL
        ? [
            {
              text: 'Remover foto',
              style: 'destructive' as const,
              onPress: () => setPendingPhoto(null),
            },
          ]
        : []),
      { text: 'Cancelar', style: 'cancel' },
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
        ...(hasPhotoChanges ? { photoURL: nextPhotoURL ?? null } : {}),
      });

      await refreshProfile();
      onBack();
    } catch (err) {
      logError('profile:update', err);
      const message = err instanceof Error ? err.message : '';
      setSubmitError(
        message === 'profile-photo-too-large'
          ? 'A foto deve ter no máximo 5 MB.'
          : 'Não foi possível salvar. Verifique sua conexão e tente novamente.',
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
              accessibilityLabel="Voltar para o perfil"
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
              <MonoLabel>EDITAR PERFIL</MonoLabel>
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
                displayName={normalizedName}
                photoURL={currentPhotoURL}
                photoVersion={pendingPhoto === undefined ? profile?.profile.photoVersion : undefined}
                size={58}
                editable
                onPress={busy ? undefined : openPhotoMenu}
              />

              <View style={styles.identityCopy}>
                <MonoLabel color={colors.accentHi}>MEMBRO DESDE {sinceYear}</MonoLabel>
                <Display size={22} style={styles.identityName} numberOfLines={1}>
                  {normalizedName.toUpperCase() || 'SEU NOME'}
                </Display>
                <Pressable
                  onPress={openPhotoMenu}
                  disabled={busy}
                  hitSlop={8}
                  style={[styles.photoAction, busy && styles.disabled]}
                >
                  <Text style={styles.photoActionText}>
                    {processingPhoto
                      ? 'OTIMIZANDO FOTO...'
                      : currentPhotoURL
                        ? 'ALTERAR FOTO'
                        : 'ADICIONAR FOTO'}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.statusDot} />
            </View>

            <View style={styles.formSection}>
              <Slash style={styles.sectionTitle}>DADOS PESSOAIS</Slash>
              <View style={styles.formCard}>
                <View style={styles.fieldBlock}>
                  <View style={styles.fieldLabelRow}>
                    <Text style={styles.fieldLabel}>NOME DE EXIBIÇÃO</Text>
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
                      accessibilityLabel="Nome de exibição"
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
                      placeholder="Seu nome"
                      placeholderTextColor={colors.faint}
                      selectionColor={colors.accentHi}
                      style={styles.input}
                    />
                  </View>
                  {nameTouched && nameError ? (
                    <Text style={styles.validationText}>{nameError}</Text>
                  ) : null}
                </View>

                <View style={styles.divider} />

                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>DATA DE NASCIMENTO</Text>
                  <View style={styles.dateRow}>
                    <DatePartInput
                      label="DIA"
                      value={birthDay}
                      maxLength={2}
                      onChangeText={changeDatePart(setBirthDay, 2)}
                      editable={!busy}
                    />
                    <Text style={styles.dateSeparator}>/</Text>
                    <DatePartInput
                      label="MÊS"
                      value={birthMonth}
                      maxLength={2}
                      onChangeText={changeDatePart(setBirthMonth, 2)}
                      editable={!busy}
                    />
                    <Text style={styles.dateSeparator}>/</Text>
                    <DatePartInput
                      label="ANO"
                      value={birthYear}
                      maxLength={4}
                      wide
                      onChangeText={changeDatePart(setBirthYear, 4)}
                      editable={!busy}
                    />
                  </View>
                  {birthTouched && birthDateError ? (
                    <Text style={styles.validationText}>{birthDateError}</Text>
                  ) : null}
                </View>
              </View>
            </View>

            <View style={styles.accountSection}>
              <Slash style={styles.sectionTitle}>CONTA</Slash>
              <View style={styles.formCard}>
                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>E-MAIL</Text>
                  <View style={[styles.inputShell, styles.inputShellReadOnly]}>
                    <Icon name="mail" size={16} color={colors.faint} />
                    <Text numberOfLines={1} style={styles.readOnlyValue}>
                      {email || 'E-mail não disponível'}
                    </Text>
                    <Icon name="lock" size={13} color={colors.faint} />
                  </View>
                </View>
              </View>
              <View style={styles.securityNote}>
                <Icon name="shield" size={14} color={colors.accentHi} />
                <Text style={styles.securityText}>
                  O e-mail é protegido pelos seus métodos de login.
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
                accessibilityLabel="Salvar alterações"
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
                        {uploadProgress === null
                          ? 'SALVANDO...'
                          : `ENVIANDO FOTO ${Math.round(uploadProgress * 100)}%`}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.saveButtonText}>SALVAR ALTERAÇÕES</Text>
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

function DatePartInput({
  label,
  value,
  maxLength,
  wide,
  onChangeText,
  editable,
}: {
  label: string;
  value: string;
  maxLength: number;
  wide?: boolean;
  onChangeText: (value: string) => void;
  editable: boolean;
}) {
  return (
    <View style={[styles.datePart, wide && styles.datePartWide]}>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        keyboardType="number-pad"
        maxLength={maxLength}
        placeholder={label === 'ANO' ? 'AAAA' : label === 'MÊS' ? 'MM' : 'DD'}
        placeholderTextColor={colors.faint}
        selectionColor={colors.accentHi}
        style={styles.dateInput}
      />
      <Text style={styles.datePartLabel}>{label}</Text>
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
