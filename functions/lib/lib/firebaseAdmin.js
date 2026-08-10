"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
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
if ((0, app_1.getApps)().length === 0) {
    (0, app_1.initializeApp)();
}
exports.db = (0, firestore_1.getFirestore)();
//# sourceMappingURL=firebaseAdmin.js.map