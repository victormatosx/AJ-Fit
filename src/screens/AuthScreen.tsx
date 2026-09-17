import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash } from '../components/ui/Display';
import { CtaButton } from '../components/ui/CtaButton';
import { Icon, IconName } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { radii, sizes, spacing } from '../theme/tokens';
import { useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useAppState } from '../state/AppState';
import { logInfo } from '../lib/logger';
import {
  AccountLinkingRequiredError,
  SocialAuthCancelledError,
  isAppleAuthAvailable,
  isGoogleSigninAvailable,
  socialProviderFromMethods,
  PROVIDER_LABELS,
  clearPendingSocialAuthState,
  type SocialProvider,
} from '../services/socialAuth';
import type { OnboardingAuthContext } from '../onboarding/authContext';
import {
  createPasswordResetCooldown,
  requestPasswordResetWithCooldown,
  type PasswordResetCooldown,
} from '../lib/passwordResetCooldown';
import {
  PASSWORD_POLICY_MAX_LENGTH,
  PASSWORD_POLICY_MIN_LENGTH,
  validateAuthFormPasswordPolicy,
} from '../lib/passwordPolicy';
import { LegalDocumentModal, type LegalDocumentKind } from '../components/legal/LegalDocumentModal';
import { authErrorTranslationKey } from '../lib/authErrorPresentation';

type Mode = 'signup' | 'login' | 'reset';

type LinkingState = { email: string; methods: string[]; attempted: SocialProvider };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function localizedAuthError(
  err: unknown,
  t: TFunction<'auth'>,
  fallbackKey: 'errors.signInFailed' | 'errors.linkFailed' | 'errors.generic',
): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  const key = authErrorTranslationKey(code);
  if (key) {
    return (t as unknown as (key: string, params?: Record<string, number>) => string)(key, {
      min: PASSWORD_POLICY_MIN_LENGTH,
      max: PASSWORD_POLICY_MAX_LENGTH,
    });
  }
  // The legacy key name is retained for resource compatibility; its value is
  // now a safe generic sentence and receives no provider code.
  return t('errors.genericWithCode');
}

