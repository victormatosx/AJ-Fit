import React, { useCallback, useRef, useState } from 'react';
import { View, FlatList, useWindowDimensions, type ViewToken } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BeforeAfterCard } from './BeforeAfterCard';
import { TestimonialCard } from './TestimonialCard';
import { CarouselIndicators } from './CarouselIndicators';
import { sizes } from '../../theme/tokens';
import { socialProofTestimonials } from '../../data/socialProofTestimonials';
import type { SocialProofTestimonial } from '../../types/socialProof';

const GAP = 14;

export function SocialProofCarousel() {
  const { t } = useTranslation('onboarding');
  const { width } = useWindowDimensions();
  const itemWidth = Math.min(width - sizes.screenGutter * 2, sizes.contentMaxWidth);
  const [activeIndex, setActiveIndex] = useState(0);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) setActiveIndex(first.index);
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const renderItem = useCallback(
    ({ item }: { item: SocialProofTestimonial }) => (
      <CarouselItem item={item} width={itemWidth} />
    ),
    [itemWidth],
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        style={{ flex: 1 }}
        data={socialProofTestimonials}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={itemWidth + GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        removeClippedSubviews
        accessibilityLabel={t('socialProof.carouselLabel')}
      />
      <CarouselIndicators count={socialProofTestimonials.length} activeIndex={activeIndex} />
    </View>
  );
}

// Memoized so scrolling (which only moves `activeIndex` in the parent)
// never re-renders the off-screen cards.
const CarouselItem = React.memo(function CarouselItem({
  item,
  width,
}: {
  item: SocialProofTestimonial;
  width: number;
}) {
  const { t } = useTranslation('onboarding');
  const name = t(`socialProof.testimonials.${item.id}.name`);
  return (
    <View style={{ width, flex: 1 }}>
      <BeforeAfterCard name={name} beforeImage={item.beforeImage} afterImage={item.afterImage} />
      <TestimonialCard testimonial={item} />
    </View>
  );
});
