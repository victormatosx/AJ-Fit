import { onCall, type CallableRequest } from 'firebase-functions/v2/https';

import { logInfo } from '../lib/logger';

const backendVersion = (require('../../package.json') as { version: string }).version;

interface BackendHealthResponse {
  ok: true;
  backendVersion: string;
  serverTime: string;
}

/**
 * Minimal, unauthenticated health probe for the Functions backend.
 *
 * Purpose: prove that deploy + runtime work end-to-end (build succeeded,
 * the function is reachable, Cloud Functions v2 is wired correctly). It is
 * deliberately NOT the place to prove authentication or return anything
 * about the environment — see docs/05_desenvolvimento_backend_modulo.md
 * and the Photo Vault backend audit.
 *
 * Must NEVER return: the GCP/Firebase project ID, environment variables,
 * service account info, secrets, tokens, headers, or IAM details.
 */
export function handleBackendHealth(_request: CallableRequest): BackendHealthResponse {
  logInfo('backendHealth', 'health check invoked');

  return {
    ok: true,
    backendVersion,
    serverTime: new Date().toISOString(),
  };
}

export const backendHealth = onCall(handleBackendHealth);
