import { StyleProp, ViewStyle } from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';
import { useTheme } from '../../theme';

/**
 * Real hollow outline text using SVG (RN's <Text> can't stroke). The interior
 * is transparent — only the thin stroke traces the number/letter shape.
 */
export function OutlineNumber({
  children,
  size = 200,
  color,
  strokeWidth = 1.5,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const text = String(children);
  // Anton is a very condensed display face — width ≈ 0.55 × size per glyph.
  // Vertical box needs headroom for the full ascender + strokeWidth on both sides,
  // otherwise the top of the glyph gets clipped by the SVG viewBox.
  const ascender = size * 0.92;
  const descender = size * 0.22;
  const height = ascender + descender + strokeWidth * 2;
  const width = Math.max(size * 0.6 * text.length, size * 0.6) + strokeWidth * 2;
  const baseline = ascender + strokeWidth;

  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={style}
      pointerEvents="none"
    >
      <SvgText
        x={width / 2}
        y={baseline}
        fill="none"
        stroke={color ?? theme.colors.decorativeOutline}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        fontFamily={theme.fonts.display}
        fontSize={size}
        textAnchor="middle"
        letterSpacing={0.5}
      >
        {text}
      </SvgText>
    </Svg>
  );
}