function localizedSignInError(err: unknown, t: TFunction<'auth'>): string {
  return localizedAuthError(err, t, 'errors.signInFailed');
}
export function AuthScreen({
  entryContext,
}: {
  /**
   * Copy-only context from the onboarding funnel — which screen sent the
   * user here. Never read by any validation/provider/linking/error-handling
   * logic below; it only picks the initial form mode and pre-fills the name
   * field. See src/onboarding/authContext.ts.
   */
  entryContext?: OnboardingAuthContext | null;
} = {}) {
  const { theme } = useTheme();
  const { t } = useTranslation('auth');
  const {
    signUp,
    signIn,
    reset,
    signInWithProvider,
    completeLinkingWithPassword,
    completeLinkingWithProvider,
  } = useAuth();
  const { quiz, preparedWorkoutProgram } = useAppState();

  // A user who tapped "Entrar" directly should land on the login form, not
  // the signup copy that references a plan they never built (see
  // docs/onboarding_funnel_architecture.md §Auth). Any other/no origin
  // preserves the previous always-signup default.
  const [mode, setMode] = useState<Mode>(
    entryContext?.origin === 'directLogin' ? 'login' : 'signup',
  );

  // Diagnostic only. See the matching comment in OnboardingFunnelScreen —
  // pins down whether the reported post-purchase flicker actually re-mounts
  // THIS screen (the central gate's `!authenticated` branch would route
  // here, not to the questionnaire, if `Boolean(user)` transiently flips
  // false while `screen` is already 'paywall') on the next occurrence.
  useEffect(() => {
    logInfo('navigation', 'auth_screen_mounted', { origin: entryContext?.origin });
    return () => logInfo('navigation', 'auth_screen_unmounted', {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [name, setName] = useState(entryContext?.name ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [legalDocument, setLegalDocument] = useState<LegalDocumentKind | null>(null);
  const [pendingNewSocialProvider, setPendingNewSocialProvider] =
    useState<SocialProvider | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // `busy` only updates on React's next render. This synchronous ref closes
  // that gap across password, social and account-linking handlers; AuthContext
  // independently protects programmatic callers below the UI layer.
  const operationLock = useRef(false);
  const resetCooldownRef = useRef<PasswordResetCooldown | null>(null);
  if (!resetCooldownRef.current) {
    resetCooldownRef.current = createPasswordResetCooldown();
  }
  const resetCooldown = resetCooldownRef.current;
  const [resetCooldownSeconds, setResetCooldownSeconds] = useState(0);

  useEffect(() => {
    if (resetCooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setResetCooldownSeconds(resetCooldown.remainingSeconds());
    }, 1_000);
    return () => clearInterval(timer);
  }, [resetCooldown, resetCooldownSeconds > 0]);

  // Social auth
  const [socialBusy, setSocialBusy] = useState<SocialProvider | null>(null);
  const [linking, setLinking] = useState<LinkingState | null>(null);
  const [linkPassword, setLinkPassword] = useState('');
  const [appleAvailable, setAppleAvailable] = useState(Platform.OS === 'ios');
  // Starts false and is enabled only if the native Google module is present in
  // the binary (absent in Expo Go / a build made before the package was added).
  // The button itself is always rendered (see showGoogle below); this only
  // gates whether tapping it opens the native sheet or the "unavailable" modal.
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [googleUnavailableNotice, setGoogleUnavailableNotice] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [mode, fadeAnim]);

  useEffect(() => {
    let active = true;
    if (Platform.OS === 'ios') {
      isAppleAuthAvailable().then((ok: boolean) => active && setAppleAvailable(ok));
    }
    if (Platform.OS !== 'web') {
      isGoogleSigninAvailable().then((ok: boolean) => active && setGoogleAvailable(ok));
    }
    return () => {
      active = false;
    };
  }, []);

  // Google's button is always rendered; incompatible platforms/builds are
  // handled by showing an "unavailable" modal on tap instead of hiding it.
  const showGoogle = true;
  const googleReallyAvailable = Platform.OS !== 'web' && googleAvailable;
  const showApple = Platform.OS === 'ios' && appleAvailable;
  const showSocial = showGoogle || showApple;
  const busy = loading || socialBusy !== null;

  const copy =
    mode === 'signup'
      ? {
          kicker: t('signup.kicker'),
          title: [t('signup.titleLine1'), t('signup.titleLine2')],
          sub: t('signup.subtitle'),
        }
      : mode === 'login'
        ? {
            kicker: t('login.kicker'),
            title: [t('login.titleLine1'), t('login.titleLine2')],
            sub: t('login.subtitle'),
          }
        : {
            kicker: t('reset.kicker'),
            title: [t('reset.titleLine1'), t('reset.titleLine2')],
            sub: t('reset.subtitle'),
          };

  function switchMode(next: Mode) {
    clearPendingSocialAuthState();
    setMode(next);
    setError(null);
    setInfo(null);
    setConfirm('');
    setLinking(null);
    setLinkPassword('');
    setPendingNewSocialProvider(null);
    setLegalAccepted(false);
    if (next === 'reset') {
      setResetCooldownSeconds(resetCooldown.remainingSeconds());
    }
  }

  function handleLegalAcceptanceToggle() {
    const nextAccepted = !legalAccepted;
    setLegalAccepted(nextAccepted);
    if (nextAccepted) {
      setError((currentError) =>
        currentError === t('validation.legalAcceptanceRequired') ? null : currentError,
      );
    }
  }

  async function handleSocial(provider: SocialProvider) {
    if (operationLock.current || busy) return;
    if (provider === 'google' && !googleReallyAvailable) {
      setGoogleUnavailableNotice(true);
      return;
    }
    if (mode === 'signup' && !legalAccepted) {
      setError(t('validation.legalAcceptanceRequired'));
      return;
    }
    operationLock.current = true;
    clearPendingSocialAuthState();
    setError(null);
    setInfo(null);
    setLinking(null);
    setSocialBusy(provider);
    try {
      const isSocialRegistrationAttempt =
        mode === 'signup' || pendingNewSocialProvider === provider;
      await signInWithProvider(
        provider,
        isSocialRegistrationAttempt ? quiz : null,
        isSocialRegistrationAttempt ? name : null,
        isSocialRegistrationAttempt ? legalAccepted : undefined,
      );
      // Navigation is decided centrally by RootNavigator from the resulting
      // auth/questionnaire state — this screen doesn't pick a destination.
    } catch (err) {
      if (err instanceof SocialAuthCancelledError) {
        // user dismissed the native sheet — no error message
      } else if (err instanceof AccountLinkingRequiredError) {
        setPendingNewSocialProvider(null);
        setLinking({ email: err.email, methods: err.methods, attempted: err.attempted });
      } else {
        const code =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code: unknown }).code)
            : '';
        if (code === 'registrationLegalAcceptanceRequired') {
          setPendingNewSocialProvider(provider);
          setLegalAccepted(false);
        }
        setError(localizedAuthError(err, t, 'errors.signInFailed'));
      }
    } finally {
      operationLock.current = false;
      setSocialBusy(null);
    }
  }

  async function handleLinkWithPassword() {
    if (!linking || operationLock.current || busy) return;
    if (!linkPassword) {
      setError(t('validation.linkPasswordRequired'));
      return;
    }
    operationLock.current = true;
    setError(null);
    setSocialBusy(linking.attempted);
    try {
      await completeLinkingWithPassword(
        linking.email,
        linkPassword,
        mode === 'signup' ? quiz : null,
        mode === 'signup' ? name : null,
        mode === 'signup' ? legalAccepted : undefined,
      );
    } catch (err) {
      setError(localizedAuthError(err, t, 'errors.linkFailed'));
    } finally {
      operationLock.current = false;
      setSocialBusy(null);
    }
  }

  async function handleLinkWithProvider(existing: SocialProvider) {
    if (!linking || operationLock.current || busy) return;
    operationLock.current = true;
    setError(null);
    setSocialBusy(existing);
    try {
      await completeLinkingWithProvider(
        existing,
        mode === 'signup' ? quiz : null,
        mode === 'signup' ? name : null,
        mode === 'signup' ? legalAccepted : undefined,
      );
    } catch (err) {
      if (err instanceof SocialAuthCancelledError) {
        // user dismissed the native sheet
      } else {
        setError(localizedAuthError(err, t, 'errors.linkFailed'));
      }
    } finally {
      operationLock.current = false;
      setSocialBusy(null);
    }
  }

  function validate(): string | null {
    if (mode === 'signup' && name.trim().length < 2)
      return t('validation.nameRequired');
    if (!email.trim()) return t('validation.emailRequired');
    if (!EMAIL_RE.test(email.trim())) return t('validation.emailInvalid');
    if (mode === 'reset') return null;
    if (!password) return t('validation.passwordRequired');
    const passwordPolicyIssue = validateAuthFormPasswordPolicy(mode, password);
    if (passwordPolicyIssue === 'passwordTooShort') {
      return t('validation.passwordMinimum', { min: PASSWORD_POLICY_MIN_LENGTH });
    }
    if (passwordPolicyIssue === 'passwordTooLong') {
      return t('validation.passwordMaximum', { max: PASSWORD_POLICY_MAX_LENGTH });
    }
    if (passwordPolicyIssue === 'passwordMissingUppercase') {
      return t('validation.passwordMissingUppercase');
    }
    if (passwordPolicyIssue === 'passwordMissingNumber') {
      return t('validation.passwordMissingNumber');
    }
    if (passwordPolicyIssue === 'passwordMissingSpecialChar') {
      return t('validation.passwordMissingSpecialChar');
    }
    if (passwordPolicyIssue) return t('errors.passwordPolicy');
    if (mode === 'signup' && password !== confirm)
      return t('validation.passwordMismatch');
    if (mode === 'signup' && !legalAccepted)
      return t('validation.legalAcceptanceRequired');
    return null;
  }

  async function handleSubmit() {
    if (operationLock.current || busy) return;
    if (mode === 'reset' && resetCooldown.isActive()) {
      setResetCooldownSeconds(resetCooldown.remainingSeconds());
      return;
    }
    setError(null);
    setInfo(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    operationLock.current = true;
    setLoading(true);
    try {
      if (mode === 'signup') {
        await signUp(email, password, name, quiz, legalAccepted, preparedWorkoutProgram);
      } else if (mode === 'login') {
        clearPendingSocialAuthState();
        await signIn(email, password);
      } else {
        const result = await requestPasswordResetWithCooldown(
          resetCooldown,
          () => reset(email),
        );
        setResetCooldownSeconds(result.remainingSeconds);
        if (result.status === 'cooldown') return;
        setInfo(t('reset.success'));
        setTimeout(() => switchMode('login'), 1000);
      }
    } catch (err) {
      setError(
        mode === 'login'
          ? localizedSignInError(err, t)
          : localizedAuthError(err, t, 'errors.generic'),
      );
    } finally {
      operationLock.current = false;
      setLoading(false);
    }
  }

  const submitLabel =
    mode === 'signup'
      ? t('actions.createAccount')
      : mode === 'login'
        ? t('actions.signIn')
        : resetCooldownSeconds > 0
          ? t('actions.sendLinkCooldown', { seconds: resetCooldownSeconds })
          : t('actions.sendLink');

  return (
    <ScreenBg>
      <OutlineNumber
        size={260}
        style={{ position: 'absolute', top: -40, right: -50, opacity: 0.35 }}
      >
        AJ
      </OutlineNumber>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View
              style={{
                flex: 1,
                paddingHorizontal: 26,
                paddingTop: 20,
                paddingBottom: 36,
                opacity: fadeAnim,
              }}
            >
              <View>
                {mode !== 'signup' && (
                  <Pressable
                    onPress={() => switchMode(mode === 'reset' ? 'login' : 'signup')}
                    accessibilityRole="button"
                    accessibilityLabel={t('actions.back')}
                    hitSlop={12}
                    style={{ marginBottom: 18, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                  >
                    <Icon name="arrow-left" size={18} color={theme.colors.textSubtle} />
                    <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.uiMed, fontSize: 13 }}>
                      {t('actions.back')}
                    </Text>
                  </Pressable>
                )}
                <Slash style={{ marginBottom: 14 }}>{copy.kicker.toUpperCase()}</Slash>
                <Display size={38}>{copy.title[0].toUpperCase()}</Display>
                <Display size={38}>{copy.title[1].toUpperCase()}</Display>
                <Text
                  style={{
                    marginTop: 14,
                    color: theme.colors.textMuted,
                    fontSize: 14.5,
                    fontFamily: theme.fonts.ui,
                  }}
                >
                  {copy.sub}
                </Text>
              </View>

              <View style={{ marginTop: 30, gap: 12 }}>
                {mode === 'signup' && (
                  <AuthInput
                    icon="user"
                    placeholder={t('fields.name')}
                    value={name}
                    onChangeText={setName}
                    keyboardType="default"
                    autoCapitalize="words"
                    autoComplete="name"
                    textContentType="name"
                    editable={!loading}
                  />
                )}

                <AuthInput
                  icon="mail"
                  placeholder={t('fields.email')}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoComplete="email"
                  textContentType="emailAddress"
                  editable={!loading}
                />

                {mode !== 'reset' && (
                  <AuthInput
                    icon="lock"
                    placeholder={t('fields.password')}
                    value={password}
                    onChangeText={setPassword}
                    secure={!showPass}
                    trailing="eye"
                    onTrailingPress={() => setShowPass((s) => !s)}
                    trailingAccessibilityLabel={t('accessibility.togglePassword')}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                    maxLength={mode === 'signup' ? PASSWORD_POLICY_MAX_LENGTH : undefined}
                    editable={!loading}
                  />
                )}

                {mode === 'signup' && (
                  <AuthInput
                    icon="lock"
                    placeholder={t('fields.confirmPassword')}
                    value={confirm}
                    onChangeText={setConfirm}
                    secure={!showPass}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    maxLength={PASSWORD_POLICY_MAX_LENGTH}
                    editable={!loading}
                  />
                )}

                {mode === 'signup' && (
                  <Text
                    style={{
                      color: theme.colors.textFaint,
                      fontFamily: theme.fonts.ui,
                      fontSize: 12.5,
                      lineHeight: 18,
                    }}
                  >
                    {t('validation.passwordGuidance', {
                      min: PASSWORD_POLICY_MIN_LENGTH,
                    })}
                  </Text>
                )}

                {(mode === 'signup' || pendingNewSocialProvider !== null) && (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <Pressable
                      onPress={handleLegalAcceptanceToggle}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: legalAccepted }}
                      accessibilityLabel={t('legal.acceptanceLabel')}
                      hitSlop={8}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 5,
                        borderWidth: 1,
                        borderColor: legalAccepted ? theme.colors.primaryEmphasis : theme.colors.inputBorderSubtle,
                        backgroundColor: legalAccepted ? theme.colors.primary : theme.colors.inputBackgroundSubtle,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {legalAccepted ? <Icon name="check" size={15} color={theme.colors.primaryForeground} stroke={2.5} /> : null}
                    </Pressable>
                    <Text style={{ flex: 1, color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 12.5, lineHeight: 19 }}>
                      {t('legal.acceptancePrefix')}{' '}
                      <Text
                        accessibilityRole="link"
                        onPress={() => setLegalDocument('terms')}
                        style={{ color: theme.colors.primaryEmphasis, textDecorationLine: 'underline', fontFamily: theme.fonts.uiSemi }}
                      >
                        {t('legal.terms')}
                      </Text>{' '}
                      {t('legal.acceptanceMiddle')}{' '}
                      <Text
                        accessibilityRole="link"
                        onPress={() => setLegalDocument('privacy')}
                        style={{ color: theme.colors.primaryEmphasis, textDecorationLine: 'underline', fontFamily: theme.fonts.uiSemi }}
                      >
                        {t('legal.privacy')}
                      </Text>
                      {t('legal.acceptanceSuffix')}
                    </Text>
                  </View>
                )}

                {mode === 'login' && (
                  <Pressable
                    onPress={() => switchMode('reset')}
                    hitSlop={8}
                    style={{ alignSelf: 'flex-end' }}
                  >
                    <Text
                      style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.uiSemi, fontSize: 13 }}
                    >
                      {t('actions.forgotPassword')}
                    </Text>
                  </Pressable>
                )}

                {error && <Feedback tone="error" text={error} />}
                {info && <Feedback tone="info" text={info} />}
              </View>

              <View style={{ flex: 1, minHeight: 24 }} />

              <View style={{ gap: 11 }}>
                <CtaButton
                  onPress={handleSubmit}
                  disabled={busy || (mode === 'reset' && resetCooldownSeconds > 0)}
                >
                  {loading ? (
                    <ActivityIndicator color={theme.colors.primaryForeground} />
                  ) : (
                    <>
                      <Text
                        style={{
                          color: theme.colors.primaryForeground,
                          fontFamily: theme.fonts.display,
                          fontSize: 17,
                          letterSpacing: 1.5,
                          textTransform: 'uppercase',
                        }}
                      >
                        {submitLabel}
                      </Text>
                      <Icon name="arrow-right" size={18} color={theme.colors.primaryForeground} />
                    </>
                  )}
                </CtaButton>

                {linking && (
                  <LinkingPanel
                    linking={linking}
                    busy={busy}
                    password={linkPassword}
                    onChangePassword={setLinkPassword}
                    onLinkPassword={handleLinkWithPassword}
                    onLinkProvider={handleLinkWithProvider}
                    onCancel={() => {
                      clearPendingSocialAuthState();
                      setLinking(null);
                      setLinkPassword('');
                    }}
                  />
                )}

                {mode !== 'reset' && showSocial && !linking && (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                      <Text
                        style={{
                          fontFamily: theme.fonts.mono,
                          fontSize: 10,
                          letterSpacing: 2,
                          color: theme.colors.textFaint,
                        }}
                      >
                        {t('social.separator').toUpperCase()}
                      </Text>
                      <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                    </View>

                    {showApple && (
                      <CtaButton ghost onPress={() => handleSocial('apple')} disabled={busy}>
                        {socialBusy === 'apple' ? (
                          <ActivityIndicator color={theme.colors.textPrimary} />
                        ) : (
                          <>
                            <Icon name="apple" size={19} color="#fff" />
                            <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, fontSize: 14 }}>
                              {t('social.continueWith', { provider: 'Apple' })}
                            </Text>
                          </>
                        )}
                      </CtaButton>
                    )}

                    {showGoogle && (
                      <CtaButton ghost onPress={() => handleSocial('google')} disabled={busy}>
                        {socialBusy === 'google' ? (
                          <ActivityIndicator color={theme.colors.textPrimary} />
                        ) : (
                          <>
                            <Icon name="google" size={17} color="#fff" />
                            <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, fontSize: 14 }}>
                              {t('social.continueWith', { provider: 'Google' })}
                            </Text>
                          </>
                        )}
                      </CtaButton>
                    )}
                  </>
                )}

                {mode !== 'reset' && (
                  <Pressable
                    onPress={() => switchMode(mode === 'signup' ? 'login' : 'signup')}
                    disabled={loading}
                    hitSlop={8}
                  >
                    <Text
                      style={{
                        textAlign: 'center',
                        marginTop: 6,
                        fontSize: 13,
                        color: theme.colors.textMuted,
                        fontFamily: theme.fonts.ui,
                      }}
                    >
                      {mode === 'signup' ? t('switchMode.hasAccount') : t('switchMode.needsAccount')}{' '}
                      <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.uiSemi }}>
                        {mode === 'signup' ? t('actions.signIn') : t('actions.createAccount')}
                      </Text>
                    </Text>
                  </Pressable>
                )}
              </View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal
        visible={googleUnavailableNotice}
        transparent
        animationType="fade"
        onRequestClose={() => setGoogleUnavailableNotice(false)}
        statusBarTranslucent
      >
        <View
          style={{
            flex: 1,
            backgroundColor: theme.colors.overlayStrong,
            justifyContent: 'center',
            paddingHorizontal: spacing[6],
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: sizes.modalMaxWidth,
              alignSelf: 'center',
              padding: spacing[5],
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: theme.colors.borderStrong,
              backgroundColor: theme.colors.sheetBackground,
              gap: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="google" size={18} color={theme.colors.textMuted} />
              <Text style={{ flex: 1, color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, fontSize: 15 }}>
                {t('social.unavailable.title')}
              </Text>
            </View>
            <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13.5, lineHeight: 19 }}>
              {t('social.unavailable.message')}
            </Text>
            <CtaButton onPress={() => setGoogleUnavailableNotice(false)}>
              <Text
                style={{
                  color: theme.colors.primaryForeground,
                  fontFamily: theme.fonts.display,
                  fontSize: 15,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                {t('social.unavailable.dismiss')}
              </Text>
            </CtaButton>
          </View>
        </View>
      </Modal>
      <LegalDocumentModal document={legalDocument} onClose={() => setLegalDocument(null)} />
    </ScreenBg>
  );
}

