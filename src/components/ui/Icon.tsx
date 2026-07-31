import React from 'react';
import Svg, { Path, Circle, Rect, Defs } from 'react-native-svg';

export type IconName =
  | 'bolt' | 'dumbbell' | 'home' | 'chart' | 'user' | 'play'
  | 'arrow-right' | 'arrow-left' | 'check' | 'plus' | 'minus'
  | 'calendar' | 'sparkles' | 'target' | 'flame' | 'timer'
  | 'heart' | 'apple' | 'lock' | 'mail' | 'eye' | 'settings'
  | 'crown' | 'chevron-right' | 'chevron-down' | 'x' | 'swap' | 'list' | 'shield'
  | 'trophy' | 'camera' | 'google'
  | 'bell' | 'moon' | 'globe' | 'ruler' | 'download' | 'trash' | 'help-circle'
  | 'message' | 'alert-triangle' | 'info' | 'file-text' | 'key';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  stroke?: number;
};

export function Icon({ name, size = 22, color = '#ffffff', stroke = 1.7 }: Props) {
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
      return <Svg {...common}><Path {...p} d="M20.4 5.6a5.5 5.5 0 00-7.8 0L12 6.2l-.6-.6a5.5 5.5 0 00-7.8 7.8l.6.6L12 22l7.8-8 .6-.6a5.5 5.5 0 000-7.8z" /></Svg>;
    case 'apple':
      return <Svg {...common}><Path d="M16.5 12.3c0-2.4 2-3.6 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.8-3.5.8-.7 0-1.9-.8-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.1 1.2 9.4.8 1.1 1.8 2.4 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.1.8 1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1-.1-2.7-1-2.7-3.8zM14.4 5.4c.7-.8 1.1-1.9 1-3-1 0-2.2.6-2.9 1.5-.6.7-1.2 1.9-1 2.9 1.1.1 2.2-.5 2.9-1.4z" fill={color} /></Svg>;
    case 'google':
      return (
        <Svg {...common}>
          <Path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4c-.2 1.3-.9 2.4-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.5z" fill="#4285F4" />
          <Path d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.6c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.6C4.7 19.7 8.1 22 12 22z" fill="#34A853" />
          <Path d="M6.4 13.9c-.2-.6-.3-1.3-.3-1.9s.1-1.3.3-1.9V7.5H3C2.4 8.9 2 10.4 2 12s.4 3.1 1 4.5l3.4-2.6z" fill="#FBBC04" />
          <Path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C16.9 2.9 14.7 2 12 2 8.1 2 4.7 4.3 3 7.5l3.4 2.6C7.2 7.7 9.4 5.9 12 5.9z" fill="#EA4335" />
        </Svg>
      );
    case 'lock':
      return <Svg {...common}><Rect {...p} x="4" y="11" width="16" height="10" rx="2" /><Path {...p} d="M8 11V7a4 4 0 018 0v4" /></Svg>;
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
    default:
      return null;
  }
}
