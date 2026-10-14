import { useEffect, useRef, useState } from 'react';
import { Text, type TextProps } from 'react-native';

export function CountUp({
  to,
  from = 0,
  durationMs = 1200,
  ...textProps
}: { to: number; /** Starting value — read once, at mount, only. */ from?: number; durationMs?: number } & TextProps) {
  const [value, setValue] = useState(from);
  const fromRef = useRef(from);

  useEffect(() => {
    const from = fromRef.current;
    let raf: number;
    let start: number | undefined;
    const step = (now: number) => {
      if (start === undefined) start = now;
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + (to - from) * eased);
      fromRef.current = current;
      setValue(current);
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, durationMs]);

  return <Text {...textProps}>{value}</Text>;
}
