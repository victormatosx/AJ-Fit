import React from 'react';
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '../../theme';

export type IconName =
  | 'bolt' | 'dumbbell' | 'home' | 'chart' | 'user' | 'play'
  | 'arrow-right' | 'arrow-left' | 'check' | 'plus' | 'minus'
  | 'calendar' | 'sparkles' | 'target' | 'flame' | 'timer'
  | 'heart' | 'apple' | 'utensils' | 'lock' | 'lock-open' | 'mail' | 'eye' | 'settings'
  | 'crown' | 'chevron-right' | 'chevron-down' | 'x' | 'swap' | 'list' | 'shield'
  | 'trophy' | 'camera' | 'google' | 'instagram' | 'share'
  | 'bell' | 'moon' | 'globe' | 'ruler' | 'download' | 'trash' | 'help-circle'
  | 'message' | 'alert-triangle' | 'info' | 'file-text' | 'key' | 'star' | 'search' | 'copy' | 'run' | 'refresh';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  stroke?: number;
  /** Filled state for icons that support selection, currently the heart. */
  filled?: boolean;
};

export function Icon({ name, size = 22, color: colorProp, stroke = 1.7, filled = false }: Props) {
  const { theme } = useTheme();
  const color = colorProp ?? theme.colors.textPrimary;
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
  };
  const p = {
    stroke: color,
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  switch (name) {
    case 'bolt':
      return <Svg {...common}><Path {...p} d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></Svg>;
    case 'dumbbell':
      return <Svg {...common}><Path {...p} d="M3 9v6M7 6v12M17 6v12M21 9v6M7 12h10" /></Svg>;
    case 'home':
      return <Svg {...common}><Path {...p} d="M3 11l9-8 9 8v9a2 2 0 01-2 2h-4v-7H9v7H5a2 2 0 01-2-2v-9z" /></Svg>;
    case 'chart':
      return <Svg {...common}><Path {...p} d="M3 20h18M6 16V10M11 16V6M16 16v-4M21 16V8" /></Svg>;
    case 'user':
      return <Svg {...common}><Circle {...p} cx="12" cy="8" r="4" /><Path {...p} d="M4 21c0-4 4-7 8-7s8 3 8 7" /></Svg>;
    case 'play':
      return <Svg {...common}><Path d="M6 4l14 8-14 8V4z" fill={color} /></Svg>;
    case 'arrow-right':
      return <Svg {...common}><Path {...p} d="M5 12h14M13 5l7 7-7 7" /></Svg>;
    case 'arrow-left':
      return <Svg {...common}><Path {...p} d="M19 12H5M11 5l-7 7 7 7" /></Svg>;
    case 'check':
      return <Svg {...common}><Path {...p} d="M4 12l5 5L20 6" /></Svg>;
    case 'plus':
      return <Svg {...common}><Path {...p} d="M12 5v14M5 12h14" /></Svg>;
    case 'minus':
      return <Svg {...common}><Path {...p} d="M5 12h14" /></Svg>;
    case 'calendar':
      return <Svg {...common}><Rect {...p} x="3" y="5" width="18" height="16" rx="2" /><Path {...p} d="M3 9h18M8 3v4M16 3v4" /></Svg>;
    case 'sparkles':
      return <Svg {...common}><Path {...p} d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" /></Svg>;
    case 'target':
      return <Svg {...common}><Circle {...p} cx="12" cy="12" r="9" /><Circle {...p} cx="12" cy="12" r="5" /><Circle cx="12" cy="12" r="1.2" fill={color} /></Svg>;
    case 'flame':
      return <Svg {...common}><Path {...p} d="M12 2c2 5 6 6 6 11a6 6 0 11-12 0c0-3 2-5 2-8 1 3 3 3 4-3z" /></Svg>;
    case 'timer':
      return <Svg {...common}><Circle {...p} cx="12" cy="13" r="8" /><Path {...p} d="M12 9v4l2 2M10 2h4" /></Svg>;
    case 'heart':
      return <Svg {...common}><Path {...p} fill={filled ? color : 'none'} d="M20.4 5.6a5.5 5.5 0 00-7.8 0L12 6.2l-.6-.6a5.5 5.5 0 00-7.8 7.8l.6.6L12 22l7.8-8 .6-.6a5.5 5.5 0 000-7.8z" /></Svg>;
    case 'apple':
      return <Svg {...common}><Path d="M16.5 12.3c0-2.4 2-3.6 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.8-3.5.8-.7 0-1.9-.8-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.1 1.2 9.4.8 1.1 1.8 2.4 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.1.8 1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1-.1-2.7-1-2.7-3.8zM14.4 5.4c.7-.8 1.1-1.9 1-3-1 0-2.2.6-2.9 1.5-.6.7-1.2 1.9-1 2.9 1.1.1 2.2-.5 2.9-1.4z" fill={color} /></Svg>;
    case 'utensils':
      return <Svg {...common}><Path {...p} d="M3 2v7a2 2 0 002 2h4a2 2 0 002-2V2M7 2v20M21 15V2a5 5 0 00-5 5v6a2 2 0 002 2h3zM21 15v7" /></Svg>;
    case 'google':
      return (
        <Svg {...common}>
          <Path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4c-.2 1.3-.9 2.4-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.5z" fill="#4285F4" />
          <Path d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.6c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.6C4.7 19.7 8.1 22 12 22z" fill="#34A853" />
          <Path d="M6.4 13.9c-.2-.6-.3-1.3-.3-1.9s.1-1.3.3-1.9V7.5H3C2.4 8.9 2 10.4 2 12s.4 3.1 1 4.5l3.4-2.6z" fill="#FBBC04" />
          <Path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C16.9 2.9 14.7 2 12 2 8.1 2 4.7 4.3 3 7.5l3.4 2.6C7.2 7.7 9.4 5.9 12 5.9z" fill="#EA4335" />
        </Svg>
      );
    case 'instagram':
      return (
        <Svg {...common}>
          <Defs>
            <LinearGradient id="igGradient" x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor="#FEE411" />
              <Stop offset="0.25" stopColor="#FE4B70" />
              <Stop offset="0.55" stopColor="#FF0F7B" />
              <Stop offset="0.78" stopColor="#F80261" />
              <Stop offset="1" stopColor="#8134AF" />
            </LinearGradient>
          </Defs>
          <Rect x="2" y="2" width="20" height="20" rx="6" fill="url(#igGradient)" />
          {/* Full camera mark (body outline + lens ring + flash dot) as one
              path — the exact official Bootstrap Icons "instagram" glyph
              (MIT), not a hand-approximation. Scaled from its native 16x16
              viewBox into an 18x18 area inset 3px on every side inside the
              20x20 gradient square above, matching the real app icon's
              margin between the colored background and the white camera
              mark. Previously this case only drew the lens ring + flash dot
              with no body outline, which read as just the center of the
              logo once cropped into a circular badge. */}
          <Path
            transform="translate(3 3) scale(1.125)"
            fill="#FFFFFF"
            d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.9 3.9 0 0 0-1.417.923A3.9 3.9 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.9 3.9 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.9 3.9 0 0 0-.923-1.417A3.9 3.9 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 7.998 0zm-.717 1.442h.718c2.136 0 2.389.007 3.232.046.78.035 1.204.166 1.486.275.373.145.64.319.92.599s.453.546.598.92c.11.281.24.705.275 1.485.039.843.047 1.096.047 3.231s-.008 2.389-.047 3.232c-.035.78-.166 1.203-.275 1.485a2.5 2.5 0 0 1-.599.919c-.28.28-.546.453-.92.598-.28.11-.704.24-1.485.276-.843.038-1.096.047-3.232.047s-2.39-.009-3.233-.047c-.78-.036-1.203-.166-1.485-.276a2.5 2.5 0 0 1-.92-.598 2.5 2.5 0 0 1-.6-.92c-.109-.281-.24-.705-.275-1.485-.038-.843-.046-1.096-.046-3.233s.008-2.388.046-3.231c.036-.78.166-1.204.276-1.486.145-.373.319-.64.599-.92s.546-.453.92-.598c.282-.11.705-.24 1.485-.276.738-.034 1.024-.044 2.515-.045zm4.988 1.328a.96.96 0 1 0 0 1.92.96.96 0 0 0 0-1.92m-4.27 1.122a4.109 4.109 0 1 0 0 8.217 4.109 4.109 0 0 0 0-8.217m0 1.441a2.667 2.667 0 1 1 0 5.334 2.667 2.667 0 0 1 0-5.334"
          />
        </Svg>
      );
    case 'share':
      return <Svg {...common}><Path {...p} d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></Svg>;
    case 'lock':
      return <Svg {...common}><Rect {...p} x="4" y="11" width="16" height="10" rx="2" /><Path {...p} d="M8 11V7a4 4 0 018 0v4" /></Svg>;
    case 'lock-open':
      return <Svg {...common}><Rect {...p} x="4" y="11" width="16" height="10" rx="2" /><Path {...p} d="M8 11V7a4 4 0 017.9-1" /></Svg>;
    case 'mail':
      return <Svg {...common}><Rect {...p} x="3" y="5" width="18" height="14" rx="2" /><Path {...p} d="M3 7l9 7 9-7" /></Svg>;
    case 'eye':
      return <Svg {...common}><Path {...p} d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><Circle {...p} cx="12" cy="12" r="3" /></Svg>;
    case 'settings':
      return <Svg {...common}><Circle {...p} cx="12" cy="12" r="3" /><Path {...p} d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></Svg>;
    case 'crown':
      return <Svg {...common}><Path {...p} d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" /></Svg>;
    case 'chevron-right':
      return <Svg {...common}><Path {...p} d="M9 6l6 6-6 6" /></Svg>;
    case 'chevron-down':
      return <Svg {...common}><Path {...p} d="M6 9l6 6 6-6" /></Svg>;
    case 'x':
      return <Svg {...common}><Path {...p} d="M6 6l12 12M18 6L6 18" /></Svg>;
    case 'swap':
      return <Svg {...common}><Path {...p} d="M21 7l-3-3-3 3M18 4v8a4 4 0 01-4 4H3M3 17l3 3 3-3M6 20v-8a4 4 0 014-4h11" /></Svg>;
    case 'list':
      return <Svg {...common}><Path {...p} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></Svg>;
    case 'shield':
      return <Svg {...common}><Path {...p} d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" /></Svg>;
    case 'trophy':
      return <Svg {...common}><Path {...p} d="M7 4h10v4a5 5 0 01-10 0V4zM5 4H3v2a3 3 0 003 3M19 4h2v2a3 3 0 01-3 3M9 20h6M12 14v6" /></Svg>;
    case 'camera':
      return <Svg {...common}><Path {...p} d="M3 8a2 2 0 012-2h2l2-3h6l2 3h2a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" /><Circle {...p} cx="12" cy="13" r="4" /></Svg>;
    case 'bell':
      return <Svg {...common}><Path {...p} d="M6 10a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" /><Path {...p} d="M10 20a2 2 0 004 0" /></Svg>;
    case 'moon':
      return <Svg {...common}><Path {...p} d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z" /></Svg>;
    case 'globe':
      return <Svg {...common}><Circle {...p} cx="12" cy="12" r="9" /><Path {...p} d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9s1.3-6.5 3.8-9z" /></Svg>;
    case 'ruler':
      return <Svg {...common}><Rect {...p} x="3" y="7" width="18" height="10" rx="1.5" /><Path {...p} d="M7 7v3M11 7v3M15 7v3M19 7v3" /></Svg>;
    case 'download':
      return <Svg {...common}><Path {...p} d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" /></Svg>;
    case 'trash':
      return <Svg {...common}><Path {...p} d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13M10 11v6M14 11v6" /></Svg>;
    case 'help-circle':
      return <Svg {...common}><Circle {...p} cx="12" cy="12" r="9" /><Path {...p} d="M9.5 9a2.5 2.5 0 013.7-2.2c.9.5 1.3 1.7.7 2.6-.6.9-1.9 1.1-1.9 2.6" /><Circle cx="12" cy="17" r="1" fill={color} /></Svg>;
    case 'message':
      return <Svg {...common}><Path {...p} d="M4 5h16v11H9l-5 4V5z" /></Svg>;
    case 'alert-triangle':
      return <Svg {...common}><Path {...p} d="M12 3l10 18H2L12 3z" /><Path {...p} d="M12 10v4" /><Circle cx="12" cy="17.5" r="1" fill={color} /></Svg>;
    case 'info':
      return <Svg {...common}><Circle {...p} cx="12" cy="12" r="9" /><Path {...p} d="M12 11v6" /><Circle cx="12" cy="7.5" r="1" fill={color} /></Svg>;
    case 'file-text':
      return <Svg {...common}><Path {...p} d="M6 2h9l5 5v15H6V2z" /><Path {...p} d="M15 2v5h5M9 12h6M9 16h6" /></Svg>;
    case 'key':
      return <Svg {...common}><Circle {...p} cx="8" cy="14" r="4" /><Path {...p} d="M11 11l9-9M17 5l3 3M14 8l2 2" /></Svg>;
    case 'star':
      return <Svg {...common}><Path d="M12 2.5l2.9 6.2 6.6.7-4.9 4.6 1.3 6.6L12 17.9l-5.9 3.3L7.4 14 2.5 9.4l6.6-.7L12 2.5z" fill={color} stroke={color} strokeWidth={stroke} strokeLinejoin="round" /></Svg>;
    case 'search':
      return <Svg {...common}><Circle {...p} cx="10.5" cy="10.5" r="6.5" /><Path {...p} d="M15.5 15.5L21 21" /></Svg>;
    case 'copy':
      return <Svg {...common}><Rect {...p} x="9" y="9" width="12" height="12" rx="2" /><Path {...p} d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" /></Svg>;
    case 'refresh':
      return <Svg {...common}><Path {...p} d="M3 11a9 9 0 0115.3-5.7M21 13a9 9 0 01-15.3 5.7" /><Path {...p} d="M18 3v5h-5M6 21v-5h5" /></Svg>;
    case 'run':
      return (
        <Svg {...common}>
          <Circle cx="14.5" cy="4.5" r="1.8" fill={color} />
          <Path {...p} d="M8 21l2.8-5.2-1.6-3.4L6 15.5 4 19M9.4 12.2l1.4-3.6 3-1.4 3.6 3 2.6 1" />
          <Path {...p} d="M10.8 8.6L9 7l-3 1" />
          <Path {...p} d="M13.8 7.2l1.6 3.6 3.6 1.2" />
        </Svg>
      );
    default:
      return null;
  }
}
