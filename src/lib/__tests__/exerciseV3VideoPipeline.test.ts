import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  displayedDimensions, prepareVideo, sourceErrors, technicalErrors, transcodeArguments,
  type VideoSource,
} from '../../../scripts/lib/exerciseV3VideoPipeline';

const ids = new Set(['dumbbell-flat-bench-press']);
const source = (): VideoSource => ({
  exerciseId: 'dumbbell-flat-bench-press', file: '/local/authorized.mov',
  orientation: 'horizontal', startSeconds: 1, durationSeconds: 8,
  provenance: {
    author: 'Fixture author', sourceUrl: 'https://example.com/source',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', commercialUseVerified: true,
  },
});
const probe = () => ({
  streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1920, height: 1080 }],
  format: { duration: '15' },
});

describe.runIf(process.env.V3_VIDEO_FFMPEG_TESTS === '1')('real local ffmpeg smoke test — synthetic fixture, never a demonstration', () => {
  it('removes actual audio, preserves source, decodes the output and never auto-approves or overwrites', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ajfit-v3-video-test-'));
    try {
      const file = join(directory, 'SYNTHETIC-TEST-ONLY.mp4');
      execFileSync('ffmpeg', [
        '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=832x468:r=30:d=5',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
      ]);
      const original = readFileSync(file);
      const input = { ...source(), file, startSeconds: 0, durationSeconds: 3 };
      const { output, record } = prepareVideo(input, ids, join(directory, 'output'));
      expect(existsSync(output)).toBe(true);
      expect(record.probe.streams).toHaveLength(1);
      expect(record.probe.streams[0].codec_name).toBe('h264');
      expect(record.biomechanicalReview).toBe('pending');
      expect(record.status).toBe('PRODUZIDO — AGUARDANDO REVISÃO');
      expect(readFileSync(file).equals(original)).toBe(true);
      expect(() => prepareVideo(input, ids, join(directory, 'output'))).toThrow('OUTPUT_ALREADY_EXISTS');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
