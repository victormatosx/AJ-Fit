import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { emulatorPlan } from '../firebaseEmulator';

const MODULE = readFileSync('src/lib/firebaseEmulator.ts', 'utf8');
/** Comments legitimately discuss credentials to explain their absence. */
const MODULE_CODE = MODULE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const FIREBASE = readFileSync('src/lib/firebase.ts', 'utf8');
const ENV_EXAMPLE = readFileSync('.env.example', 'utf8');

/**
 * Homologation mode redirects the app to the Emulator Suite. The whole value
 * of that is isolation, so what matters is not that it connects — it is that
 * it CANNOT connect halfway, cannot ship, and cannot turn itself on.
 */
describe('it is off unless explicitly turned on', () => {
  it('no variable at all means production', () => {
    expect(emulatorPlan({})).toBeNull();
  });

  it('an empty or whitespace value means production', () => {
    expect(emulatorPlan({ EXPO_PUBLIC_AJFIT_EMULATOR_HOST: '' })).toBeNull();
    expect(emulatorPlan({ EXPO_PUBLIC_AJFIT_EMULATOR_HOST: '   ' })).toBeNull();
  });

  it('a host produces the three emulator ports, together', () => {
    const plan = emulatorPlan({ EXPO_PUBLIC_AJFIT_EMULATOR_HOST: 'localhost' })!;
    expect(plan).toEqual({ host: 'localhost', auth: 9099, firestore: 8080, functions: 5001 });
  });

  it('ships disabled in the example env', () => {
    expect(ENV_EXAMPLE).toContain('EXPO_PUBLIC_AJFIT_EMULATOR_HOST=\n');
  });
});

describe('it can never reach a production build', () => {
  it('every call site is inside __DEV__', () => {
    const start = FIREBASE.indexOf('if (__DEV__) {');
    expect(start).toBeGreaterThan(-1);
    const block = FIREBASE.slice(start, FIREBASE.indexOf('export { app };', start));
    for (const symbol of ['emulatorPlan(', 'connectAjFitEmulators(', 'assertFullyIsolated(']) {
      expect(block).toContain(symbol);
      // ...and nowhere else in the module.
      expect((FIREBASE.match(new RegExp(symbol.replace('(', '\\('), 'g')) ?? [])).toHaveLength(
        symbol === 'emulatorPlan(' ? 1 : 1,
      );
    }
  });

  it('carries no credential of any kind', () => {
    for (const t of ['apiKey', 'password', 'secret', 'Bearer', 'Authorization']) {
      expect(MODULE_CODE).not.toContain(t);
    }
    // Only a host and three numeric ports ever leave this module.
    expect(MODULE_CODE).toContain('host: string;');
  });
});

describe('it is all-or-nothing', () => {
  it('connects Auth, Firestore and Functions in one call', () => {
    const start = MODULE.indexOf('export function connectAjFitEmulators(');
    const fn = MODULE.slice(start, MODULE.indexOf('export function assertFullyIsolated', start));
    expect(fn).toContain('connectAuthEmulator(');
    expect(fn).toContain('connectFirestoreEmulator(');
    expect(fn).toContain('connectFunctionsEmulator(');
  });

  it('refuses to continue when any service is still on production', () => {
    const start = MODULE.indexOf('export function assertFullyIsolated');
    const fn = MODULE.slice(start, MODULE.indexOf('export function emulatorStatus', start));
    expect(fn).toContain('throw new Error(');
    expect(fn).toContain('isolamento incompleto');
  });

  it('never swallows a connection failure', () => {
    // No try/catch anywhere: a throw from the SDK must propagate, because the
    // alternative is an app writing to the emulator while authenticating
    // against production.
    expect(MODULE_CODE).not.toContain('catch');
  });

  it('the guard runs AFTER wiring, not before', () => {
    const start = FIREBASE.indexOf('if (__DEV__) {');
    const block = FIREBASE.slice(start, FIREBASE.indexOf('export { app };', start));
    expect(block.indexOf('connectAjFitEmulators(')).toBeLessThan(block.indexOf('assertFullyIsolated()'));
  });

  it('redirects the SAME Functions instance the app uses', () => {
    // `getFunctions(app, region)` is cached per (app, region), so wiring the
    // us-central1 instance here is the one `firebaseFunctions.ts` exports.
    expect(FIREBASE).toContain("getFunctions(app, 'us-central1')");
    expect(readFileSync('src/lib/firebaseFunctions.ts', 'utf8'))
      .toContain("export const FUNCTIONS_REGION = 'us-central1'");
  });
});

describe('production defaults are untouched', () => {
  it('the real config is still read from the public env vars', () => {
    expect(FIREBASE).toContain('process.env.EXPO_PUBLIC_FIREBASE_API_KEY');
    expect(FIREBASE).toContain('getApps().length ? getApp() : initializeApp(firebaseConfig)');
  });

  it('App Check initialization is left exactly where it was', () => {
    expect(FIREBASE.indexOf('initializeFirebaseAppCheck(app)'))
      .toBeLessThan(FIREBASE.indexOf('if (__DEV__) {'));
  });
});
