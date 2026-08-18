export type GuidedWorkoutSlideId = 'guide' | 'progress' | 'execution';

export type GuidedWorkoutSlide = {
  id: GuidedWorkoutSlideId;
  /** Bundled portrait demo clip, native 384x848 frame. */
  source: number;
};

export const guidedWorkoutShowcaseSlides: GuidedWorkoutSlide[] = [
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- static asset require, path fixed at build time
  { id: 'guide', source: require('../../assets/videos/video-01.mp4') },
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- static asset require, path fixed at build time
  { id: 'progress', source: require('../../assets/videos/video-02.mp4') },
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- static asset require, path fixed at build time
  { id: 'execution', source: require('../../assets/videos/video-03.mp4') },
];
