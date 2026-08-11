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
import { isMultiFactorAuthRequired } from '../lib/mfaTotp';

/**
 * Reusable, typed authentication service.
 *
 * Every function that talks to Firebase rethrows a friendly, Portuguese
 * `Error` (via `toAuthError`) so screens can display `error.message` directly.
 */

const ERROR_MESSAGES: Record<string, string> = {
  '10':
    'Configuração do Google Sign-In inválida. Recrie o build após conferir OAuth client, URL scheme e SHA-1.',
  'auth/app-not-authorized':
    'Este app não está autorizado no Firebase. Confira bundle/package e arquivos GoogleService.',
  'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/invalid-api-key': 'A chave do Firebase está inválida. Confira o arquivo .env.',
  'auth/missing-email': 'Informe seu e-mail.',
  'auth/weak-password': 'A senha deve ter no mínimo 6 caracteres.',
  'auth/missing-password': 'Informe sua senha.',
  'auth/user-not-found': 'Não encontramos uma conta com esse e-mail.',
  'auth/wrong-password': 'Senha incorreta.',
  'auth/invalid-credential':
    'Credencial inválida. Se foi com Google, confira os client IDs OAuth do Firebase.',
  'auth/user-disabled': 'Esta conta foi desativada.',
  'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
  'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.',
  'auth/requires-recent-login': 'Sua sessão expirou. Entre novamente para continuar.',
  'auth/user-token-expired': 'Sua sessão expirou. Entre novamente para continuar.',
  'auth/invalid-user-token': 'Sua sessão expirou. Entre novamente para continuar.',
  'auth/no-current-user': 'Sua sessão expirou. Entre novamente para continuar.',
  'auth/password-provider-required':
    'A alteração de senha está disponível apenas para contas com e-mail e senha.',
  'auth/operation-not-allowed':
    'Este método de login não está habilitado no Firebase Auth.',
  // Social / account-linking:
  'auth/account-exists-with-different-credential':
    'Este e-mail já está cadastrado com outro método de login.',
  'auth/credential-already-in-use':
    'Esta conta já está vinculada a outro usuário.',
  'auth/provider-already-linked': 'Este provedor já está vinculado à sua conta.',
  // Firestore:
  'permission-denied':
    'Login criado, mas o Firestore bloqueou a criação do perfil. Confira as regras publicadas.',
  'unavailable': 'Firestore indisponível no momento. Tente novamente.',
};

export function getErrorCode(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : '';
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function logAuthError(scope: string, err: unknown): void {
  const code = getErrorCode(err);
  console.error(`[auth:${scope}]`, {
    code: code || undefined,
    message: getErrorMessage(err),
  });
}

export function toAuthError(err: unknown): Error {
  const code = getErrorCode(err);
  const message =
    ERROR_MESSAGES[code] ??
    (code
      ? `Algo deu errado (${code}). Confira a configuração do Firebase/Google.`
      : 'Algo deu errado. Tente novamente.');
  const friendly = new Error(message);
  if (code) {
    (friendly as Error & { code?: string }).code = code;
  }
  return friendly;
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName?: string,
): Promise<User> {
  try {
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
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<User> {
  try {
    const { user } = await signInWithEmailAndPassword(
      auth,
      email.trim(),
      password,
    );
    return user;
  } catch (err) {
    // POC-only exception: getMultiFactorResolver requires the original
    // MultiFactorError (including customData). Production error normalization
    // remains unchanged for every other error and for non-development builds.
    if (__DEV__ && isMultiFactorAuthRequired(err)) throw err;
    throw toAuthError(err);
  }
}

export async function resetPassword(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (err) {
    throw toAuthError(err);
  }
}

export async function signOutUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (err) {
    throw toAuthError(err);
  }
  // Rotates out the encryption key so no encrypted session blob survives
  // logout, on top of Firebase's own persistence cleanup.
  await clearSecureAuthSession();
}

/**
 * Subscribes to auth state changes. Returns the unsubscribe function.
 */
export function subscribeToAuthState(
  callback: (user: User | null) => void,
): () => void {
  return onAuthStateChanged(auth, callback);
}
