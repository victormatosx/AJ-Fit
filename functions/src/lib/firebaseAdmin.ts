import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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
 */
if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore();
