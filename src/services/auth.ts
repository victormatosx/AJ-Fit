import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { clearSecureAuthSession } from '../lib/secureAuthStorage';
// Imported from the storage layer, not from services/photoVault: logout has
// no business pulling the callable-functions client into its module graph.
import { deleteVaultKey } from '../lib/photoVaultKeyStorage';
import { logError } from '../lib/logger';
import { createSingleFlight } from '../lib/singleFlight';
import {
  assertNewPasswordMeetsPolicy,
  PASSWORD_POLICY_MAX_LENGTH,
  PASSWORD_POLICY_MIN_LENGTH,
} from '../lib/passwordPolicy';
import {
  clearNotificationAccountPreferenceState,
  queueNotificationDeviceRelease,
} from './notificationAccountLifecycle';

/**
 * Reusable, typed authentication service.
 *
 * Every function that talks to the auth provider rethrows a product-safe
 * `Error` plus its original code. Screens localize from the code and never
 * display the message directly.
 */

const ERROR_MESSAGES: Record<string, string> = {
  '10':
    'Não foi possível entrar com o Google agora. Tente novamente.',
  'auth/app-not-authorized':
    'Não foi possível entrar agora. Tente novamente.',
  'auth/email-already-in-use':
    'Não foi possível criar a conta com este e-mail. Tente entrar ou use outro endereço.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/invalid-api-key': 'Não foi possível concluir esta ação agora. Tente novamente.',
  'auth/missing-email': 'Informe seu e-mail.',
  'auth/weak-password':
    `Use uma senha com pelo menos ${PASSWORD_POLICY_MIN_LENGTH} caracteres, incluindo 1 letra maiúscula, 1 número e 1 caractere especial.`,
  'auth/password-does-not-meet-requirements':
    `Use uma senha com pelo menos ${PASSWORD_POLICY_MIN_LENGTH} caracteres, incluindo 1 letra maiúscula, 1 número e 1 caractere especial.`,
  passwordTooShort: `Use pelo menos ${PASSWORD_POLICY_MIN_LENGTH} caracteres.`,
  passwordTooLong: `Use no máximo ${PASSWORD_POLICY_MAX_LENGTH} caracteres.`,
  passwordMissingUppercase: 'Inclua pelo menos 1 letra maiúscula.',
  passwordMissingNumber: 'Inclua pelo menos 1 número.',
  passwordMissingSpecialChar: 'Inclua pelo menos 1 caractere especial.',
  passwordPolicyMismatch: 'A senha não atende à política de segurança.',
  'auth/missing-password': 'Informe sua senha.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/invalid-credential':
    'E-mail ou senha incorretos.',
  'auth/user-disabled': 'E-mail ou senha incorretos.',
  'auth/too-many-requests':
    'Muitas tentativas realizadas. Aguarde um momento antes de tentar novamente.',
  'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.',
  'auth/requires-recent-login': 'Sua sessão expirou. Entre novamente para continuar.',
  'auth/user-token-expired': 'Sua sessão expirou. Entre novamente para continuar.',
  'auth/invalid-user-token': 'Sua sessão expirou. Entre novamente para continuar.',
  'auth/no-current-user': 'Sua sessão expirou. Entre novamente para continuar.',
  'auth/password-provider-required':
    'A alteração de senha está disponível apenas para contas com e-mail e senha.',
  'auth/operation-not-allowed':
    'Este método de acesso não está disponível agora. Use outra opção para entrar.',
  // Social / account-linking:
  'auth/account-exists-with-different-credential':
    'Este e-mail já está cadastrado com outro método de login.',
  'auth/credential-already-in-use':
    'Esta conta já está vinculada a outro usuário.',
  'auth/provider-already-linked': 'Este provedor já está vinculado à sua conta.',
  // Firestore:
  'permission-denied':
    'Sua conta foi criada, mas o perfil não pôde ser concluído. Tente novamente.',
  'unavailable': 'O serviço está indisponível no momento. Tente novamente.',
};

