import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash } from '../components/ui/Display';
import { CtaButton } from '../components/ui/CtaButton';
import { Icon, IconName } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { colors, fonts } from '../theme/tokens';
import { useAuth } from '../state/AuthContext';
import { useAppState } from '../state/AppState';
import {
  AccountLinkingRequiredError,
  SocialAuthCancelledError,
  isAppleAuthAvailable,
  isGoogleSigninAvailable,
  socialProviderFromMethods,
  PROVIDER_LABELS,
  type SocialProvider,
} from '../services/socialAuth';

type Mode = 'signup' | 'login' | 'reset';

type LinkingState = { email: string; methods: string[]; attempted: SocialProvider };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COPY: Record<Mode, { kicker: string; title: [string, string]; sub: string }> = {
  signup: {
    kicker: 'ÚLTIMO PASSO',
    title: ['GARANTA', 'SEU PLANO.'],
    sub: 'Crie sua conta para salvar o plano e ativar os 7 dias grátis.',
  },
  login: {
    kicker: 'BEM-VINDO DE VOLTA',
    title: ['ENTRE NA', 'SUA CONTA.'],
    sub: 'Acesse seu plano e continue de onde parou.',
  },
  reset: {
    kicker: 'RECUPERAR ACESSO',
    title: ['ESQUECEU', 'A SENHA?'],
    sub: 'Informe seu e-mail e enviaremos um link para redefinir sua senha.',
  },
};

