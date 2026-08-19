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
import {
  clearTotpSignInChallenge,
  startTotpSignInChallenge,
  type TotpSignInChallenge,
  type TotpSignInOrigin,
} from '../services/mfaTotp';
import {
  isMultiFactorAuthRequired,
  mfaTotpIssueFromError,
  type MfaTotpIssue,
} from '../lib/mfaTotp';
import { TotpChallengeScreen } from './TotpChallengeScreen';
import type { OnboardingAuthContext } from '../onboarding/authContext';

type Mode = 'signup' | 'login' | 'reset';

type LinkingState = { email: string; methods: string[]; attempted: SocialProvider };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AUTH_ERROR_KEY_BY_CODE = {
  '10': 'errors.googleConfig',
  'auth/app-not-authorized': 'errors.appNotAuthorized',
  'auth/email-already-in-use': 'errors.emailInUse',
  'auth/invalid-email': 'errors.invalidEmail',
  'auth/invalid-api-key': 'errors.invalidApiKey',
  'auth/missing-email': 'errors.missingEmail',
  'auth/weak-password': 'errors.weakPassword',
  'auth/missing-password': 'errors.missingPassword',
  'auth/user-not-found': 'errors.userNotFound',
  'auth/wrong-password': 'errors.wrongPassword',
  'auth/invalid-credential': 'errors.invalidCredential',
  'auth/user-disabled': 'errors.userDisabled',
  'auth/too-many-requests': 'errors.tooManyRequests',
  'auth/network-request-failed': 'errors.networkFailed',
  'auth/operation-not-allowed': 'errors.operationNotAllowed',
  'auth/account-exists-with-different-credential': 'errors.accountExists',
  'auth/credential-already-in-use': 'errors.credentialInUse',
  'auth/provider-already-linked': 'errors.providerLinked',
  'permission-denied': 'errors.permissionDenied',
  unavailable: 'errors.unavailable',
} as const;

function localizedAuthError(
  err: unknown,
  t: TFunction<'auth'>,
  fallbackKey: 'errors.signInFailed' | 'errors.linkFailed' | 'errors.generic',
): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  const key = AUTH_ERROR_KEY_BY_CODE[code as keyof typeof AUTH_ERROR_KEY_BY_CODE];
  if (key) return t(key);
  return code ? t('errors.genericWithCode', { code }) : t(fallbackKey);
}

