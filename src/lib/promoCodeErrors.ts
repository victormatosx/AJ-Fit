/**
 * Pure mapping from a Firebase Functions callable error to a UX-safe
 * outcome (Fase 4C.2 §19). Deliberately reads only the plain
 * `{code, message}` shape the Firebase Functions client SDK error objects
 * expose — no `firebase/functions` import — so this stays testable without
 * mocking Firebase, same reasoning as `subscriptionLifecycle.ts` having no
 * RevenueCat/Firebase dependency.
 *
 * The Functions client SDK prefixes every `HttpsError` code with
 * `"functions/"` (e.g. an `HttpsError('not-found', ...)` on the backend
 * arrives here as `code === 'functions/not-found'`) and preserves the
 * `HttpsError`'s second argument (`message`) verbatim in `err.message`.
 */

export type PromoCodeFailureReason =
  | 'invalid_code'
  | 'unavailable'
  | 'locked'
  | 'unauthenticated'
  | 'temporary';

export interface PromoCodeFailure {
  reason: PromoCodeFailureReason;
  /** Safe to show the user directly — never a raw error code/stack. */
  message: string;
}

function readCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

function readMessage(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'message' in err
    ? String((err as { message: unknown }).message)
    : undefined;
}

const GENERIC_UNAVAILABLE_MESSAGE = 'Este código não está disponível.';
const GENERIC_TEMPORARY_MESSAGE = 'Não foi possível aplicar o código agora. Tente novamente.';

/**
 * Classifies a thrown error from the `validatePromoCode` callable into a
 * `PromoCodeFailure`. Never distinguishes "code doesn't exist" from
 * "inactive" from "outside its window" — `not-found`/`promo_code_unavailable`
 * always maps to the SAME generic message, preserving the backend's own
 * anti-enumeration contract (functions/src/attribution/validatePromoCode.ts)
 * instead of the client inventing a distinction the backend deliberately
 * refuses to make.
 */
export function classifyPromoCodeError(err: unknown): PromoCodeFailure {
  const code = readCode(err);
  const message = readMessage(err);

  if (code === 'functions/unauthenticated') {
    return {
      reason: 'unauthenticated',
      message: 'Sua sessão expirou. Entre novamente para aplicar um código.',
    };
  }

  if (code === 'functions/invalid-argument') {
    return { reason: 'invalid_code', message: 'Código inválido.' };
  }

  if (code === 'functions/not-found') {
    return { reason: 'unavailable', message: GENERIC_UNAVAILABLE_MESSAGE };
  }

  if (code === 'functions/failed-precondition') {
    if (message === 'attribution_locked') {
      return {
        reason: 'locked',
        message: 'Este código não pode mais ser alterado nesta conta.',
      };
    }
    // `user_not_found` (account deleted mid-request) and any other
    // `failed-precondition` land here — a temporary/unusual condition,
    // not a statement about the code itself.
    return { reason: 'temporary', message: GENERIC_TEMPORARY_MESSAGE };
  }

  // `functions/internal`, `functions/unavailable`, network failures, and
  // anything unrecognized: all treated as temporary/retryable — never
  // shown as a technical code/stack to the user.
  return { reason: 'temporary', message: GENERIC_TEMPORARY_MESSAGE };
}

/**
 * Client-side normalization is convenience only (Fase 4C.2 §6) — trim +
 * uppercase for a nicer input field, NEVER the security/format authority.
 * The backend's `normalizePromoCode` (functions/src/attribution/normalize.ts)
 * is the only normalization that matters; this function's output is sent
 * as-is and the backend re-normalizes/validates it independently. Uppercase
 * is applied here only because the visual convention for these codes
 * (ARNALDO, HELLLEN) is already uppercase — purely cosmetic, not a
 * correctness requirement (the backend uppercases too).
 */
export function normalizePromoCodeInput(raw: string): string {
  return raw.trim().toUpperCase();
}
