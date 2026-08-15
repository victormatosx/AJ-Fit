/**
 * AJ Fit design tokens.
 *
 * Keep primitives in this file and consume the semantic names in UI code.
 * Existing color/font/radius keys are intentionally preserved for backwards
 * compatibility with screens created before the design system was formalized.
 */

export const palette = {
  black: '#000000',
  ink950: '#020010',
  ink900: '#060220',
  ink850: '#0a0620',
  navy800: '#04021c',
  navy700: '#051042',
  navy600: '#0a1a55',
  blue700: '#0b70f9',
  blue600: '#1f82ff',
  blue500: '#4da3ff',
  blue400: '#7db4ff',
  white: '#ffffff',
  green500: '#22c55e',
  green400: '#60d99a',
  orange500: '#d95926',
  orange400: '#ffa840',
  yellow500: '#f5a623',
  red500: '#f0563f',
  red400: '#ff7676',
  red300: '#ff9a9a',
} as const;

export const alpha = {
  white02: 'rgba(255,255,255,0.02)',
  white03: 'rgba(255,255,255,0.03)',
  white04: 'rgba(255,255,255,0.04)',
  white05: 'rgba(255,255,255,0.05)',
  white06: 'rgba(255,255,255,0.06)',
  white07: 'rgba(255,255,255,0.07)',
  white08: 'rgba(255,255,255,0.08)',
  white09: 'rgba(255,255,255,0.09)',
  white10: 'rgba(255,255,255,0.10)',
  white12: 'rgba(255,255,255,0.12)',
  white18: 'rgba(255,255,255,0.18)',
  white20: 'rgba(255,255,255,0.20)',
  white22: 'rgba(255,255,255,0.22)',
  white32: 'rgba(255,255,255,0.32)',
  white35: 'rgba(255,255,255,0.35)',
  white40: 'rgba(255,255,255,0.40)',
  white55: 'rgba(255,255,255,0.55)',
  white65: 'rgba(255,255,255,0.65)',
  white85: 'rgba(255,255,255,0.85)',
  blue07: 'rgba(11,112,249,0.07)',
  blue12: 'rgba(11,112,249,0.12)',
  blue14: 'rgba(11,112,249,0.14)',
  blue16: 'rgba(11,112,249,0.16)',
  blue18: 'rgba(11,112,249,0.18)',
  blue30: 'rgba(11,112,249,0.30)',
  blue40: 'rgba(11,112,249,0.40)',
  blue55: 'rgba(11,112,249,0.55)',
  scrim55: 'rgba(0,0,0,0.55)',
  scrim84: 'rgba(0,0,0,0.84)',
} as const;

/** Semantic color roles. Prefer these names in new UI. */
export const colors = {
  bg: palette.ink950,
  bg2: palette.ink900,
  bgGradTop: '#0a0530',
  bgGradBottom: '#051236',
  surface: alpha.white03,
  surfaceRaised: alpha.white05,
  surfacePressed: alpha.white06,
  surfaceSelected: alpha.blue12,
  accent: palette.blue700,
  accentHi: palette.blue500,
  accentSoft: alpha.blue16,
  text: palette.white,
  textSecondary: alpha.white65,
  mute: alpha.white55,
  faint: alpha.white32,
  disabled: alpha.white32,
  hair: alpha.white08,
  border: alpha.white07,
  borderStrong: alpha.white12,
  focus: palette.blue500,
  success: palette.green500,
  warning: palette.orange400,
  danger: palette.red500,
  dangerText: palette.red300,
  overlay: alpha.scrim55,
  overlayStrong: alpha.scrim84,
  cardBg: alpha.white03,
  cardBgHi: alpha.white05,
  cardBorder: alpha.white07,
} as const;

export const gradients = {
  brand: [palette.blue600, palette.blue700] as const,
  background: ['#0a0530', '#051236'] as const,
  poster: [palette.navy600, palette.navy700, palette.navy800] as const,
  glass: [alpha.white05, 'rgba(255,255,255,0.015)'] as const,
  accentWash: ['rgba(11,112,249,0.24)', 'rgba(11,112,249,0.04)'] as const,
} as const;

export const fonts = {
  display: 'Anton_400Regular',
  ui: 'Archivo_400Regular',
  uiMed: 'Archivo_500Medium',
  uiSemi: 'Archivo_600SemiBold',
  uiBold: 'Archivo_700Bold',
  mono: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

// Anton has tall glyph metrics that iOS (not Android — Android's
// includeFontPadding already reserves this space by default) crops the top
// of the glyph whenever lineHeight is too tight. 1.15x looked reasonable on
// paper but still clipped real iPhones (confirmed on the Analyzing screen's
// percentage digits and the Presentation screen's headline — see
// docs/08_log_de_evolucao.md 2026-08-16); 1.45x is the smallest ratio that
// held up. Always derive display line height with this helper — never
// hardcode a lineHeight next to fonts.display.
export const displayLineHeight = (size: number) => Math.round(size * 1.45);

/** Canonical text roles. Values are React Native TextStyle-compatible. */
export const typography = {
  displayHero: {
    fontFamily: fonts.display,
    fontSize: 46,
    lineHeight: displayLineHeight(46),
    letterSpacing: 0.5,
  },
  displayLarge: {
    fontFamily: fonts.display,
    fontSize: 38,
    lineHeight: displayLineHeight(38),
    letterSpacing: 0.5,
  },
  displayMedium: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: displayLineHeight(34),
    letterSpacing: 0.5,
  },
  displaySmall: {
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: displayLineHeight(26),
    letterSpacing: 0.5,
  },
  title: { fontFamily: fonts.uiBold, fontSize: 17, lineHeight: 22 },
  subtitle: { fontFamily: fonts.uiSemi, fontSize: 14.5, lineHeight: 20 },
  body: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 21 },
  bodySmall: { fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18 },
  button: { fontFamily: fonts.display, fontSize: 17, letterSpacing: 1.5 },
  label: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2 },
  labelStrong: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 2 },
  data: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.5 },
} as const;

/** 4 pt base grid. Half steps support the compact density already in use. */
export const spacing = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  4.5: 18,
  5: 20,
  5.5: 22,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
} as const;

export const radii = {
  xs: 6,
  sm: 8,
  control: 10,
  md: 12,
  lg: 14,
  xl: 16,
  xxl: 18,
  pill: 999,
} as const;

export const sizes = {
  controlSm: 40,
  controlMd: 48,
  controlLg: 58,
  iconSm: 14,
  iconMd: 18,
  iconLg: 22,
  screenGutter: 22,
  contentMaxWidth: 420,
  modalMaxWidth: 340,
  hairline: 1,
} as const;

export const opacity = {
  pressed: 0.82,
  disabled: 0.35,
  subtle: 0.55,
} as const;

export const shadows = {
  accent: {
    shadowColor: palette.blue700,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 30,
    elevation: 12,
  },
  card: {
    shadowColor: palette.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 8,
  },
  nav: {
    shadowColor: palette.black,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 12,
  },
} as const;

export const motion = {
  duration: { fast: 120, normal: 200, slow: 320 },
  tickerLoop: 18000,
} as const;

export const designTokens = {
  palette,
  alpha,
  colors,
  gradients,
  fonts,
  typography,
  spacing,
  radii,
  sizes,
  opacity,
  shadows,
  motion,
} as const;
