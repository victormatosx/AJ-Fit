import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('account deletion — Support V2 boundary', () => {
  it('cannot regress to the removed Support V1 collection', () => {
    const accountDeletionRoot = resolve(__dirname, '..');
    const removedCollectionName = ['support', 'Tickets'].join('');
    const offenders = sourceFiles(accountDeletionRoot)
      .filter((path) => readFileSync(path, 'utf8').includes(removedCollectionName));

    expect(offenders).toEqual([]);
  });
});
