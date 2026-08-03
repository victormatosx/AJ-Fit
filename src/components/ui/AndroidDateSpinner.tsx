import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  ListRenderItemInfo,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Text,
  View,
} from 'react-native';
import { fonts } from '../../theme/tokens';

/**
 * iOS-style three-column date wheel for Android — day / month / year,
 * with a rounded pill selection band spanning the three columns and a
 * native-driver opacity fade for items above/below the center.
 *
 * Isolated from Firestore / questionnaire / auth: takes a `Date` and returns
 * a `Date`. All age/limit validation is the caller's responsibility.
 *
 * Layout invariant:
 *   ITEM_HEIGHT × VISIBLE_ITEMS      = column height
 *   contentContainerStyle.paddingVertical = ITEM_HEIGHT × CENTER_OFFSET
 * so that scrollY of `index × ITEM_HEIGHT` lands `index` in the center row.
 */

const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 5;
const CENTER_OFFSET = Math.floor(VISIBLE_ITEMS / 2);

// Wide, sensible range for the year wheel — birthdates realistically fit
// inside this without capping the top visibly at "today − minAge years".
const DEFAULT_MIN_YEAR = 1900;
const DEFAULT_MAX_YEAR = new Date().getFullYear();

export type AndroidDateSpinnerProps = {
  value: Date;
  minYear?: number;
  maxYear?: number;
  locale?: string;
  onChange: (date: Date) => void;
};

export function AndroidDateSpinner({
  value,
  minYear = DEFAULT_MIN_YEAR,
  maxYear = DEFAULT_MAX_YEAR,
  locale,
  onChange,
}: AndroidDateSpinnerProps) {
  const [day, setDay] = useState(value.getDate());
  const [month, setMonth] = useState(value.getMonth());
  const [year, setYear] = useState(() =>
    Math.max(minYear, Math.min(maxYear, value.getFullYear())),
  );

  // Latest onChange without a dep on identity — parent isn't required to
  // memoize the callback for our composite effect below to stay stable.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Last emitted timestamp — turns any accidental effect re-run into a no-op
  // instead of an infinite parent-child render loop.
  const lastEmittedRef = useRef<number | null>(null);

  const years = useMemo(
    () => Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i),
    [minYear, maxYear],
  );

  // Day list follows the actual length of the selected month — Feb never
  // offers 30/31, Apr never offers 31, so the wheel can't produce an
  // invalid calendar day.
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => i + 1),
    [daysInMonth],
  );

  // Month labels via Intl — device/app language decides the wording,
  // no hard-coded PT-BR strings.
  const monthNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: 'short' });
    return Array.from({ length: 12 }, (_, i) =>
      fmt.format(new Date(2000, i, 1)).replace(/\./g, '').toUpperCase(),
    );
  }, [locale]);

  // Recompose Date on every column change, snap day back into the month's
  // range (Jan 31 → Feb → 28/29), and emit. Both setState branches are
  // idempotent, so no loop even if the effect re-fires.
  useEffect(() => {
    const dim = new Date(year, month + 1, 0).getDate();
    const safeDay = Math.min(day, dim);
    if (safeDay !== day) setDay(safeDay);
    const d = new Date(year, month, safeDay);
    const t = d.getTime();
    if (t !== lastEmittedRef.current) {
      lastEmittedRef.current = t;
      onChangeRef.current(d);
    }
  }, [day, month, year]);

  return (
    <View
      style={{
        flexDirection: 'row',
        height: ITEM_HEIGHT * VISIBLE_ITEMS,
        paddingHorizontal: 16,
        paddingVertical: 8,
        position: 'relative',
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          top: 8 + ITEM_HEIGHT * CENTER_OFFSET,
          height: ITEM_HEIGHT,
          borderRadius: ITEM_HEIGHT / 2,
          backgroundColor: 'rgba(255,255,255,0.08)',
        }}
      />
      <WheelColumn
        items={days}
        selectedIndex={day - 1}
        onSelect={(i) => setDay(days[i])}
        widthPct={0.26}
        format={(d) => String(d).padStart(2, '0')}
        accessibilityLabel="Dia"
      />
      <WheelColumn
        items={monthNames}
        selectedIndex={month}
        onSelect={(i) => setMonth(i)}
        widthPct={0.38}
        format={(m) => String(m)}
        accessibilityLabel="Mês"
      />
      <WheelColumn
        items={years}
        selectedIndex={Math.max(0, year - minYear)}
        onSelect={(i) => setYear(years[i])}
        widthPct={0.36}
        format={(y) => String(y)}
        accessibilityLabel="Ano"
      />
    </View>
  );
}

