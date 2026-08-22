import { useEffect, useRef } from 'react';
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { MonoLabel } from './Display';
import { useTheme } from '../../theme';
import {
  cmToSelectableFeetInches,
  feetInchesToCm,
  selectableFeet,
  selectableInchesForFeet,
} from '../../units/heightConversions';

const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 5;
const CENTER_OFFSET = Math.floor(VISIBLE_ITEMS / 2);

type Props = {
  valueCm: number;
  minCm: number;
  maxCm: number;
  onChangeCm: (cm: number) => void;
  feetLabel: string;
  inchesLabel: string;
  error?: boolean;
};

export function ImperialHeightInput({
  valueCm,
  minCm,
  maxCm,
  onChangeCm,
  feetLabel,
  inchesLabel,
  error = false,
}: Props) {
  const { theme } = useTheme();
  const current = cmToSelectableFeetInches(valueCm, minCm, maxCm);
  const feetOptions = selectableFeet(minCm, maxCm);
  const inchOptions = selectableInchesForFeet(current.feet, minCm, maxCm);

  const selectFeet = (feet: number) => {
    const allowedInches = selectableInchesForFeet(feet, minCm, maxCm);
    const inches = allowedInches.reduce((closest, candidate) =>
      Math.abs(candidate - current.inches) < Math.abs(closest - current.inches)
        ? candidate
        : closest,
    );
    onChangeCm(feetInchesToCm(feet, inches));
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 16 }}>
        <MonoLabel
          color={error ? theme.colors.inputBorderError : theme.colors.textFaint}
          style={{ width: '50%', textAlign: 'center', marginBottom: 6 }}
        >
          {feetLabel.toUpperCase()}
        </MonoLabel>
        <MonoLabel
          color={error ? theme.colors.inputBorderError : theme.colors.textFaint}
          style={{ width: '50%', textAlign: 'center', marginBottom: 6 }}
        >
          {inchesLabel.toUpperCase()}
        </MonoLabel>
      </View>
      <View
        style={{
          flexDirection: 'row',
          height: ITEM_HEIGHT * VISIBLE_ITEMS,
          paddingHorizontal: 16,
          paddingVertical: 8,
          position: 'relative',
          borderRadius: 12,
          borderWidth: error ? 1 : 0,
          borderColor: error ? theme.colors.inputBorderError : 'transparent',
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
            backgroundColor: theme.colors.inputSelection,
          }}
        />
        <HeightWheelColumn
          items={feetOptions}
          selectedValue={current.feet}
          onSelect={selectFeet}
          accessibilityLabel={feetLabel}
          formatValue={(value) => String(value)}
        />
        <HeightWheelColumn
          items={inchOptions}
          selectedValue={current.inches}
          onSelect={(inches) => onChangeCm(feetInchesToCm(current.feet, inches))}
          accessibilityLabel={inchesLabel}
          formatValue={(value) => String(value).padStart(2, '0')}
        />
      </View>
    </View>
  );
}

function HeightWheelColumn({
  items,
  selectedValue,
  onSelect,
  accessibilityLabel,
  formatValue,
}: {
  items: number[];
  selectedValue: number;
  onSelect: (value: number) => void;
  accessibilityLabel: string;
  formatValue: (value: number) => string;
}) {
  const { theme } = useTheme();
  const selectedIndex = Math.max(0, items.indexOf(selectedValue));
  const scrollY = useRef(new Animated.Value(selectedIndex * ITEM_HEIGHT)).current;
  const scrollRef = useRef<ScrollView>(null);
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const hasMounted = useRef(false);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: true });
  }, [selectedIndex]);

  const settleSelection = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.max(
      0,
      Math.min(items.length - 1, Math.round(event.nativeEvent.contentOffset.y / ITEM_HEIGHT)),
    );
    if (index !== selectedIndexRef.current) onSelect(items[index]);
  };

  return (
    <View
      style={{ width: '50%', height: ITEM_HEIGHT * VISIBLE_ITEMS }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: String(selectedValue) }}
    >
      <Animated.ScrollView
        ref={scrollRef}
        contentOffset={{ x: 0, y: selectedIndex * ITEM_HEIGHT }}
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * CENTER_OFFSET }}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        nestedScrollEnabled
        scrollEventThrottle={16}
        onMomentumScrollEnd={settleSelection}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
      >
        {items.map((item, index) => {
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
              key={item}
              style={{
                height: ITEM_HEIGHT,
                justifyContent: 'center',
                alignItems: 'center',
                opacity,
              }}
            >
              <Text
                style={{
                  fontFamily: theme.fonts.uiSemi,
                  fontSize: 19,
                  color: theme.colors.inputText,
                  letterSpacing: 0.5,
                }}
              >
                {formatValue(item)}
              </Text>
            </Animated.View>
          );
        })}
      </Animated.ScrollView>
    </View>
  );
}