/**
 * Guides the user when the social email already belongs to another provider.
 * If the email uses a password, we ask for it inline; if it uses another social
 * provider, we offer to sign in with that one. Both paths link to the SAME UID.
 */
function LinkingPanel({
  linking,
  busy,
  password,
  onChangePassword,
  onLinkPassword,
  onLinkProvider,
  onCancel,
}: {
  linking: LinkingState;
  busy: boolean;
  password: string;
  onChangePassword: (t: string) => void;
  onLinkPassword: () => void;
  onLinkProvider: (p: SocialProvider) => void;
  onCancel: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('auth');
  const hasPassword = linking.methods.includes('password');
  const existingSocial = socialProviderFromMethods(linking.methods);
  const attemptedLabel =
    PROVIDER_LABELS[`${linking.attempted}.com`] ?? t('social.genericProvider');
  const existingProviderLabel = existingSocial
    ? PROVIDER_LABELS[`${existingSocial}.com`] ?? t('social.genericProvider')
    : t('social.genericProvider');

  return (
    <View
      style={{
        gap: 12,
        padding: 16,
        borderRadius: 14,
        backgroundColor: theme.colors.noticeBackground,
        borderWidth: 1,
        borderColor: theme.colors.noticeBorder,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="shield" size={16} color={theme.colors.primaryEmphasis} />
        <Text style={{ flex: 1, color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, fontSize: 13.5 }}>
          {t('linking.title')}
        </Text>
      </View>

      {hasPassword ? (
        <>
          <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 18 }}>
            {t('linking.passwordMessage', {
              email: linking.email,
              attemptedProvider: attemptedLabel,
            })}
          </Text>
          <AuthInput
            icon="lock"
            placeholder={t('fields.linkPassword')}
            value={password}
            onChangeText={onChangePassword}
            secure
            autoComplete="current-password"
            textContentType="password"
            editable={!busy}
          />
          <CtaButton onPress={onLinkPassword} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={theme.colors.primaryForeground} />
            ) : (
              <Text
                style={{
                  color: theme.colors.primaryForeground,
                  fontFamily: theme.fonts.display,
                  fontSize: 16,
                  letterSpacing: 1.2,
                  textTransform: 'uppercase',
                }}
              >
                {t('linking.signInAndLink')}
              </Text>
            )}
          </CtaButton>
        </>
      ) : existingSocial ? (
        <>
          <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 18 }}>
            {t('linking.providerMessage', {
              email: linking.email,
              existingProvider: existingProviderLabel,
              attemptedProvider: attemptedLabel,
            })}
          </Text>
          <CtaButton ghost onPress={() => onLinkProvider(existingSocial)} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={theme.colors.textPrimary} />
            ) : (
              <>
                <Icon name={existingSocial === 'apple' ? 'apple' : 'google'} size={18} color="#fff" />
                <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, fontSize: 14 }}>
                  {t('social.continueWith', { provider: existingProviderLabel })}
                </Text>
              </>
            )}
          </CtaButton>
        </>
      ) : (
        <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 18 }}>
          {t('linking.unknownMethodMessage')}
        </Text>
      )}

      <Pressable onPress={onCancel} disabled={busy} hitSlop={8}>
        <Text
          style={{
            textAlign: 'center',
            color: theme.colors.textMuted,
            fontFamily: theme.fonts.uiMed,
            fontSize: 13,
          }}
        >
          {t('actions.cancel')}
        </Text>
      </Pressable>
    </View>
  );
}

