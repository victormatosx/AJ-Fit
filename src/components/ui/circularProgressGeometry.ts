export function circularProgressGeometry(size: number) {
  'worklet';
  const stroke = size * (11 / 224);
  return { stroke, radius: (size - stroke * 2.9) / 2, center: size / 2 };
}

/** Top-left of an upright mascot centered on the arc's clockwise endpoint. */
export function circularProgressTip(size: number, progress: number, tipSize: number) {
  'worklet';
  const { radius, center } = circularProgressGeometry(size);
  const angle = Math.max(0, Math.min(100, progress)) / 100 * Math.PI * 2 - Math.PI / 2;
  return {
    x: center + radius * Math.cos(angle) - tipSize / 2,
    y: center + radius * Math.sin(angle) - tipSize / 2,
    size: tipSize,
    rotate: 0,
  };
}

type ScreenRect = { pageX: number; pageY: number; width: number };

/** Convert both native measurements from screen space into the stage's space. */
export function measuredCircularProgressTip(ring: ScreenRect, stage: ScreenRect, progress: number, tipSize: number) {
  'worklet';
  const tip = circularProgressTip(ring.width, progress, tipSize);
  return { ...tip, x: ring.pageX - stage.pageX + tip.x, y: ring.pageY - stage.pageY + tip.y };
}

type MascotPose = { x: number; y: number; size: number; rotate?: number };

/** The destination is remeasured each frame while the screen itself enters. */
export function interpolateMascotArrival(from: MascotPose, to: MascotPose, progress: number) {
  'worklet';
  const p = Math.max(0, Math.min(1, progress));
  return {
    x: from.x + (to.x - from.x) * p,
    y: from.y + (to.y - from.y) * p,
    size: from.size + (to.size - from.size) * p,
    rotate: (from.rotate ?? 0) * (1 - p) + (to.rotate ?? 0) * p,
  };
}
