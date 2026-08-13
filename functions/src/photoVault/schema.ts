/**
 * Photo Vault — data contract for the backend-managed vault document.
 *
 * Firestore path: users/{uid}/privateSecurity/photoVault
 *
 * WHY THIS LIVES IN TYPESCRIPT AND NOT IN firestore.rules
 * -------------------------------------------------------
 * The client is denied all access to this document
 * (`allow read, write: if false` — see firestore.rules), so the only writer
 * is the Admin SDK, which bypasses Security Rules entirely. A schema
 * expressed in the rules file would therefore never execute. This module is
 * the real, enforceable contract: every backend write of the vault document
 * must go through `assertValidPhotoVault` first.
 *
 * NOTE (Phase 4): nothing writes this document yet. Cloud KMS, the real
 * Vault Key and the vault callable functions are Phase 5+. This file
 * defines the shape only — it performs no I/O and holds no key material.
 */

/** The only algorithm accepted for the vault key wrapping envelope. */
export const VAULT_ALGORITHM = 'AES-256-GCM' as const;

/** Current version of the vault document format itself. */
export const CURRENT_ENCRYPTION_VERSION = 1;

/** Upper bound for the base64 wrapped key — a KMS-wrapped 256-bit DEK is far smaller. */
const MAX_WRAPPED_KEY_LENGTH = 4096;

/** Upper bound for the fully-qualified KMS CryptoKeyVersion resource name. */
const MAX_KMS_KEY_VERSION_LENGTH = 1024;

export interface PhotoVaultDocument {
  /**
   * The user's Vault Key (DEK), encrypted by the KMS-held KEK, base64.
   * NEVER logged, never returned to the client in this form, never stored
   * unwrapped.
   */
  wrappedVaultKey: string;
  /** Version of this document's format. Allows migrating the envelope later. */
  encryptionVersion: number;
  /** Version of the user's Vault Key. Bumped when the DEK itself is rotated. */
  vaultKeyVersion: number;
  /** Fully-qualified KMS CryptoKeyVersion that performed the wrap. */
  kmsKeyVersion: string;
  /** Algorithm used for photo encryption with this vault key. */
  algorithm: typeof VAULT_ALGORITHM;
  createdAt: Date;
  updatedAt: Date;
}

const REQUIRED_KEYS: readonly (keyof PhotoVaultDocument)[] = [
  'wrappedVaultKey',
  'encryptionVersion',
  'vaultKeyVersion',
  'kmsKeyVersion',
  'algorithm',
  'createdAt',
  'updatedAt',
];

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/**
 * Validates a candidate vault document against the closed schema. Returns a
 * list of human-readable problems — empty means valid.
 *
 * Deliberately returns reasons rather than throwing so callers can log a
 * summary. The reasons never include field VALUES (the wrapped key must
 * never reach a log line), only field names.
 */
export function validatePhotoVault(candidate: unknown): string[] {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return ['document must be an object'];
  }

  const doc = candidate as Record<string, unknown>;
  const problems: string[] = [];

  for (const key of REQUIRED_KEYS) {
    if (!(key in doc)) {
      problems.push(`missing required field: ${key}`);
    }
  }

  for (const key of Object.keys(doc)) {
    if (!REQUIRED_KEYS.includes(key as keyof PhotoVaultDocument)) {
      problems.push(`unexpected field: ${key}`);
    }
  }

  if ('wrappedVaultKey' in doc && !isBoundedString(doc.wrappedVaultKey, MAX_WRAPPED_KEY_LENGTH)) {
    problems.push('wrappedVaultKey must be a non-empty string within the size limit');
  }
  if ('kmsKeyVersion' in doc && !isBoundedString(doc.kmsKeyVersion, MAX_KMS_KEY_VERSION_LENGTH)) {
    problems.push('kmsKeyVersion must be a non-empty string within the size limit');
  }
  if ('encryptionVersion' in doc && !isPositiveInteger(doc.encryptionVersion)) {
    problems.push('encryptionVersion must be an integer >= 1');
  }
  if ('vaultKeyVersion' in doc && !isPositiveInteger(doc.vaultKeyVersion)) {
    problems.push('vaultKeyVersion must be an integer >= 1');
  }
  if ('algorithm' in doc && doc.algorithm !== VAULT_ALGORITHM) {
    problems.push(`algorithm must be ${VAULT_ALGORITHM}`);
  }
  if ('createdAt' in doc && !(doc.createdAt instanceof Date)) {
    problems.push('createdAt must be a Date');
  }
  if ('updatedAt' in doc && !(doc.updatedAt instanceof Date)) {
    problems.push('updatedAt must be a Date');
  }

  return problems;
}

/**
 * Throws unless `candidate` satisfies the closed vault schema. Every backend
 * write of users/{uid}/privateSecurity/photoVault must call this first.
 */
export function assertValidPhotoVault(candidate: unknown): asserts candidate is PhotoVaultDocument {
  const problems = validatePhotoVault(candidate);
  if (problems.length > 0) {
    throw new Error(`Invalid photoVault document: ${problems.join('; ')}`);
  }
}
