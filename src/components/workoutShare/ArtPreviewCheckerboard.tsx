import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

/**
 * Preview-only hint that the ARTE canvas behind it is transparent — never
 * part of what `captureWorkoutShareArt` captures (it must render as a
 * sibling of, never a descendant of, the `posterRef`'d poster `View`). A
 * single SVG pattern tile instead of a grid of RN `View`s, so its cost
 * doesn't scale with the preview box size.
 */
export function ArtPreviewCheckerboard({ width, height }: { width: number; height: number }) {
  const square = Math.max(10, Math.round(width / 16));
  return (
    <Svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
      <Defs>
        <Pattern id="workout-share-art-checker" width={square * 2} height={square * 2} patternUnits="userSpaceOnUse">
          <Rect x={0} y={0} width={square * 2} height={square * 2} fill="#1C1C1E" />
          <Rect x={0} y={0} width={square} height={square} fill="#2C2C2E" />
          <Rect x={square} y={square} width={square} height={square} fill="#2C2C2E" />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#workout-share-art-checker)" />
    </Svg>
  );
}