function Feedback({ tone, text }: { tone: 'error' | 'info'; text: string }) {
  const { theme } = useTheme();
  const isError = tone === 'error';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 12,
        backgroundColor: isError
          ? theme.colors.feedbackErrorBackground
          : theme.colors.feedbackInfoBackground,
        borderWidth: 1,
        borderColor: isError
          ? theme.colors.feedbackErrorBorder
          : theme.colors.feedbackInfoBorder,
      }}
    >
      <Icon
        name={isError ? 'x' : 'check'}
        size={15}
        color={isError ? theme.colors.feedbackErrorIcon : theme.colors.primaryEmphasis}
      />
      <Text
        style={{
          flex: 1,
          color: isError ? theme.colors.feedbackErrorText : theme.colors.primaryEmphasis,
          fontFamily: theme.fonts.uiMed,
          fontSize: 13,
          lineHeight: 18,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

function AuthInput({
  icon,
  placeholder,
  value,
  onChangeText,
  secure,
  trailing,
  onTrailingPress,
  trailingAccessibilityLabel,
  keyboardType,
  autoCapitalize = 'none',
  autoComplete,
  textContentType,
  maxLength,
  editable = true,
}: {
  icon: IconName;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  secure?: boolean;
  trailing?: IconName;
  onTrailingPress?: () => void;
  trailingAccessibilityLabel?: string;
  keyboardType?: 'email-address' | 'default';
  autoCapitalize?: 'none' | 'words';
  autoComplete?: 'name' | 'email' | 'current-password' | 'new-password';
  textContentType?: 'name' | 'emailAddress' | 'password' | 'newPassword';
  maxLength?: number;
  editable?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        height: 56,
        borderRadius: 14,
        backgroundColor: theme.colors.authInputBackground,
        borderWidth: 1,
        borderColor: theme.colors.authInputBorder,
        opacity: editable ? 1 : 0.6,
      }}
    >
      <Icon name={icon} size={18} color={theme.colors.authInputIcon} />
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={theme.colors.authInputPlaceholder}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        maxLength={maxLength}
        autoCorrect={false}
        editable={editable}
        keyboardType={keyboardType ?? (icon === 'mail' ? 'email-address' : 'default')}
        style={{
          flex: 1,
          color: theme.colors.inputText,
          fontSize: 15,
          fontFamily: theme.fonts.ui,
        }}
      />
      {trailing && (
        <Pressable
          onPress={onTrailingPress}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={trailingAccessibilityLabel}
        >
          <Icon name={trailing} size={18} color={theme.colors.authInputIcon} />
        </Pressable>
      )}
    </View>
  );
}
