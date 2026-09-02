import { describe, expect, it } from 'vitest';
import {
  CIRCUIT_BREAKER_FAIL_SAFE_CONFIG,
  isOperationBlockedByCircuitBreaker,
  isValidCircuitBreakerConfig,
  type CircuitBreakerOperation,
} from '../circuitBreaker';

const BLOCKED: CircuitBreakerOperation[] = ['INITIALIZE', 'MIGRATE', 'PREPARE', 'ACTIVATE', 'ADAPT'];
const ALLOWED: CircuitBreakerOperation[] = ['RECOVER', 'EARN', 'DEFER', 'FINISH_EXECUTION', 'COMPLETE_SCHEDULE', 'RESOLVE_MISSED_SESSION'];

describe('isOperationBlockedByCircuitBreaker', () => {
  it('blocks nothing when the circuit is closed, regardless of operation', () => {
    for (const operation of [...BLOCKED, ...ALLOWED]) {
      expect(isOperationBlockedByCircuitBreaker(operation, { schemaVersion: 1, open: false })).toBe(false);
    }
  });

  it('blocks every content-producing operation when the circuit is open', () => {
    for (const operation of BLOCKED) {
      expect(isOperationBlockedByCircuitBreaker(operation, { schemaVersion: 1, open: true })).toBe(true);
    }
  });

  it('never blocks safe-recovery/current-content operations, even when the circuit is open', () => {
    for (const operation of ALLOWED) {
      expect(isOperationBlockedByCircuitBreaker(operation, { schemaVersion: 1, open: true })).toBe(false);
    }
  });

  it('the fail-safe default config never blocks anything (fails closed to normal operation, not to blocking everything)', () => {
    expect(CIRCUIT_BREAKER_FAIL_SAFE_CONFIG.open).toBe(false);
    for (const operation of [...BLOCKED, ...ALLOWED]) {
      expect(isOperationBlockedByCircuitBreaker(operation, CIRCUIT_BREAKER_FAIL_SAFE_CONFIG)).toBe(false);
    }
  });
});

describe('isValidCircuitBreakerConfig', () => {
  it('accepts the exact expected shape', () => {
    expect(isValidCircuitBreakerConfig({ schemaVersion: 1, open: true })).toBe(true);
    expect(isValidCircuitBreakerConfig({ schemaVersion: 1, open: false })).toBe(true);
  });

  it('rejects wrong schemaVersion, wrong types, extra fields, and non-objects', () => {
    expect(isValidCircuitBreakerConfig({ schemaVersion: 2, open: true })).toBe(false);
    expect(isValidCircuitBreakerConfig({ schemaVersion: 1, open: 'true' })).toBe(false);
    expect(isValidCircuitBreakerConfig({ schemaVersion: 1, open: true, extra: 1 })).toBe(false);
    expect(isValidCircuitBreakerConfig({ open: true })).toBe(false);
    expect(isValidCircuitBreakerConfig(null)).toBe(false);
    expect(isValidCircuitBreakerConfig('open')).toBe(false);
    expect(isValidCircuitBreakerConfig(undefined)).toBe(false);
  });
});