export function AuthScreen({ onDone }: { onDone: () => void }) {
  const {
    signUp,
    signIn,
    reset,
    signInWithProvider,
    completeLinkingWithPassword,
    completeLinkingWithProvider,
  } = useAuth();
  const { quiz } = useAppState();

  const [mode, setMode] = useState<Mode>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Social auth
  const [socialBusy, setSocialBusy] = useState<SocialProvider | null>(null);
  const [linking, setLinking] = useState<LinkingState | null>(null);
  const [linkPassword, setLinkPassword] = useState('');
  const [appleAvailable, setAppleAvailable] = useState(Platform.OS === 'ios');
  // Starts false and is enabled only if the native Google module is present in
  // the binary (absent in Expo Go / a build made before the package was added).
  const [googleAvailable, setGoogleAvailable] = useState(false);

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

  const showGoogle = Platform.OS !== 'web' && googleAvailable;
  const showApple = Platform.OS === 'ios' && appleAvailable;
  const showSocial = showGoogle || showApple;
  const busy = loading || socialBusy !== null;

  const copy = COPY[mode];

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
    setConfirm('');
    setLinking(null);
    setLinkPassword('');
  }

  async function handleSocial(provider: SocialProvider) {
    if (busy) return;
    setError(null);
    setInfo(null);
    setLinking(null);
    setSocialBusy(provider);
    try {
      await signInWithProvider(provider, quiz);
      onDone();
    } catch (err) {
      if (err instanceof SocialAuthCancelledError) {
        // user dismissed the native sheet — no error message
      } else if (err instanceof AccountLinkingRequiredError) {
        setLinking({ email: err.email, methods: err.methods, attempted: err.attempted });
      } else {
        setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
      }
    } finally {
      setSocialBusy(null);
    }
  }

  async function handleLinkWithPassword() {
    if (!linking || busy) return;
    if (!linkPassword) {
      setError('Informe sua senha para vincular.');
      return;
    }
    setError(null);
    setSocialBusy(linking.attempted);
    try {
      await completeLinkingWithPassword(linking.email, linkPassword, quiz);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível vincular.');
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
      onDone();
    } catch (err) {
      if (!(err instanceof SocialAuthCancelledError)) {
        setError(err instanceof Error ? err.message : 'Não foi possível vincular.');
      }
    } finally {
      setSocialBusy(null);
    }
  }

  function validate(): string | null {
    if (mode === 'signup' && name.trim().length < 2)
      return 'Informe seu nome.';
    if (!email.trim()) return 'Informe seu e-mail.';
    if (!EMAIL_RE.test(email.trim())) return 'E-mail inválido.';
    if (mode === 'reset') return null;
    if (!password) return 'Informe sua senha.';
    if (password.length < 6) return 'A senha deve ter no mínimo 6 caracteres.';
    if (mode === 'signup' && password !== confirm)
      return 'As senhas não coincidem.';
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
        onDone();
      } else if (mode === 'login') {
        await signIn(email, password);
        onDone();
      } else {
        await reset(email);
        setInfo('Enviamos um link de recuperação para o seu e-mail.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo deu errado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  const submitLabel =
    mode === 'signup' ? 'Começar teste grátis' : mode === 'login' ? 'Entrar' : 'Enviar link';

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
            <View
              style={{ flex: 1, paddingHorizontal: 26, paddingTop: 20, paddingBottom: 36 }}
            >
              <View>
                {mode !== 'signup' && (
                  <Pressable
                    onPress={() => switchMode(mode === 'reset' ? 'login' : 'signup')}
                    hitSlop={12}
                    style={{ marginBottom: 18, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                  >
                    <Icon name="arrow-left" size={18} color="rgba(255,255,255,0.6)" />
                    <Text style={{ color: colors.mute, fontFamily: fonts.uiMed, fontSize: 13 }}>
                      Voltar
                    </Text>
                  </Pressable>
                )}
                <Slash style={{ marginBottom: 14 }}>{copy.kicker}</Slash>
                <Display size={38}>{copy.title[0]}</Display>
                <Display size={38}>{copy.title[1]}</Display>
                <Text
                  style={{
                    marginTop: 14,
                    color: colors.mute,
                    fontSize: 14.5,
                    fontFamily: fonts.ui,
                  }}
                >
                  {copy.sub}
                </Text>
              </View>

              <View style={{ marginTop: 30, gap: 12 }}>
                {mode === 'signup' && (
                  <AuthInput
                    icon="user"
                    placeholder="Seu nome"
                    value={name}
                    onChangeText={setName}
                    keyboardType="default"
                    autoCapitalize="words"
                    editable={!loading}
                  />
                )}

                <AuthInput
                  icon="mail"
                  placeholder="seu@email.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  editable={!loading}
                />

                {mode !== 'reset' && (
                  <AuthInput
                    icon="lock"
                    placeholder="Senha"
                    value={password}
                    onChangeText={setPassword}
                    secure={!showPass}
                    trailing="eye"
                    onTrailingPress={() => setShowPass((s) => !s)}
                    editable={!loading}
                  />
                )}

                {mode === 'signup' && (
                  <AuthInput
                    icon="lock"
                    placeholder="Confirmar senha"
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
                      style={{ color: colors.accentHi, fontFamily: fonts.uiSemi, fontSize: 13 }}
                    >
                      Esqueci minha senha
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
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Text
                        style={{
                          color: '#fff',
                          fontFamily: fonts.display,
                          fontSize: 17,
                          letterSpacing: 1.5,
                          textTransform: 'uppercase',
                        }}
                      >
                        {submitLabel}
                      </Text>
                      <Icon name="arrow-right" size={18} color="#fff" />
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
                      setLinking(null);
                      setLinkPassword('');
                    }}
                  />
                )}

                {mode !== 'reset' && showSocial && !linking && (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ flex: 1, height: 1, backgroundColor: colors.hair }} />
                      <Text
                        style={{
                          fontFamily: fonts.mono,
                          fontSize: 10,
                          letterSpacing: 2,
                          color: colors.faint,
                        }}
                      >
                        OU
                      </Text>
                      <View style={{ flex: 1, height: 1, backgroundColor: colors.hair }} />
                    </View>

                    {showApple && (
                      <CtaButton ghost onPress={() => handleSocial('apple')} disabled={busy}>
                        {socialBusy === 'apple' ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Icon name="apple" size={19} color="#fff" />
                            <Text style={{ color: '#fff', fontFamily: fonts.uiSemi, fontSize: 14 }}>
                              Continuar com Apple
                            </Text>
                          </>
                        )}
                      </CtaButton>
                    )}

                    {showGoogle && (
                      <CtaButton ghost onPress={() => handleSocial('google')} disabled={busy}>
                        {socialBusy === 'google' ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Icon name="google" size={17} color="#fff" />
                            <Text style={{ color: '#fff', fontFamily: fonts.uiSemi, fontSize: 14 }}>
                              Continuar com Google
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
                        color: colors.mute,
                        fontFamily: fonts.ui,
                      }}
                    >
                      {mode === 'signup' ? 'Já é membro? ' : 'Ainda não tem conta? '}
                      <Text style={{ color: colors.accentHi, fontFamily: fonts.uiSemi }}>
                        {mode === 'signup' ? 'Entrar' : 'Criar conta'}
                      </Text>
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
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
  const hasPassword = linking.methods.includes('password');
  const existingSocial = socialProviderFromMethods(linking.methods);
  const attemptedLabel = PROVIDER_LABELS[`${linking.attempted}.com`] ?? 'social';

  return (
    <View
      style={{
        gap: 12,
        padding: 16,
        borderRadius: 14,
        backgroundColor: 'rgba(11,112,249,0.10)',
        borderWidth: 1,
        borderColor: 'rgba(77,163,255,0.32)',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="shield" size={16} color={colors.accentHi} />
        <Text style={{ flex: 1, color: '#fff', fontFamily: fonts.uiSemi, fontSize: 13.5 }}>
          Conta já existente
        </Text>
      </View>

      {hasPassword ? (
        <>
          <Text style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 }}>
            O e-mail {linking.email} já usa e-mail/senha. Entre com sua senha para
            vincular o {attemptedLabel}.
          </Text>
          <AuthInput
            icon="lock"
            placeholder="Sua senha"
            value={password}
            onChangeText={onChangePassword}
            secure
            editable={!busy}
          />
          <CtaButton onPress={onLinkPassword} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text
                style={{
                  color: '#fff',
                  fontFamily: fonts.display,
                  fontSize: 16,
                  letterSpacing: 1.2,
                  textTransform: 'uppercase',
                }}
              >
                Entrar e vincular
              </Text>
            )}
          </CtaButton>
        </>
      ) : existingSocial ? (
        <>
          <Text style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 }}>
            O e-mail {linking.email} já usa {PROVIDER_LABELS[`${existingSocial}.com`]}. Entre
            com {PROVIDER_LABELS[`${existingSocial}.com`]} para vincular o {attemptedLabel}.
          </Text>
          <CtaButton ghost onPress={() => onLinkProvider(existingSocial)} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Icon name={existingSocial === 'apple' ? 'apple' : 'google'} size={18} color="#fff" />
                <Text style={{ color: '#fff', fontFamily: fonts.uiSemi, fontSize: 14 }}>
                  Continuar com {PROVIDER_LABELS[`${existingSocial}.com`]}
                </Text>
              </>
            )}
          </CtaButton>
        </>
      ) : (
        <Text style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 }}>
          Este e-mail já está em uso por outro método de login. Entre com o método
          original para continuar.
        </Text>
      )}

      <Pressable onPress={onCancel} disabled={busy} hitSlop={8}>
        <Text
          style={{
            textAlign: 'center',
            color: colors.mute,
            fontFamily: fonts.uiMed,
            fontSize: 13,
          }}
        >
          Cancelar
        </Text>
      </Pressable>
    </View>
  );
}

