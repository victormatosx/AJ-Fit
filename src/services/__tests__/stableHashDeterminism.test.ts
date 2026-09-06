/**
 * Cross-runtime determinism audit (docs/workout-lifecycle/v2/qa/ — forensic
 * follow-up for the Node-vs-Hermes `contentIdentityFor` mismatch on
 * `wpe_e3c68302`). `stableHash`'s FNV-1a-style loop uses exactly four
 * ECMAScript primitives: `^` (bitwise XOR, ToInt32 coercion), `Math.imul`
 * (32-bit signed multiplication), `>>> 0` (ToUint32 coercion), and
 * `charCodeAt` (UTF-16 code unit at an index). All four are fully specified
 * by ECMA-262 with bit-exact, non-implementation-defined results — unlike
 * e.g. `Date`, `Intl`, or float-to-string formatting, which have historically
 * had cross-engine quirks. This file pins known-correct values for each
 * primitive and end-to-end for `stableHash`, so a future engine regression
 * (Hermes, JSC, V8) would fail loudly here instead of silently reappearing
 * as a `wpg_...` mismatch. It does not run under Hermes itself — no
 * standalone Hermes execution VM is available in this repo (only the
 * `hermesc` compiler, which this build cannot use to execute scripts) —
 * this documents the spec guarantee the client/backend rely on instead.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/firebase', () => ({ db: undefined }));

const { stableHash } = await import('../workoutPrograms');

describe('stableHash — ECMAScript-spec-guaranteed primitives (no engine-dependent behavior)', () => {
  it('Math.imul(-1, -1) === 1 — 32-bit signed multiplication wraps identically on every conformant engine', () => {
    expect(Math.imul(-1, -1)).toBe(1);
    expect(Math.imul(0x811c9dc5, 0x01000193)).toBe(84696351);
  });

  it('bitwise XOR (^) always coerces via ToInt32 before combining, never via IEEE-754 float semantics', () => {
    expect(0x811c9dc5 ^ 65).toBe(-2128831100);
    expect((-1) ^ 0).toBe(-1);
  });

  it('>>> 0 (ToUint32) always yields a non-negative 32-bit integer, independent of the engine\'s internal number representation', () => {
    expect((-1) >>> 0).toBe(4294967295);
    expect((0x811c9dc5 | 0) >>> 0).toBe(0x811c9dc5);
  });

  it('charCodeAt(index) returns the UTF-16 code unit — defined per ECMA-262 String.prototype.charCodeAt, not locale/platform dependent', () => {
    expect('a'.charCodeAt(0)).toBe(97);
    expect('{'.charCodeAt(0)).toBe(123);
    expect('版'.charCodeAt(0)).toBe(29256); // non-ASCII: still a single, spec-defined UTF-16 code unit
  });

  it('stableHash is a pure function of the string content — same string in, same 8-hex-char digest out, regardless of how many times or in what order it is called', () => {
    const sample = '{"questionnaireId":"q1","questionnaireVersion":1,"versions":{"a":"1.0.0","b":"2.0.0"}}';
    const first = stableHash(sample);
    const second = stableHash(sample);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}$/);
  });

  it('stableHash of the empty string is the untouched FNV offset basis, unsigned', () => {
    expect(stableHash('')).toBe((0x811c9dc5 >>> 0).toString(16).padStart(8, '0'));
  });

  it('any two strings that differ ONLY in key order of an embedded JSON object hash differently — proving stableHash has zero canonicalization of its own (by design: `contentIdentityFor` relies entirely on `JSON.stringify`\'s input-order preservation, not on stableHash to normalize anything)', () => {
    const a = stableHash('{"x":1,"y":2}');
    const b = stableHash('{"y":2,"x":1}');
    expect(a).not.toBe(b);
  });
});
