import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NuPanel } from '../NuKit';

const animation = vi.hoisted(() => {
  class Value {
    driver: 'js' | 'native' = 'js';
    constructor(public value: number) {}
    setValue(value: number) { this.value = value; }
  }
  const animate = (value: Value, options: { useNativeDriver: boolean }) => ({
    start: () => { value.driver = options.useNativeDriver ? 'native' : 'js'; }, stop: () => {},
  });
  return { Value, animate };
});
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: <T,>(value: T) => ({ current: value }),
  useEffect: (effect: () => unknown) => { effect(); },
}));
vi.mock('react-native', () => ({
  Animated: {
    Value: animation.Value, View: 'AnimatedView', spring: animation.animate, timing: animation.animate,
    parallel: (animations: { start: () => void }[]) => ({ start: () => animations.forEach((a) => a.start()) }),
  },
  Easing: { out: (v: unknown) => v, cubic: 'cubic' },
  Platform: { OS: 'ios' }, StyleSheet: { absoluteFill: { position: 'absolute' } },
  KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle' }));
vi.mock('../../ui/Icon', () => ({ Icon: 'Icon' }));

type Node = React.ReactElement<Record<string, unknown>>;
function nodes(tree: unknown): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function animatedValues(style: unknown): InstanceType<typeof animation.Value>[] {
  if (style instanceof animation.Value) return [style];
  if (Array.isArray(style)) return style.flatMap(animatedValues);
  if (style && typeof style === 'object') return Object.values(style).flatMap(animatedValues);
  return [];
}
function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return style && typeof style === 'object' ? style as Record<string, unknown> : {};
}

describe('NuPanel animation drivers', () => {
  it('isolates JS-driven height from native entrance and backdrop animations', () => {
    const height = new animation.Value(45);
    const tree = NuPanel({
      visible: true, onClose: vi.fn(), children: React.createElement('Results'), avoidKeyboard: true,
      animatedHeight: height as unknown as React.ComponentProps<typeof NuPanel>['animatedHeight'],
      contentStyle: { paddingHorizontal: 0 },
    });
    const layers = nodes(tree).filter((n) => n.type === 'AnimatedView');
    const sizing = layers.find((n) => flatten(n.props.style).height === height)!;
    expect(sizing).toBeDefined();
    expect(animatedValues(sizing.props.style).map((v) => v.driver)).toEqual(['js']);
    // A native animated host cannot accept layout properties such as height,
    // or share its animated props node with a JS-driven animation.
    for (const layer of layers) {
      const drivers = new Set(animatedValues(layer.props.style).map((v) => v.driver));
      expect(drivers.size).toBeLessThanOrEqual(1);
      if (drivers.has('native')) expect(flatten(layer.props.style).height).toBeUndefined();
    }
    const entrance = layers.find((n) => flatten(n.props.style).transform)!;
    expect(animatedValues(entrance.props.style).map((v) => v.driver)).toEqual(['native']);
    expect(nodes(sizing).includes(entrance)).toBe(true);
    expect(flatten(entrance.props.style).flex).toBe(1);
  });

  it('keeps ordinary quantity panels sized by their content and leaves hidden panels unmounted', () => {
    const props = { visible: true, onClose: vi.fn(), children: 'Quantity' };
    const tree = NuPanel(props);
    const entrance = nodes(tree).find((n) => flatten(n.props.style).transform)!;
    expect(flatten(entrance.props.style).flex).toBeUndefined();
    expect(NuPanel({ ...props, visible: false })).toBeNull();
  });
});
