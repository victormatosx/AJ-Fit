import { describe, it, expect } from 'vitest';
import { assertResourceParity, extractLeafPaths, inspectResourceParity } from '../resourceParity';
import { NAMESPACES, resources } from '../resourceCatalog';
import auditAllowlist from '../resource-audit-allowlist.json';

const ptBRCommon = resources['pt-BR'].common;
const enCommon = resources.en.common;
const esCommon = resources.es.common;
const ptBRErrors = resources['pt-BR'].errors;

/**
 * Every namespace shipped by src/i18n must obey structural parity:
 *   • the same set of leaf paths across pt-BR, en, es;
 *   • no empty strings;
 *   • no orphan keys in a single locale.
 *
 * Reference is pt-BR because it's the CustomTypeOptions source of truth.
 * The runtime registry is the only namespace list; adding a namespace there
 * automatically enrolls it in this suite.
 */
describe('i18n resources — structural parity across pt-BR, en, es', () => {
  for (const ns of NAMESPACES) {
    it(`${ns}: every locale exposes the same key tree, no empty leaves`, () => {
      assertResourceParity(ns, {
        'pt-BR': resources['pt-BR'][ns],
        en: resources.en[ns],
        es: resources.es[ns],
      }, auditAllowlist.nonStringLeaves
        .filter((entry) => entry.startsWith(`${ns}:`))
        .map((entry) => entry.slice(ns.length + 1)));
    });
  }

  it('reports non-string leaves instead of silently ignoring them', () => {
    expect(inspectResourceParity({ 'pt-BR': { ok: 'sim' }, en: { ok: 1 } })).toContainEqual({
      locale: 'en',
      path: 'ok',
      reason: 'non-string',
    });
  });

  it('keeps the legacy non-string allowlist explicit and limited to Home mock data', () => {
    expect(auditAllowlist.nonStringLeaves).toHaveLength(6);
    expect(auditAllowlist.nonStringLeaves.every((entry) => entry.startsWith('home:upcoming.items.'))).toBe(true);
  });
});

describe('i18n resources — required shared vocabulary is present', () => {
  it('common exposes the shared action set', () => {
    const paths = extractLeafPaths(ptBRCommon);
    for (const required of [
      'actions.continue',
      'actions.cancel',
      'actions.save',
      'actions.close',
      'actions.back',
      'actions.retry',
      'actions.confirm',
      'actions.delete',
      'actions.edit',
    ]) {
      expect(paths, `missing common:${required}`).toContain(required);
    }
  });

  it('common exposes shared status labels', () => {
    const paths = extractLeafPaths(ptBRCommon);
    for (const required of [
      'status.loading',
      'status.saving',
      'status.success',
      'status.empty',
    ]) {
      expect(paths, `missing common:${required}`).toContain(required);
    }
  });

  it('common exposes shared accessibility labels', () => {
    const paths = extractLeafPaths(ptBRCommon);
    for (const required of [
      'accessibility.day',
      'accessibility.month',
      'accessibility.year',
    ]) {
      expect(paths, `missing common:${required}`).toContain(required);
    }
  });

  it('errors exposes the generic vocabulary', () => {
    const paths = extractLeafPaths(ptBRErrors);
    for (const required of [
      'generic.title',
      'generic.message',
      'network.unavailable',
      'network.timeout',
      'operation.failed',
      'operation.tryAgain',
    ]) {
      expect(paths, `missing errors:${required}`).toContain(required);
    }
  });
});

describe('i18n resources — action translations diverge across languages', () => {
  it.each([
    ['actions.continue', ptBRCommon.actions.continue, enCommon.actions.continue, esCommon.actions.continue],
    ['actions.save', ptBRCommon.actions.save, enCommon.actions.save, esCommon.actions.save],
    ['actions.back', ptBRCommon.actions.back, enCommon.actions.back, esCommon.actions.back],
    ['actions.close', ptBRCommon.actions.close, enCommon.actions.close, esCommon.actions.close],
  ])('%s: en value differs from pt-BR', (_key, pt, en) => {
    // Not a hard rule (pt/es often coincide), but en should never equal pt
    // — if it does we probably forgot to translate.
    expect(en).not.toBe(pt);
  });

  it('actions.retry uses natural language per locale', () => {
    expect(ptBRCommon.actions.retry).toBe('Tentar novamente');
    expect(enCommon.actions.retry).toBe('Try again');
    expect(esCommon.actions.retry).toBe('Reintentar');
  });
});
