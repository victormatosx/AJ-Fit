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

/**
 * Reusable, typed authentication service.
 *
 * Every function that talks to Firebase rethrows a friendly, Portuguese
 * `Error` (via `toAuthError`) so screens can display `error.message` directly.
 */

const ERROR_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/missing-email': 'Informe seu e-mail.',
  'auth/weak-password': 'A senha deve ter no mínimo 6 caracteres.',
  'auth/missing-password': 'Informe sua senha.',
  'auth/user-not-found': 'Não encontramos uma conta com esse e-mail.',
  'auth/wrong-password': 'Senha incorreta.',
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/user-disabled': 'Esta conta foi desativada.',
  'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
  'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.',
  'auth/operation-not-allowed':
    'Login por e-mail/senha não está habilitado no Firebase.',
};

function toAuthError(err: unknown): Error {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  return new Error(ERROR_MESSAGES[code] ?? 'Algo deu errado. Tente novamente.');
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
}

/**
 * Subscribes to auth state changes. Returns the unsubscribe function.
 */
export function subscribeToAuthState(
  callback: (user: User | null) => void,
): () => void {
  return onAuthStateChanged(auth, callback);
}
