import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Centralized Firebase Admin setup, mirroring src/lib/firebase.ts on the
 * client: a singleton initialized once at module load, reused everywhere
 * else.
 *
 * `initializeApp()` is called with NO arguments and NO credential file.
 * Cloud Functions run in a Google-managed environment that provides
 * Application Default Credentials automatically — passing a service
 * account JSON here would be both unnecessary and a security regression
 * (see docs/12_seguranca_geral_do_app.md and the Photo Vault backend
 * audit: this repo must never contain a downloaded service account key).
 * This is the only Admin Firestore/Auth entry point used by billing,
 * attribution and Photo Vault code.
 */
if (getApps().length === 0) {
  initializeApp();
}

export const db: Firestore = getFirestore();
export const auth: Auth = getAuth();
