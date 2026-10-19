import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { requireAuth } from '../lib/auth';

/**
 * Fase 3 of the interactive Lock Screen work — a short-lived, self-contained
 * capability that lets the widget extension (which has no Firebase Auth
 * session and no App Check attestation) ask `externalWorkoutAction.ts` to
 * complete ONE specific set of ONE specific workout execution, without the
 * extension ever holding a Firebase ID token or an App Check token.
 *
 * Signed with a server-only HMAC secret (`node:crypto`, same primitive
 * `billing/revenuecat.ts` already uses for its webhook signature — no new
 * dependency). The signing secret never leaves this backend: the main app
 * only ever receives the opaque, already-signed `token` string, never the
 * secret itself.
 *
 * No Firestore document ever represents this capability — it is entirely
 * stateless. Revocation is implicit: `exp` is short, and
 * `externalWorkoutAction.ts` re-validates `WorkoutExecution.status ===
 * 'IN_PROGRESS'` on every request regardless of what the token claims, so a
 * capability outliving the workout it was minted for is harmless (see that
 * file's doc comment).
 */

const WORKOUT_ACTION_CAPABILITY_VERSION = 1;
export const WORKOUT_ACTION_CAPABILITY_PURPOSE = 'workout_action';

/**
 * Generous for a real training session (the longest realistic workout plus
 * margin for a long rest or the user setting the phone down) without being
 * open-ended. Short enough that a leaked/leftover token is not a standing
 * risk — and moot either way, since `externalWorkoutAction.ts` independently
 * re-checks the execution is still `IN_PROGRESS` on every request.
 */
export const WORKOUT_ACTION_CAPABILITY_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * `firebase functions:secrets:set WORKOUT_ACTION_CAPABILITY_SECRET`
 * (same operational pattern as `REVENUECAT_WEBHOOK_SECRET`,
 * `billing/revenuecat.ts`). Bound explicitly via each function's `secrets:
 * [...]` option — never read from `process.env` directly outside that.
 */
export const WORKOUT_ACTION_CAPABILITY_SECRET = defineSecret('WORKOUT_ACTION_CAPABILITY_SECRET');

/** The 2nd-gen Cloud Functions default region this project's other `onRequest`/`onCall` functions deploy to (see `photoVault/cleanupOrphans.ts`'s explicit `region: 'us-central1'`) — no function in this codebase overrides it. */
const WORKOUT_ACTION_REGION = 'us-central1';
const WORKOUT_ACTION_FUNCTION_NAME = 'externalWorkoutAction';

export interface WorkoutActionCapabilityClaims {
  v: typeof WORKOUT_ACTION_CAPABILITY_VERSION;
  uid: string;
  executionId: string;
  purpose: typeof WORKOUT_ACTION_CAPABILITY_PURPOSE;
  /** Epoch ms. */
  iat: number;
  /** Epoch ms. */
  exp: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string | null {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

/** `payload.hexSignature` — not JWT-compliant (no need to be; both issuer and verifier are this same backend), but the same "sign the encoded payload bytes, never the re-serialized object" shape as the RevenueCat webhook signature. */
export function signWorkoutActionCapability(
  claims: { uid: string; executionId: string; iat: number; exp: number },
  secret: string,
): string {
  const full: WorkoutActionCapabilityClaims = {
    v: WORKOUT_ACTION_CAPABILITY_VERSION,
    purpose: WORKOUT_ACTION_CAPABILITY_PURPOSE,
    uid: claims.uid,
    executionId: claims.executionId,
    iat: claims.iat,
    exp: claims.exp,
  };
  const payload = base64UrlEncode(JSON.stringify(full));
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

export type WorkoutActionCapabilityVerification =
  | Readonly<{ valid: true; claims: WorkoutActionCapabilityClaims }>
  | Readonly<{
      valid: false;
      reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'WRONG_PURPOSE' | 'WRONG_VERSION';
    }>;

/**
 * Verifies the signature BEFORE trusting anything decoded from the payload
 * — a tampered payload is rejected by signature mismatch regardless of
 * whether its JSON happens to parse. `exp` is the only revocation
 * mechanism this function itself enforces; `executionId`/`uid` ownership
 * and "is the execution still IN_PROGRESS" are the CALLER's responsibility
 * (`externalWorkoutAction.ts`), checked fresh against Firestore, never
 * inferred from the token alone.
 */
export function verifyWorkoutActionCapability(
  token: unknown,
  secret: string,
): WorkoutActionCapabilityVerification {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2_000) {
    return { valid: false, reason: 'MALFORMED' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'MALFORMED' };
  const [payload, signature] = parts;
  if (!payload || !signature || !/^[0-9a-f]+$/i.test(signature)) {
    return { valid: false, reason: 'MALFORMED' };
  }

  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(signature, 'hex');
  // Length check before timingSafeEqual — it throws on mismatched lengths
  // rather than returning false, and this check itself leaks no useful
  // timing information (the expected length is fixed-format).
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    return { valid: false, reason: 'BAD_SIGNATURE' };
  }

  const decoded = base64UrlDecode(payload);
  if (!decoded) return { valid: false, reason: 'MALFORMED' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return { valid: false, reason: 'MALFORMED' };
  }
  if (!isPlainObject(parsed)) return { valid: false, reason: 'MALFORMED' };
  if (parsed.v !== WORKOUT_ACTION_CAPABILITY_VERSION) return { valid: false, reason: 'WRONG_VERSION' };
  if (parsed.purpose !== WORKOUT_ACTION_CAPABILITY_PURPOSE) return { valid: false, reason: 'WRONG_PURPOSE' };
  if (typeof parsed.uid !== 'string' || parsed.uid.length === 0) return { valid: false, reason: 'MALFORMED' };
  if (typeof parsed.executionId !== 'string' || parsed.executionId.length === 0) {
    return { valid: false, reason: 'MALFORMED' };
  }
  if (typeof parsed.iat !== 'number' || !Number.isFinite(parsed.iat)) return { valid: false, reason: 'MALFORMED' };
  if (typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)) return { valid: false, reason: 'MALFORMED' };
  if (Date.now() > parsed.exp) return { valid: false, reason: 'EXPIRED' };

  return { valid: true, claims: parsed as unknown as WorkoutActionCapabilityClaims };
}

export interface IssueWorkoutActionCapabilityRequest {
  executionId: string;
}

export interface IssueWorkoutActionCapabilityResult {
  token: string;
  /** Epoch ms — mirrors `AJFitSharedAuth.Capability.expiresAtMs` (Swift, already Double-typed) 1:1. */
  expiresAtMs: number;
  endpointUrl: string;
  executionId: string;
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

function parseIssueRequest(value: unknown): IssueWorkoutActionCapabilityRequest {
  if (!isPlainObject(value) || !boundedId(value.executionId)) {
    throw new HttpsError('invalid-argument', 'invalid_issue_workout_action_capability_request');
  }
  const allowed = new Set(['executionId']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new HttpsError('invalid-argument', 'invalid_issue_workout_action_capability_request');
  }
  return { executionId: value.executionId };
}

function defaultEndpointUrl(): string {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'ajfit-2f321';
  return `https://${WORKOUT_ACTION_REGION}-${projectId}.cloudfunctions.net/${WORKOUT_ACTION_FUNCTION_NAME}`;
}

