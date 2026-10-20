import React from 'react';
import { View } from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';
import { useTheme } from '../../theme';

/**
 * The funnel's oversized outlined step number, anchored to the top-right
 * corner behind everything and untouchable.
 *
 * Every screen in the funnel renders this one component rather than its own
 * copy of the markup: the presentation slides, the name step and all 40-odd
 * question steps are a single continuous sequence to the user (see
 * `PRESENTATION_SLIDE_COUNT`), so the digit must be pixel-identical across
 * them. Three hand-maintained copies drifted apart once already.
 *
 * Sized so both digits are visible and only a small slice of the second one
 * is cropped by the right edge of the screen.
 */
const FONT_SIZE = 380;
const SVG_WIDTH = 440;
const SVG_HEIGHT = 340;

export function StepOutlineNumber({ value }: { value: number }) {
  const { theme } = useTheme();
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 14, right: -36, opacity: 0.55 }}>
      <Svg width={SVG_WIDTH} height={SVG_HEIGHT}>
        <SvgText
          x={SVG_WIDTH}
          y={SVG_HEIGHT * 0.85}
          fontFamily={theme.fonts.display}
          fontSize={FONT_SIZE}
          textAnchor="end"
          stroke={theme.colors.decorativeOutlineSoft}
          strokeWidth={1.5}
          fill="none"
        >
          {String(value).padStart(2, '0')}
        </SvgText>
      </Svg>
    </View>
  );
}
