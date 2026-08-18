import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ACTIONS_OUT_OF_SCOPE,
  canPerformPremiumCapability,
  resolvePremiumCapabilities,
  type PremiumAccessState,
  type PremiumCapability,
} from '../premiumCapabilities';

const ALL_CAPABILITIES: PremiumCapability[] = [
  'START_WORKOUT',
  'VIEW_WORKOUT_DETAILS',
  'REGISTER_WORKOUT',
  'REGISTER_LOAD',
  'REGISTER_BODY_WEIGHT',
  'REGISTER_MEASUREMENTS',
  'ADD_PROGRESS_PHOTO',
  'DELETE_PROGRESS_PHOTO',
  'CREATE_ASSESSMENT',
];

const premiumResolved: PremiumAccessState = { isPremium: true, resolved: true };
const freeResolved: PremiumAccessState = { isPremium: false, resolved: true };
const premiumUnresolved: PremiumAccessState = { isPremium: true, resolved: false };
const freeUnresolved: PremiumAccessState = { isPremium: false, resolved: false };

describe('canPerformPremiumCapability', () => {
  it.each(ALL_CAPABILITIES)('Premium ativo e resolvido: %s -> true', (capability) => {
    expect(canPerformPremiumCapability(capability, premiumResolved)).toBe(true);
  });

  it.each(ALL_CAPABILITIES)('Premium inativo e resolvido: %s -> false', (capability) => {
    expect(canPerformPremiumCapability(capability, freeResolved)).toBe(false);
  });

  it.each(ALL_CAPABILITIES)(
    'estado ainda não resolvido nunca libera, mesmo com isPremium=true (fail-closed): %s -> false',
    (capability) => {
      expect(canPerformPremiumCapability(capability, premiumUnresolved)).toBe(false);
    },
  );

  it.each(ALL_CAPABILITIES)(
    'estado ainda não resolvido e sem Premium: %s -> false',
    (capability) => {
      expect(canPerformPremiumCapability(capability, freeUnresolved)).toBe(false);
    },
  );

  it('reage à mudança de isPremium sem exigir recriação de estado — true -> false', () => {
    const access: PremiumAccessState = { isPremium: true, resolved: true };
    expect(canPerformPremiumCapability('START_WORKOUT', access)).toBe(true);
    const revoked: PremiumAccessState = { ...access, isPremium: false };
    expect(canPerformPremiumCapability('START_WORKOUT', revoked)).toBe(false);
  });

  it('reage à mudança de isPremium sem exigir recriação de estado — false -> true', () => {
    const access: PremiumAccessState = { isPremium: false, resolved: true };
    expect(canPerformPremiumCapability('REGISTER_LOAD', access)).toBe(false);
    const granted: PremiumAccessState = { ...access, isPremium: true };
    expect(canPerformPremiumCapability('REGISTER_LOAD', granted)).toBe(true);
  });

  it('é uma função pura e síncrona: mesma entrada sempre produz a mesma saída', () => {
    const a = canPerformPremiumCapability('CREATE_ASSESSMENT', premiumResolved);
    const b = canPerformPremiumCapability('CREATE_ASSESSMENT', premiumResolved);
    expect(a).toBe(b);
  });
});

describe('resolvePremiumCapabilities — exaustividade', () => {
  it('Premium ativo e resolvido libera todas as capabilities do catálogo', () => {
    const result = resolvePremiumCapabilities(premiumResolved);
    for (const capability of ALL_CAPABILITIES) {
      expect(result[capability]).toBe(true);
    }
    expect(Object.keys(result).sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  it('Premium inativo nega todas as capabilities do catálogo', () => {
    const result = resolvePremiumCapabilities(freeResolved);
    for (const capability of ALL_CAPABILITIES) {
      expect(result[capability]).toBe(false);
    }
  });

  it('estado não resolvido nega todas as capabilities, mesmo com isPremium=true', () => {
    const result = resolvePremiumCapabilities(premiumUnresolved);
    for (const capability of ALL_CAPABILITIES) {
      expect(result[capability]).toBe(false);
    }
  });

  it('resolvePremiumCapabilities e canPerformPremiumCapability nunca divergem para a mesma entrada', () => {
    for (const access of [premiumResolved, freeResolved, premiumUnresolved, freeUnresolved]) {
      const bulk = resolvePremiumCapabilities(access);
      for (const capability of ALL_CAPABILITIES) {
        expect(bulk[capability]).toBe(canPerformPremiumCapability(capability, access));
      }
    }
  });
});

describe('escopo do catálogo Premium', () => {
  it('não inclui ações básicas de conta como capability Premium', () => {
    for (const accountAction of ACCOUNT_ACTIONS_OUT_OF_SCOPE) {
      expect(ALL_CAPABILITIES).not.toContain(accountAction);
    }
  });

  it('documenta explicitamente quais ações de conta ficam fora desta fase', () => {
    expect(ACCOUNT_ACTIONS_OUT_OF_SCOPE).toEqual(
      expect.arrayContaining([
        'VIEW_PROFILE',
        'EDIT_PROFILE',
        'CHANGE_PROFILE_PHOTO',
        'CHANGE_LANGUAGE',
        'CHANGE_UNITS',
        'OPEN_SETTINGS',
        'CONTACT_SUPPORT',
        'LOGOUT',
        'MANAGE_SUBSCRIPTION',
        'RESTORE_PURCHASES',
      ]),
    );
  });
});