// Service-level barriers protect callers that bypass AuthScreen. Each action
// has its own flight: resetting a password does not unnecessarily serialize a
// sign-in, while duplicate calls to the same critical Firebase operation share
// one Promise until it settles.
const signUpFlight = createSingleFlight<User>();
const signInFlight = createSingleFlight<User>();
const resetPasswordFlight = createSingleFlight<void>();
const signOutFlight = createSingleFlight<void>();

export function getErrorCode(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : '';
}

export function logAuthError(scope: string, err: unknown): void {
  logError(`auth:${scope}`, err);
}

export function toAuthError(err: unknown): Error {
  const code = getErrorCode(err);
  const message =
    ERROR_MESSAGES[code] ??
    'Não foi possível concluir esta ação agora. Tente novamente.';
  const friendly = new Error(message);
  if (code) {
    (friendly as Error & { code?: string }).code = code;
  }
  return friendly;
}

const PRIVATE_SIGN_IN_ERROR_CODES = new Set([
  'auth/invalid-credential',
  'auth/user-not-found',
  'auth/wrong-password',
  'auth/user-disabled',
]);

/**
 * Keeps password sign-in failures externally indistinguishable. Identity
 * Platform already returns `INVALID_LOGIN_CREDENTIALS` with improved email
 * privacy enabled; the legacy codes remain here defensively for older SDK or
 * emulator behavior and are normalized to the current Firebase client code.
 */
export function toSignInError(err: unknown): Error {
  if (!PRIVATE_SIGN_IN_ERROR_CODES.has(getErrorCode(err))) return toAuthError(err);
  const friendly = new Error('E-mail ou senha incorretos.');
  (friendly as Error & { code?: string }).code = 'auth/invalid-credential';
  return friendly;
}

export function signUpWithEmail(
  email: string,
  password: string,
  displayName?: string,
): Promise<User> {
  return signUpFlight.run(async () => {
    try {
      await assertNewPasswordMeetsPolicy(password);
      const { user } = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );
      if (displayName?.trim()) {
        await updateProfile(user, { displayName: displayName.trim() });
      }
      return user;
    } catch (err) {
      throw toAuthError(err);
    }
  });
}

export function signInWithEmail(
  email: string,
  password: string,
): Promise<User> {
  return signInFlight.run(async () => {
    try {
      const { user } = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );
      return user;
    } catch (err) {
      throw toSignInError(err);
    }
  });
}

export function resetPassword(email: string): Promise<void> {
  return resetPasswordFlight.run(async () => {
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err) {
      // Improved email privacy resolves reset requests for unknown addresses.
      // Preserve that same external contract defensively if an older SDK or
      // emulator still surfaces the legacy code.
      if (getErrorCode(err) === 'auth/user-not-found') return;
      throw toAuthError(err);
    }
  });
}

export function signOutUser(): Promise<void> {
  return signOutFlight.run(async () => {
    // Captured before signOut, which clears currentUser: the vault key is
    // namespaced per uid and cannot be removed without it.
    const uid = auth.currentUser?.uid;
    if (uid) {
      // Neither operation is allowed to delay Firebase Auth/RevenueCat
      // lifecycle. Device release is fenced server-side; preference cleanup
      // is identity-scoped and best-effort.
      void queueNotificationDeviceRelease(uid).catch((err) => {
        logError('auth:push-release', err, { uid });
      });
      void clearNotificationAccountPreferenceState(uid);
    }

    try {
      await signOut(auth);
    } catch (err) {
      throw toAuthError(err);
    }
    // Rotates out the encryption key so no encrypted session blob survives
    // logout, on top of Firebase's own persistence cleanup.
    await clearSecureAuthSession();

    // Logout ends the session explicitly, so the device should not keep the
    // photo vault key: it stays recoverable from the backend after a fresh
    // sign-in. Best effort — a storage failure must never block logout.
    if (uid) {
      try {
        await deleteVaultKey(uid);
      } catch {
        // Intentionally ignored: the user is already signed out.
      }
    }
  });
}

/**
 * Subscribes to auth state changes. Returns the unsubscribe function.
 */
export function subscribeToAuthState(
  callback: (user: User | null) => void,
): () => void {
  return onAuthStateChanged(auth, callback);
}
