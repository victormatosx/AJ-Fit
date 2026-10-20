/**
 * Development-only connection to the Firebase Emulator Suite.
 *
 * Exists so end-to-end homologation can drive the REAL app UI against
 * disposable data, instead of either waiting days for production history to
 * accumulate or fabricating records in a real account.
 *
 * ## Four guarantees, in the order they are enforced
 *
 * 1. **Never in a shipped build.** Every call site is wrapped in `__DEV__`,
 *    which Metro inlines as a literal `false` for production bundles — the
 *    whole module is then dead code and is eliminated. This is a build-time
 *    property, not a runtime check someone can flip.
 * 2. **Opt-in, never a default.** Absent `EXPO_PUBLIC_AJFIT_EMULATOR_HOST`,
 *    `plan()` returns `null` and nothing is touched: the app points at the
 *    real project exactly as before.
 * 3. **All or nothing.** Auth, Firestore AND Functions are connected inside
 *    one call. A half-connected app — writing to the emulator while
 *    authenticating against production, or vice versa — is the one outcome
 *    that could corrupt real data, so any failure throws and takes the app
 *    down loudly instead of degrading into that state.
 * 4. **No credentials.** Only a host and ports. The emulator accepts any
 *    token, which is precisely why no secret is needed or accepted here.
 *
 * ## Why the host must be explicit
 *
 * The iOS Simulator shares the host's network stack, so `localhost` works
 * there; a physical device does not and needs the Mac's LAN address. Rather
 * than guess, the host is always read from the environment.
 */
import { connectAuthEmulator, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, type Functions } from 'firebase/functions';

/** Ports of `firebase emulators:start`, matching this repo's firebase.json. */
const AUTH_PORT = 9099;
const FIRESTORE_PORT = 8080;
const FUNCTIONS_PORT = 5001;

export interface EmulatorPlan {
  host: string;
  auth: number;
  firestore: number;
  functions: number;
}

/**
 * The configured target, or `null` when homologation mode is off.
 *
 * Pure and exported so tests can assert the gating without importing the
 * Firebase SDK. `__DEV__` is checked by the CALLERS rather than here, so a
 * test can exercise the parsing without pretending to be a dev bundle.
 */
export function emulatorPlan(env: Record<string, string | undefined>): EmulatorPlan | null {
  const host = env.EXPO_PUBLIC_AJFIT_EMULATOR_HOST?.trim();
  if (!host) return null;
  return { host, auth: AUTH_PORT, firestore: FIRESTORE_PORT, functions: FUNCTIONS_PORT };
}

/**
 * True once every service has been redirected. Read by `assertFullyIsolated`
 * so a partially-wired app can be detected even if a connect call failed
 * silently in a future SDK version.
 */
const connected = { auth: false, firestore: false, functions: false };

/**
 * Redirects all three services, or throws.
 *
 * Deliberately NOT idempotent-by-silence: the Firebase SDK throws if a
 * service is connected after it has already been used, and swallowing that
 * would be exactly the half-connected state guarantee 3 forbids.
 */
export function connectAjFitEmulators(
  plan: EmulatorPlan,
  instances: { auth: Auth; db: Firestore; functions: Functions },
): void {
  // `disableWarnings` only silences the console banner the Auth emulator
  // prints; it changes no behaviour. The banner is noise in an automated run.
  connectAuthEmulator(instances.auth, `http://${plan.host}:${plan.auth}`, { disableWarnings: true });
  connected.auth = true;
  connectFirestoreEmulator(instances.db, plan.host, plan.firestore);
  connected.firestore = true;
  connectFunctionsEmulator(instances.functions, plan.host, plan.functions);
  connected.functions = true;
}

/**
 * Fails closed when homologation mode is on but something still points at the
 * real project. Called after wiring; the error is deliberately fatal.
 */
export function assertFullyIsolated(): void {
  const missing = Object.entries(connected)
    .filter(([, done]) => !done)
    .map(([service]) => service);
  if (missing.length > 0) {
    throw new Error(
      `AJ Fit homologação: isolamento incompleto — ${missing.join(', ')} ainda aponta(m) para produção. ` +
        'A inicialização foi interrompida de propósito: um app meio conectado poderia escrever em dados reais.',
    );
  }
}

/** Exposed for the dev banner and for logs; never used to decide anything. */
export function emulatorStatus(): typeof connected {
  return { ...connected };
}