function totpStartError(
  issue: MfaTotpIssue,
  t: TFunction<'auth'>,
): string {
  if (issue === 'resolverWithoutHints') {
    return t('totpChallenge.errors.resolverWithoutHints');
  }
  if (issue === 'factorNotFound') {
    return t('totpChallenge.errors.totpFactorMissing');
  }
  return t('totpChallenge.errors.generic');
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
  const { quiz } = useAppState();

  // A user who tapped "Entrar" directly should land on the login form, not
  // the signup copy that references a plan they never built (see
  // docs/onboarding_funnel_architecture.md §Auth). Any other/no origin
  // preserves the previous always-signup default.
  const [mode, setMode] = useState<Mode>(
    entryContext?.origin === 'directLogin' ? 'login' : 'signup',
  );
  const [name, setName] = useState(entryContext?.name ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [totpChallenge, setTotpChallenge] = useState<TotpSignInChallenge | null>(null);

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
    clearTotpSignInChallenge();
    clearPendingSocialAuthState();
    setTotpChallenge(null);
    setMode(next);
    setError(null);
    setInfo(null);
    setConfirm('');
    setLinking(null);
    setLinkPassword('');
  }

  function beginTotpChallenge(error: unknown, origin: TotpSignInOrigin): boolean {
    if (!isMultiFactorAuthRequired(error)) return false;
    try {
      const challenge = startTotpSignInChallenge(error, origin);
      setMode('login');
      setError(null);
      setInfo(null);
      setTotpChallenge(challenge);
    } catch (resolverError) {
      clearTotpSignInChallenge();
      clearPendingSocialAuthState();
      setError(totpStartError(mfaTotpIssueFromError(resolverError), t));
    }
    return true;
  }

  async function handleSocial(provider: SocialProvider) {
    if (busy) return;
    if (provider === 'google' && !googleReallyAvailable) {
      setGoogleUnavailableNotice(true);
      return;
    }
    clearPendingSocialAuthState();
    setError(null);
    setInfo(null);
    setLinking(null);
    setSocialBusy(provider);
    try {
      await signInWithProvider(provider, quiz);
      // Navigation is decided centrally by RootNavigator from the resulting
      // auth/questionnaire state — this screen doesn't pick a destination.
    } catch (err) {
      if (err instanceof SocialAuthCancelledError) {
        // user dismissed the native sheet — no error message
      } else if (err instanceof AccountLinkingRequiredError) {
        setLinking({ email: err.email, methods: err.methods, attempted: err.attempted });
      } else if (beginTotpChallenge(err, provider)) {
        // The provider sheet already completed the first factor. The in-memory
        // resolver continues that same transaction without reopening it.
      } else {
        setError(localizedAuthError(err, t, 'errors.signInFailed'));
      }
    } finally {
      setSocialBusy(null);
    }
  }

  async function handleLinkWithPassword() {
    if (!linking || busy) return;
    if (!linkPassword) {
      setError(t('validation.linkPasswordRequired'));
      return;
    }
    setError(null);
    setSocialBusy(linking.attempted);
    try {
      await completeLinkingWithPassword(linking.email, linkPassword, quiz);
    } catch (err) {
      if (!beginTotpChallenge(err, 'account-linking')) {
        setError(localizedAuthError(err, t, 'errors.linkFailed'));
      }
    } finally {
      setSocialBusy(null);
    }
  }

  async function handleLinkWithProvider(existing: SocialProvider) {
    if (!linking || busy) return;
    setError(null);
    setSocialBusy(existing);
    try {
      await completeLinkingWithProvider(existing, quiz);
    } catch (err) {
      if (err instanceof SocialAuthCancelledError) {
        // user dismissed the native sheet
      } else if (!beginTotpChallenge(err, 'account-linking')) {
        setError(localizedAuthError(err, t, 'errors.linkFailed'));
      }
    } finally {
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
    if (password.length < 6) return t('validation.passwordMinimum', { min: 6 });
    if (mode === 'signup' && password !== confirm)
      return t('validation.passwordMismatch');
    return null;
  }

  async function handleSubmit() {
    if (busy) return;
    setError(null);
    setInfo(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signup') {
        await signUp(email, password, name, quiz);
      } else if (mode === 'login') {
        clearPendingSocialAuthState();
        await signIn(email, password);
      } else {
        await reset(email);
        setInfo(t('reset.success'));
        setTimeout(() => switchMode('login'), 1000);
      }
    } catch (err) {
      if (mode === 'login' && beginTotpChallenge(err, 'password')) return;
      setError(localizedAuthError(err, t, 'errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  const submitLabel =
    mode === 'signup'
      ? t('actions.createAccount')
      : mode === 'login'
        ? t('actions.signIn')
        : t('actions.sendLink');

  if (totpChallenge) {
    return (
      <TotpChallengeScreen
        challenge={totpChallenge}
        onCancel={() => {
          clearTotpSignInChallenge();
          clearPendingSocialAuthState();
          setTotpChallenge(null);
          setMode('login');
          setPassword('');
          setLinkPassword('');
          setLinking(null);
          setError(null);
          setInfo(null);
        }}
        onSessionExpired={() => {
          clearTotpSignInChallenge();
          clearPendingSocialAuthState();
          setTotpChallenge(null);
          setMode('login');
          setPassword('');
          setLinkPassword('');
          setLinking(null);
          setInfo(null);
          setError(t('totpChallenge.errors.sessionExpired'));
        }}
      />
    );
  }

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
                    editable={!loading}
                  />
                )}

                <AuthInput
                  icon="mail"
                  placeholder={t('fields.email')}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
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
                    editable={!loading}
                  />
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
                <CtaButton onPress={handleSubmit} disabled={busy}>
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
