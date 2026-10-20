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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Icon, IconName } from '../components/ui/Icon';
import {
  AqMonoLabel,
  AqPrimaryButton,
  AqSecondaryButton,
  AqSheet,
  AqTextAction,
} from '../components/ui/AcquisitionControls';
import { AjSheetScreenAssistant } from '../components/aj/AjSheetScreenAssistant';
import { AJ_SHEET_SCREEN, AJ_TYPING_MS_PER_CHAR } from '../components/aj/ajMomentTiming';
import { useReducedMotionPreference } from '../lib/reducedMotion';
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

/**
 * Visual sub-steps of the signup form. These are PRESENTATION ONLY: they
 * decide which fields are on screen, never what is required. `validate()` is
 * unchanged and still demands name, email, a policy-compliant password, a
 * matching confirmation and legal acceptance — splitting the form across two
 * screens does not relax any of that, and "Continuar" on the first sub-step
 * does not call `validate()`.
 */
type SignupStep = 'choice' | 'details' | 'password';

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

  /* ── Presentation state (nothing below gates an auth operation) ───────── */

  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotionPreference();
  const [signupStep, setSignupStep] = useState<SignupStep>('choice');
  const [sheetHeight, setSheetHeight] = useState(0);
  const nameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  // Switching mode returns the form to its first sub-step: the sub-steps only
  // exist for signup, and leaving one behind would show a password field on a
  // login screen.
  useEffect(() => {
    setSignupStep('choice');
  }, [mode]);

  // The design's auto-focus, once the sheet has settled into place.
  useEffect(() => {
    if (mode !== 'signup') return () => undefined;
    const target = signupStep === 'details' ? nameRef : signupStep === 'password' ? passwordRef : null;
    if (!target) return () => undefined;
    const timer = setTimeout(() => target.current?.focus(), AJ_SHEET_SCREEN.autoFocusAtMs);
    return () => clearTimeout(timer);
  }, [mode, signupStep]);

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
  const busy = loading || socialBusy !== null;

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
        isSocialRegistrationAttempt ? preparedWorkoutProgram : null,
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
    if (passwordPolicyIssue)
      return t('errors.passwordPolicy', { min: PASSWORD_POLICY_MIN_LENGTH });
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

  /* ── Presentation derived from the state above ───────────────────────── */

  // `validate()` runs over the WHOLE form regardless of which sub-step is on
  // screen, so a name or email problem can surface while the password fields
  // are showing. This only moves the user back to the sub-step that owns the
  // offending field — it does not change the message, the rule, or when the
  // rule runs.
  const nameOrEmailErrors = [
    t('validation.nameRequired'),
    t('validation.emailRequired'),
    t('validation.emailInvalid'),
  ];
  useEffect(() => {
    if (!error || signupStep !== 'password') return;
    if (nameOrEmailErrors.includes(error)) setSignupStep('details');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to a new error, not to the recreated message array
  }, [error, signupStep]);

  const passwordPolicyMet =
    mode === 'signup'
      && password.length > 0
      && validateAuthFormPasswordPolicy('signup', password) === null;

  const providerLabel = socialBusy ? PROVIDER_LABELS[`${socialBusy}.com`] ?? t('social.genericProvider') : '';

  const assistantLines = (): string[] => {
    if (socialBusy) return [t('aj.connecting', { provider: providerLabel })];
    if (loading) {
      return [mode === 'signup' ? t('aj.creating') : mode === 'login' ? t('aj.login') : t('aj.reset')];
    }
    if (linking) return [t('aj.linking')];
    if (error) return [error];
    if (mode === 'reset') return [t('aj.reset')];
    if (mode === 'login') return [t('aj.login')];
    if (signupStep === 'details') return [t('aj.email')];
    if (signupStep === 'password') {
      return passwordPolicyMet ? [t('aj.passwordOk')] : [t('aj.password')];
    }
    return [
      entryContext?.name ? t('aj.introWithName', { name: entryContext.name }) : t('aj.intro'),
      t('aj.introSecondary'),
    ];
  };

  const assistantMood = loading || socialBusy || linking ? 'think' : error ? 'idle' : 'idle';
  // A nod marks a new error and the moment the policy starts being met; the
  // mascot never celebrates a failure.
  const [assistantPhase, setAssistantPhase] = useState<'idle' | 'hop' | 'nod'>('idle');
  useEffect(() => {
    if (reduceMotion) return () => undefined;
    if (!error && !passwordPolicyMet) return () => undefined;
    setAssistantPhase('idle');
    const start = setTimeout(() => setAssistantPhase('nod'), 0);
    const end = setTimeout(() => setAssistantPhase('idle'), 600);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
  }, [error, passwordPolicyMet, reduceMotion]);

  const showBackButton = mode === 'signup' && signupStep !== 'choice';
  const handleVisualBack = () => {
    // Moves between the form's sub-steps only. It never changes `mode`, so it
    // can't drop the user out of signup.
    setSignupStep((current) => (current === 'password' ? 'details' : 'choice'));
  };

  const detailsComplete = name.trim().length > 0 && email.trim().length > 0;
  const legalBlock = (mode === 'signup' || pendingNewSocialProvider !== null);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SafeAreaView edges={['top']}>
        {showBackButton ? (
          <View style={{ paddingHorizontal: 22, paddingTop: 15 }}>
            <Pressable
              onPress={handleVisualBack}
              accessibilityRole="button"
              accessibilityLabel={t('actions.back')}
              hitSlop={12}
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                borderWidth: 1,
                borderColor: theme.colors.dividerStrong,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="arrow-left" size={16} color={theme.colors.textPrimary} />
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>

      {/* This screen's own AJ. It is outside the onboarding funnel (App.tsx
          owns it), so there is no persistent mascot to borrow — one inline
          `AjBot`, never inside a Modal. */}
      <AjSheetScreenAssistant
        sheetHeight={sheetHeight}
        lines={assistantLines()}
        msPerChar={AJ_TYPING_MS_PER_CHAR.auth}
        mood={assistantMood}
        phase={assistantPhase}
        look={signupStep === 'choice' ? undefined : [0, 2.2]}
        reduceMotion={reduceMotion}
        topInset={insets.top}
      />

      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <AqSheet
          delay={reduceMotion ? 0 : AJ_SHEET_SCREEN.sheetRiseAtMs}
          reduceMotion={reduceMotion}
          onSheetLayout={setSheetHeight}
          style={{ paddingBottom: Math.max(34, insets.bottom + 16) }}
        >
          <ScrollView
            contentContainerStyle={{ gap: 14 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Animated.View style={{ gap: 14, opacity: fadeAnim }}>
              {loading ? (
                <AuthLoadingState label={t('loading.title')} />
              ) : (
                <>
                  {mode === 'signup' && signupStep === 'choice' ? (
                    <View style={{ gap: 8 }}>
                      <AqMonoLabel>{t('signup.kicker').toUpperCase()}</AqMonoLabel>
                      <Text style={sheetTitleStyle(theme)}>{t('steps.chooseTitle')}</Text>
                    </View>
                  ) : null}
                  {mode === 'login' ? (
                    <View style={{ gap: 8 }}>
                      <AqMonoLabel>{t('login.kicker').toUpperCase()}</AqMonoLabel>
                      <Text style={sheetTitleStyle(theme)}>{t('steps.loginTitle')}</Text>
                    </View>
                  ) : null}
                  {mode === 'reset' ? (
                    <View style={{ gap: 8 }}>
                      <AqMonoLabel>{t('reset.kicker').toUpperCase()}</AqMonoLabel>
                      <Text style={sheetTitleStyle(theme)}>{t('steps.resetTitle')}</Text>
                    </View>
                  ) : null}
                  {mode === 'signup' && signupStep === 'details' ? (
                    <AqMonoLabel>{t('steps.detailsLabel')}</AqMonoLabel>
                  ) : null}
                  {mode === 'signup' && signupStep === 'password' ? (
                    <AqMonoLabel>{t('steps.passwordLabel')}</AqMonoLabel>
                  ) : null}

                  {/* ── Signup, method choice ── */}
                  {mode === 'signup' && signupStep === 'choice' && !linking ? (
                    <>
                      {showApple && (
                        socialBusy === 'apple' ? (
                          <SocialBusyButton tone="inverse" />
                        ) : (
                          <AqSecondaryButton
                            label={t('social.continueWith', { provider: 'Apple' })}
                            onPress={() => handleSocial('apple')}
                            disabled={busy}
                            icon={<Icon name="apple" size={19} color="#fff" />}
                            style={{
                              backgroundColor: theme.colors.inverseSurface,
                              borderColor: theme.colors.inverseSurface,
                            }}
                            textStyle={{ color: theme.colors.inverseForeground }}
                          />
                        )
                      )}
                      {showGoogle && (
                        socialBusy === 'google' ? (
                          <SocialBusyButton tone="outline" />
                        ) : (
                          <AqSecondaryButton
                            label={t('social.continueWith', { provider: 'Google' })}
                            onPress={() => handleSocial('google')}
                            disabled={busy}
                            icon={<Icon name="google" size={17} color="#fff" />}
                          />
                        )
                      )}
                      <AqSecondaryButton
                        label={t('steps.continueWithEmail')}
                        onPress={() => setSignupStep('details')}
                        disabled={busy}
                        icon={<Icon name="mail" size={17} color={theme.colors.textPrimary} />}
                      />
                    </>
                  ) : null}

                  {/* ── Signup, sub-step 1 of 2 ── */}
                  {mode === 'signup' && signupStep === 'details' && !linking ? (
                    <>
                      <AuthInput
                        inputRef={nameRef}
                        icon="user"
                        placeholder={t('fields.name')}
                        value={name}
                        onChangeText={setName}
                        keyboardType="default"
                        autoCapitalize="words"
                        autoComplete="name"
                        textContentType="name"
                        editable={!loading}
                        valid={name.trim().length > 0}
                        returnKeyType="next"
                        onSubmitEditing={() => emailRef.current?.focus()}
                      />
                      <AuthInput
                        inputRef={emailRef}
                        icon="mail"
                        placeholder={t('fields.email')}
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoComplete="email"
                        textContentType="emailAddress"
                        editable={!loading}
                        valid={EMAIL_RE.test(email.trim())}
                        invalid={error === t('validation.emailInvalid')}
                        returnKeyType="next"
                        onSubmitEditing={() => detailsComplete && setSignupStep('password')}
                      />
                      <AqPrimaryButton
                        label={t('steps.next')}
                        onPress={() => setSignupStep('password')}
                        disabled={!detailsComplete || busy}
                      />
                    </>
                  ) : null}

                  {/* ── Signup, sub-step 2 of 2 ── */}
                  {mode === 'signup' && signupStep === 'password' && !linking ? (
                    <>
                      <AuthInput
                        inputRef={passwordRef}
                        icon="lock"
                        placeholder={t('fields.password')}
                        value={password}
                        onChangeText={setPassword}
                        secure={!showPass}
                        trailing="eye"
                        onTrailingPress={() => setShowPass((s) => !s)}
                        trailingAccessibilityLabel={t('accessibility.togglePassword')}
                        autoComplete="new-password"
                        textContentType="newPassword"
                        maxLength={PASSWORD_POLICY_MAX_LENGTH}
                        editable={!loading}
                        valid={passwordPolicyMet}
                      />
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
                        valid={confirm.length > 0 && confirm === password}
                        invalid={confirm.length > 0 && confirm !== password}
                        returnKeyType="done"
                        onSubmitEditing={handleSubmit}
                      />
                      <PasswordStrengthMeter met={passwordPolicyMet} />
                      <Text
                        style={{
                          color: theme.colors.textSubtleStrong,
                          fontFamily: theme.fonts.ui,
                          fontSize: 12,
                          lineHeight: 18,
                        }}
                      >
                        {t('validation.passwordGuidance', { min: PASSWORD_POLICY_MIN_LENGTH })}
                      </Text>
                    </>
                  ) : null}

                  {/* ── Login ── */}
                  {mode === 'login' && !linking ? (
                    <>
                      <AuthInput
                        icon="mail"
                        placeholder={t('fields.email')}
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoComplete="email"
                        textContentType="emailAddress"
                        editable={!loading}
                        valid={EMAIL_RE.test(email.trim())}
                      />
                      <AuthInput
                        icon="lock"
                        placeholder={t('fields.password')}
                        value={password}
                        onChangeText={setPassword}
                        secure={!showPass}
                        trailing="eye"
                        onTrailingPress={() => setShowPass((s) => !s)}
                        trailingAccessibilityLabel={t('accessibility.togglePassword')}
                        autoComplete="current-password"
                        textContentType="password"
                        editable={!loading}
                        returnKeyType="done"
                        onSubmitEditing={handleSubmit}
                      />
                      <AqTextAction
                        label={t('actions.forgotPassword')}
                        onPress={() => switchMode('reset')}
                        style={{ alignSelf: 'flex-end' }}
                      />
                      {showApple && (
                        <AqSecondaryButton
                          label={t('social.continueWith', { provider: 'Apple' })}
                          onPress={() => handleSocial('apple')}
                          disabled={busy}
                          icon={<Icon name="apple" size={19} color="#fff" />}
                          style={{
                            backgroundColor: theme.colors.inverseSurface,
                            borderColor: theme.colors.inverseSurface,
                          }}
                          textStyle={{ color: theme.colors.inverseForeground }}
                        />
                      )}
                      {showGoogle && (
                        <AqSecondaryButton
                          label={t('social.continueWith', { provider: 'Google' })}
                          onPress={() => handleSocial('google')}
                          disabled={busy}
                          icon={<Icon name="google" size={17} color="#fff" />}
                        />
                      )}
                    </>
                  ) : null}

                  {/* ── Reset ── */}
                  {mode === 'reset' && !linking ? (
                    <AuthInput
                      icon="mail"
                      placeholder={t('fields.email')}
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoComplete="email"
                      textContentType="emailAddress"
                      editable={!loading}
                      valid={EMAIL_RE.test(email.trim())}
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit}
                    />
                  ) : null}

                  {/* Legal acceptance. Required for BOTH paths and therefore
                      rendered on both: the method-choice step (social signup
                      checks it before opening the native sheet) and the
                      password step (email signup checks it in `validate()`).
                      One state, one handler — the condition is unchanged. */}
                  {legalBlock && !linking
                    && (signupStep !== 'details' || pendingNewSocialProvider !== null) ? (
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
                          borderColor: legalAccepted ? theme.colors.primaryEmphasis : theme.colors.fieldBorderStrong,
                          backgroundColor: legalAccepted ? theme.colors.primary : theme.colors.surfaceMuted,
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
                  ) : null}

                  {googleUnavailableNotice && !linking ? (
                    <Feedback tone="error" text={t('social.unavailable.message')} />
                  ) : null}
                  {error && <Feedback tone="error" text={error} />}
                  {info && <Feedback tone="info" text={info} />}

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

                  {/* The submit button. `disabled` is exactly the expression it
                      has always been, and the only sub-step that hides it is
                      the one where no credential has been entered yet. */}
                  {!linking && !(mode === 'signup' && signupStep === 'details') ? (
                    <AqPrimaryButton
                      label={submitLabel}
                      onPress={handleSubmit}
                      disabled={busy || (mode === 'reset' && resetCooldownSeconds > 0)}
                      style={{ marginTop: 4 }}
                    />
                  ) : null}

                  {mode !== 'reset' && !linking ? (
                    <Pressable
                      onPress={() => switchMode(mode === 'signup' ? 'login' : 'signup')}
                      disabled={loading}
                      accessibilityRole="button"
                      hitSlop={8}
                    >
                      <Text
                        style={{
                          textAlign: 'center',
                          marginTop: 2,
                          fontSize: 13.5,
                          color: theme.colors.textSubtle,
                          fontFamily: theme.fonts.ui,
                        }}
                      >
                        {mode === 'signup' ? t('switchMode.hasAccount') : t('switchMode.needsAccount')}{' '}
                        <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.uiSemi }}>
                          {mode === 'signup' ? t('actions.signIn') : t('actions.createAccount')}
                        </Text>
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              )}
            </Animated.View>
          </ScrollView>
        </AqSheet>
      </KeyboardAvoidingView>

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
              backgroundColor: theme.colors.sheetBackgroundAlt,
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
            <AqPrimaryButton
              label={t('social.unavailable.dismiss')}
              onPress={() => setGoogleUnavailableNotice(false)}
            />
          </View>
        </View>
      </Modal>
      <LegalDocumentModal document={legalDocument} onClose={() => setLegalDocument(null)} />
    </View>
  );
}

/**
 * A social button that has been tapped and is waiting on the native sheet.
 * Keeps the button's exact footprint so the sheet does not reflow mid-flight,
 * and keeps the per-provider busy state visible rather than collapsing every
 * provider into one global spinner.
 */
function SocialBusyButton({ tone }: { tone: 'inverse' | 'outline' }) {
  const { theme } = useTheme();
  const inverse = tone === 'inverse';
  return (
    <View
      accessibilityRole="progressbar"
      style={{
        width: '100%',
        paddingVertical: 15,
        borderRadius: theme.radii.md,
        borderWidth: 1,
        borderColor: inverse ? theme.colors.inverseSurface : theme.colors.fieldBorderStrong,
        backgroundColor: inverse ? theme.colors.inverseSurface : theme.colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ActivityIndicator color={inverse ? theme.colors.inverseForeground : theme.colors.textPrimary} />
    </View>
  );
}

/** Sheet heading shared by every mode. */
function sheetTitleStyle(theme: ReturnType<typeof useTheme>['theme']) {
  return {
    fontFamily: theme.fonts.uiSemi,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    color: theme.colors.textPrimary,
  } as const;
}

/**
 * The in-sheet loading state. It reports that work is in progress and nothing
 * else — in particular it never shows a success screen on a timer. When the
 * account genuinely exists, the central gate swaps the screen; this component
 * has no idea that happened, which is exactly right.
 */
function AuthLoadingState({ label }: { label: string }) {
  const { theme } = useTheme();
  const reduceMotion = useReducedMotionPreference();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return () => undefined;
    const animation = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, useNativeDriver: true }),
    );
    animation.start();
    return () => animation.stop();
  }, [spin, reduceMotion]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ alignItems: 'center', gap: 16, paddingVertical: 24 }}
    >
      <Animated.View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          borderWidth: 2,
          borderColor: theme.colors.primaryBorderSoft,
          borderTopColor: theme.colors.primaryEmphasis,
          transform: [
            { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          ],
        }}
      />
      <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 15, color: theme.colors.textPrimary }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Three bars that say whether the password satisfies the policy.
 *
 * Deliberately two states, not a graded score. The design draws an
 * intermediate "good" step between weak and strong, but
 * `validateAuthFormPasswordPolicy` reports only the FIRST unmet rule, not a
 * per-rule result — so a proportion would either have to re-implement the
 * policy here or depend on the private order in which `passwordPolicy.ts`
 * happens to check its rules. Both are worse than showing the one thing the
 * function actually answers. Recorded as a difference from the design.
 */