/**
 * Issues a capability scoped to exactly one `(uid, executionId)` pair — the
 * uid is ALWAYS `request.auth.uid` (the verified Firebase ID token), never
 * read from the request body, so a client can never mint a capability for
 * another user. `executionId` must belong to the caller and be
 * `IN_PROGRESS` at issuance time; ownership is re-checked by
 * `externalWorkoutAction.ts` on every subsequent request too, since the
 * execution could finish/abandon after a capability is already issued.
 */
export async function issueWorkoutActionCapabilityHandler(
  request: CallableRequest,
  deps: { firestore?: Firestore; secret?: string; endpointUrl?: string; now?: () => number } = {},
): Promise<IssueWorkoutActionCapabilityResult> {
  const uid = requireAuth(request);
  const data = parseIssueRequest(request.data);
  const firestore = deps.firestore ?? defaultDb;
  const secret = deps.secret ?? WORKOUT_ACTION_CAPABILITY_SECRET.value();
  const endpointUrl = deps.endpointUrl ?? defaultEndpointUrl();
  const now = deps.now ?? Date.now;

  const executionRef = firestore
    .collection('users').doc(uid)
    .collection('workoutExecutions').doc(data.executionId);
  const snapshot = await executionRef.get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'execution_not_found');
  const execution = snapshot.data()!;
  if (execution.status !== 'IN_PROGRESS') {
    throw new HttpsError('failed-precondition', 'execution_not_in_progress');
  }

  const iat = now();
  const exp = iat + WORKOUT_ACTION_CAPABILITY_TTL_MS;
  const token = signWorkoutActionCapability({ uid, executionId: data.executionId, iat, exp }, secret);

  return { token, expiresAtMs: exp, endpointUrl, executionId: data.executionId };
}
