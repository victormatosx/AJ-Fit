import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

export interface VideoSource {
  exerciseId: string;
  file: string;
  orientation: 'horizontal' | 'vertical';
  startSeconds: number;
  durationSeconds: number;
  provenance: { author: string; sourceUrl: string; licenseUrl: string; commercialUseVerified: boolean };
}

interface Probe {
  streams: {
    codec_type: string; codec_name?: string; width?: number; height?: number;
    pix_fmt?: string; color_transfer?: string; r_frame_rate?: string;
    side_data_list?: { rotation?: number }[];
  }[];
  format: { duration: string };
}

export function probeVideo(file: string): Probe {
  return JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', file,
  ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })) as Probe;
}

export function displayedDimensions(probe: Probe): { width: number; height: number } {
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('VIDEO_DIMENSIONS_MISSING');
  const rotation = video.side_data_list?.find((item) => item.rotation !== undefined)?.rotation ?? 0;
  return Math.abs(rotation) % 180 === 90
    ? { width: video.height, height: video.width }
    : { width: video.width, height: video.height };
}

export function sourceErrors(source: VideoSource, probe: Probe, draftIds: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  if (!draftIds.has(source.exerciseId)) errors.push('UNKNOWN_DRAFT_EXERCISE');
  if (!['horizontal', 'vertical'].includes(source.orientation)) errors.push('INVALID_ORIENTATION');
  if (!source.provenance?.commercialUseVerified || !source.provenance.author?.trim()
    || !/^https:\/\//.test(source.provenance.sourceUrl ?? '')
    || !/^https:\/\//.test(source.provenance.licenseUrl ?? '')) errors.push('PROVENANCE_REQUIRED');
  if (!Number.isFinite(source.startSeconds) || source.startSeconds < 0
    || !Number.isFinite(source.durationSeconds) || source.durationSeconds < 3 || source.durationSeconds > 30
    || source.startSeconds + source.durationSeconds > Number(probe.format.duration)) errors.push('INVALID_TRIM');
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  if (!video) return [...errors, 'VIDEO_STREAM_MISSING'];
  // Explicitly stop for HDR instead of silently relabeling HLG/PQ as SDR.
  if (['arib-std-b67', 'smpte2084'].includes(video.color_transfer ?? '')) errors.push('HDR_REQUIRES_REVIEWED_TONEMAP');
  const { width, height } = displayedDimensions(probe);
  if (source.orientation === 'vertical' ? height <= width : width <= height) errors.push('ORIENTATION_MISMATCH');
  if (Math.min(width, height) < 464) errors.push('SOURCE_RESOLUTION_TOO_LOW');
  return errors;
}

export function transcodeArguments(source: VideoSource, output: string): string[] {
  const bounds = source.orientation === 'horizontal'
    ? "w='min(iw,1280)':h='min(ih,720)'"
    : "w='min(iw,720)':h='min(ih,1280)'";
  return [
    '-v', 'error', '-nostdin', '-ss', String(source.startSeconds), '-i', source.file,
    '-t', String(source.durationSeconds), '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1',
    // Never crop joints, mirror, reverse a rep, retime motion, or interpolate anatomy.
    '-vf', `scale=${bounds}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p`,
    '-c:v', 'libx264', '-profile:v', 'main', '-crf', '20', '-preset', 'medium',
    '-movflags', '+faststart', '-n', output,
  ];
}

export function technicalErrors(probe: Probe, orientation: VideoSource['orientation']): string[] {
  const errors: string[] = [];
  const video = probe.streams.filter((stream) => stream.codec_type === 'video');
  if (video.length !== 1 || video[0].codec_name !== 'h264' || video[0].pix_fmt !== 'yuv420p') errors.push('H264_YUV420P_REQUIRED');
  if (probe.streams.some((stream) => stream.codec_type !== 'video')) errors.push('ONLY_SILENT_VIDEO_ALLOWED');
  if (!video[0]) return errors;
  const { width, height } = displayedDimensions(probe);
  if (orientation === 'vertical' ? height <= width : width <= height) errors.push('ORIENTATION_MISMATCH');
  if (Math.min(width, height) < 464) errors.push('OUTPUT_RESOLUTION_TOO_LOW');
  if (width % 2 || height % 2) errors.push('ODD_DIMENSIONS');
  return errors;
}

export function prepareVideo(source: VideoSource, draftIds: ReadonlySet<string>, outDirectory: string) {
  if (!existsSync(source.file)) throw new Error('SOURCE_FILE_MISSING');
  const inputProbe = probeVideo(source.file);
  const errors = sourceErrors(source, inputProbe, draftIds);
  if (errors.length) throw new Error(errors.join(','));
  const outDir = resolve(outDirectory);
  const output = resolve(outDir, `${source.exerciseId}-${source.orientation}.mp4`);
  if (existsSync(output)) throw new Error('OUTPUT_ALREADY_EXISTS');
  mkdirSync(outDir, { recursive: true });
  const temporary = resolve(outDir, `.${basename(output)}.partial.mp4`);
  if (existsSync(temporary)) throw new Error('PARTIAL_OUTPUT_ALREADY_EXISTS');
  try {
    execFileSync('ffmpeg', transcodeArguments(source, temporary), { stdio: 'pipe' });
    const result = probeVideo(temporary);
    const outputErrors = technicalErrors(result, source.orientation);
    if (Math.abs(Number(result.format.duration) - source.durationSeconds) > 0.15) outputErrors.push('OUTPUT_DURATION_MISMATCH');
    if (outputErrors.length) throw new Error(outputErrors.join(','));
    execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', temporary, '-f', 'null', '-'], { stdio: 'pipe' });
    renameSync(temporary, output);
    const record = {
      exerciseId: source.exerciseId, orientation: source.orientation,
      file: basename(output), sha256: createHash('sha256').update(readFileSync(output)).digest('hex'),
      sourceSha256: createHash('sha256').update(readFileSync(source.file)).digest('hex'),
      trim: { startSeconds: source.startSeconds, durationSeconds: source.durationSeconds },
      provenance: source.provenance, probe: result,
      status: 'PRODUZIDO — AGUARDANDO REVISÃO',
      biomechanicalReview: 'pending', loopReview: 'pending', nativePlaybackReview: 'pending',
      changes: 'Trim, resize without cropping, H.264/yuv420p encoding, audio/metadata removal, MP4 faststart.',
    };
    writeFileSync(`${output}.json`, `${JSON.stringify(record, null, 2)}\n`);
    return { output, record };
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function writeContactSheet(file: string, output: string): void {
  const duration = Number(probeVideo(file).format.duration);
  mkdirSync(dirname(output), { recursive: true });
  execFileSync('ffmpeg', [
    '-v', 'error', '-nostdin', '-i', file, '-vf',
    `fps=${12 / duration},scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2,tile=4x3`,
    '-frames:v', '1', '-n', output,
  ], { stdio: 'pipe' });
}