type ColumnItem = string | number;

type WheelColumnProps = {
  items: ColumnItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  widthPct: number;
  format: (item: ColumnItem) => string;
  accessibilityLabel: string;
};

const AnimatedFlatList = Animated.createAnimatedComponent(
  FlatList as React.ComponentType<React.ComponentProps<typeof FlatList<ColumnItem>>>,
);

function WheelColumn({
  items,
  selectedIndex,
  onSelect,
  widthPct,
  format,
  accessibilityLabel,
}: WheelColumnProps) {
  const scrollY = useRef(new Animated.Value(selectedIndex * ITEM_HEIGHT)).current;
  const listRef = useRef<FlatList<ColumnItem>>(null);
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  // initialScrollIndex already positions us on first render — skip the
  // first "sync" pass so we don't animate an in-place scroll on mount.
  const hasMounted = useRef(false);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    listRef.current?.scrollToOffset({
      offset: selectedIndex * ITEM_HEIGHT,
      animated: true,
    });
  }, [selectedIndex]);

  const handleMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.max(
      0,
      Math.min(items.length - 1, Math.round(y / ITEM_HEIGHT)),
    );
    if (idx !== selectedIndexRef.current) onSelect(idx);
  };

  const renderItem = ({ item, index }: ListRenderItemInfo<ColumnItem>) => {
    const inputRange = [
      (index - 2) * ITEM_HEIGHT,
      (index - 1) * ITEM_HEIGHT,
      index * ITEM_HEIGHT,
      (index + 1) * ITEM_HEIGHT,
      (index + 2) * ITEM_HEIGHT,
    ];
    const opacity = scrollY.interpolate({
      inputRange,
      outputRange: [0.18, 0.45, 1, 0.45, 0.18],
      extrapolate: 'clamp',
    });
    return (
      <Animated.View
        style={{
          height: ITEM_HEIGHT,
          justifyContent: 'center',
          alignItems: 'center',
          opacity,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.uiSemi,
            fontSize: 19,
            color: '#fff',
            letterSpacing: 0.5,
          }}
        >
          {format(item)}
        </Text>
      </Animated.View>
    );
  };

  return (
    <View
      style={{
        width: `${widthPct * 100}%`,
        height: ITEM_HEIGHT * VISIBLE_ITEMS,
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{
        text: items[selectedIndex] != null ? format(items[selectedIndex]) : '',
      }}
    >
      <AnimatedFlatList
        ref={listRef as unknown as React.Ref<FlatList<ColumnItem>>}
        data={items}
        keyExtractor={(_, i) => String(i)}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        getItemLayout={(_, i) => ({
          length: ITEM_HEIGHT,
          offset: ITEM_HEIGHT * i,
          index: i,
        })}
        initialScrollIndex={Math.max(0, Math.min(selectedIndex, items.length - 1))}
        onScrollToIndexFailed={(info) => {
          // FlatList sometimes reports the target row not measured yet on
          // Android. Retry with the exact pixel offset once the frame has
          // laid out — no animation, so it looks like initialScrollIndex.
          setTimeout(() => {
            listRef.current?.scrollToOffset({
              offset: info.index * ITEM_HEIGHT,
              animated: false,
            });
          }, 60);
        }}
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * CENTER_OFFSET }}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleMomentumEnd}
        renderItem={renderItem}
      />
    </View>
  );
}