function Feedback({ tone, text }: { tone: 'error' | 'info'; text: string }) {
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
        backgroundColor: isError ? 'rgba(255,86,86,0.10)' : 'rgba(11,112,249,0.12)',
        borderWidth: 1,
        borderColor: isError ? 'rgba(255,86,86,0.32)' : 'rgba(77,163,255,0.32)',
      }}
    >
      <Icon
        name={isError ? 'x' : 'check'}
        size={15}
        color={isError ? '#ff7676' : colors.accentHi}
      />
      <Text
        style={{
          flex: 1,
          color: isError ? '#ffb3b3' : colors.accentHi,
          fontFamily: fonts.uiMed,
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
  keyboardType?: 'email-address' | 'default';
  autoCapitalize?: 'none' | 'words';
  editable?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        height: 56,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.045)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.09)',
        opacity: editable ? 1 : 0.6,
      }}
    >
      <Icon name={icon} size={18} color="rgba(255,255,255,0.45)" />
      <TextInput
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.35)"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        editable={editable}
        keyboardType={keyboardType ?? (icon === 'mail' ? 'email-address' : 'default')}
        style={{
          flex: 1,
          color: '#fff',
          fontSize: 15,
          fontFamily: fonts.ui,
        }}
      />
      {trailing && (
        <Pressable onPress={onTrailingPress} hitSlop={10}>
          <Icon name={trailing} size={18} color="rgba(255,255,255,0.45)" />
        </Pressable>
      )}
    </View>
  );
}