function PasswordStrengthMeter({ met }: { met: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ now: met ? 3 : 0, min: 0, max: 3 }}
      style={{ flexDirection: 'row', gap: 4 }}
    >
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          style={{
            flex: 1,
            height: 3,
            borderRadius: 2,
            backgroundColor: met ? theme.colors.primaryEmphasis : theme.colors.surfaceElevated,
          }}
        />
      ))}
    </View>
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
          {busy ? (
            <ActivityIndicator color={theme.colors.primaryForeground} />
          ) : (
            <AqPrimaryButton
              label={t('linking.signInAndLink')}
              onPress={onLinkPassword}
              disabled={busy}
            />
          )}
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
          {busy ? (
            <ActivityIndicator color={theme.colors.textPrimary} />
          ) : (
            <AqSecondaryButton
              label={t('social.continueWith', { provider: existingProviderLabel })}
              onPress={() => onLinkProvider(existingSocial)}
              disabled={busy}
              icon={<Icon name={existingSocial === 'apple' ? 'apple' : 'google'} size={18} color="#fff" />}
            />
          )}
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
  inputRef,
  returnKeyType,
  onSubmitEditing,
  /**
   * Border state only. Neither flag decides whether anything can be
   * submitted — `validate()` remains the single authority for that, and both
   * are computed by the caller from values it already has.
   */
  valid,
  invalid,
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
  inputRef?: React.RefObject<TextInput | null>;
  returnKeyType?: 'next' | 'done';
  onSubmitEditing?: () => void;
  valid?: boolean;
  invalid?: boolean;
}) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = invalid
    ? theme.colors.fieldErrorBorder
    : focused || valid
      ? theme.colors.primaryEmphasis
      : theme.colors.fieldBorderStrong;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 15,
        borderRadius: 12,
        backgroundColor: theme.colors.surfaceMuted,
        borderWidth: 1,
        borderColor,
        opacity: editable ? 1 : 0.6,
      }}
    >
      <Icon name={icon} size={18} color={theme.colors.authInputIcon} />
      <TextInput
        ref={inputRef}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.authInputPlaceholder}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        maxLength={maxLength}
        autoCorrect={false}
        editable={editable}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        selectionColor={theme.colors.primaryEmphasis}
        keyboardType={keyboardType ?? (icon === 'mail' ? 'email-address' : 'default')}
        style={{
          flex: 1,
          color: theme.colors.inputText,
          fontSize: 16,
          fontFamily: theme.fonts.uiMed,
          padding: 0,
        }}
      />
      {trailing && (
        <Pressable
          onPress={onTrailingPress}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={trailingAccessibilityLabel}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name={trailing} size={18} color={theme.colors.authInputIcon} />
        </Pressable>
      )}
    </View>
  );
}
