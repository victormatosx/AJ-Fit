import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Centralized Firebase Admin setup, mirroring src/lib/firebase.ts on the
 * client: a singleton initialized once at module load, reused everywhere
 * else. Cloud Functions run in a managed environment with implicit
 * credentials, so no config object is needed here (unlike the client's
 * `firebaseConfig`).
 *
 * This is the ONLY Firestore client billing code should use — the Admin SDK
 * bypasses Security Rules, which is exactly why writes to
 * `users/{uid}.subscription` (client-blocked, see firestore.rules) must go
 * through here and never through a client SDK call.
 */
if (getApps().length === 0) {
  initializeApp();
}

export const db: Firestore = getFirestore();
export const auth: Auth = getAuth();
