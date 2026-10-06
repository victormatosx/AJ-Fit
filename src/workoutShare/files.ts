import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';

const ROOT = 'workout-share';
const SOURCE = 'source';
const EXPORT = 'export';

function directory(child: typeof SOURCE | typeof EXPORT): Directory {
  const value = new Directory(Paths.cache, ROOT, child);
  value.create({ intermediates: true, idempotent: true });
  return value;
}

function isOwnedUri(uri: string): boolean {
  const root = new Directory(Paths.cache, ROOT).uri;
  return uri.startsWith(root) && !uri.slice(root.length).includes('../');
}

export async function stageWorkoutSharePhoto(uri: string): Promise<string> {
  const target = new File(directory(SOURCE), `${randomUUID()}.jpg`);
  await new File(uri).copy(target);
  if (!target.exists || (target.size ?? 0) <= 0) throw new Error('empty workout share photo');
  return target.uri;
}

export function createWorkoutShareExportUri(extension: 'jpg' | 'png' = 'jpg'): string {
  return new File(directory(EXPORT), `${randomUUID()}.${extension}`).uri;
}

export function discardWorkoutShareFile(uri: string | null | undefined): void {
  if (!uri || !isOwnedUri(uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup is best-effort; no user content lives in this namespace.
  }
}

export function cleanupWorkoutShareFiles(): void {
  for (const child of [SOURCE, EXPORT] as const) {
    try {
      const dir = new Directory(Paths.cache, ROOT, child);
      if (!dir.exists) continue;
      for (const item of dir.list()) {
        if (item instanceof File && item.exists) item.delete();
      }
    } catch {
      // A later composer session retries cleanup.
    }
  }
}
