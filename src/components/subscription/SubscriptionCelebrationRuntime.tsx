import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { useReducedMotionPreference } from '../../lib/reducedMotion';
import {
  subscribeToSubscriptionPurchaseCelebrations,
  type SubscriptionCelebrationKind,
} from '../../lib/subscriptionCelebration';
import { useAuth } from '../../state/AuthContext';
import { useTheme } from '../../theme';
import { Display, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';

type Celebration = {
  id: number;
  kind: SubscriptionCelebrationKind;
};

type CelebratedTransaction = {
  uid: string;
  latestPurchaseDate: string;
};

/**
 * Presents one identity-scoped celebration exclusively for a purchase the
 * user just completed in-app (`performPurchase` → `emitSubscriptionPurchaseCelebration`).
 * This is the ONLY trigger: auto-renewals delivered by the RevenueCat listener,
 * restore, app startup/foreground syncs and any other passive `CustomerInfo`
 * update never reach this component, so they can never show the animation.
 */
export function SubscriptionCelebrationRuntime() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const celebratedTransaction = useRef<CelebratedTransaction | null>(null);
  const nextId = useRef(0);
  const [celebration, setCelebration] = useState<Celebration | null>(null);

  useEffect(() => {
    celebratedTransaction.current = null;
    setCelebration(null);
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const unsubscribePurchase = subscribeToSubscriptionPurchaseCelebrations((event) => {
      if (event.uid !== uid) return;
      if (
        event.latestPurchaseDate &&
        celebratedTransaction.current?.uid === uid &&
        celebratedTransaction.current.latestPurchaseDate === event.latestPurchaseDate
      ) {
        return;
      }
      if (event.latestPurchaseDate) {
        celebratedTransaction.current = {
          uid,
          latestPurchaseDate: event.latestPurchaseDate,
        };
      }
      setCelebration({ id: ++nextId.current, kind: event.kind });
    });
    return unsubscribePurchase;
  }, [uid]);

  if (!celebration) return null;

  return (
    <SubscriptionCelebrationOverlay
      key={celebration.id}
      kind={celebration.kind}
      onFinished={() => {
        setCelebration((current) =>
          current?.id === celebration.id ? null : current,
        );
      }}
    />
  );
}

function SubscriptionCelebrationOverlay({
  kind,
  onFinished,
}: {
  kind: SubscriptionCelebrationKind;
  onFinished: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('profile');
  const reduceMotion = useReducedMotionPreference();
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const badgeScale = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    if (reduceMotion) {
      const timer = setTimeout(() => onFinishedRef.current(), 1600);
      return () => clearTimeout(timer);
    }

    const intro = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(badgeScale, {
          toValue: 1.12,
          duration: 330,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(badgeScale, {
          toValue: 1,
          duration: 220,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ]);
    intro.start();

    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onFinishedRef.current();
      });
    }, 1900);

    return () => {
      clearTimeout(timer);
      intro.stop();
      opacity.stopAnimation();
      badgeScale.stopAnimation();
    };
  }, [badgeScale, opacity, reduceMotion]);

  const renewed = kind === 'renewed';
  const label = renewed
    ? t('subscriptionCelebration.renewedLabel')
    : t('subscriptionCelebration.activatedLabel');
  const message = renewed
    ? t('subscriptionCelebration.renewedMessage')
    : t('subscriptionCelebration.activatedMessage');
  const accessibilityLabel = renewed
    ? t('subscriptionCelebration.accessibilityRenewed')
    : t('subscriptionCelebration.accessibilityActivated');

  return (
    <Modal
      visible
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={() => onFinishedRef.current()}
    >
      <Animated.View
        accessibilityViewIsModal
        accessible
        accessibilityRole="alert"
        accessibilityLabel={accessibilityLabel}
        style={{
          flex: 1,
          opacity,
          backgroundColor: theme.colors.workoutOverlayStrong,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 28,
        }}
      >
        <View
          style={{
            width: 120,
            height: 120,
            marginBottom: 32,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CelebrationPulseRings reduceMotion={reduceMotion} />
          <Animated.View style={{ transform: [{ scale: badgeScale }] }}>
            <LinearGradient
              colors={theme.gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: theme.colors.primary,
                shadowOpacity: 0.7,
                shadowRadius: 30,
                shadowOffset: { width: 0, height: 0 },
                elevation: 10,
              }}
            >
              <Icon
                name={renewed ? 'crown' : 'check'}
                size={46}
                color={theme.colors.primaryForeground}
                stroke={3}
              />
            </LinearGradient>
          </Animated.View>
        </View>

        <Slash style={{ marginBottom: 12 }}>{label.toUpperCase()}</Slash>
        <Display size={30} style={{ textAlign: 'center' }}>
          {t('subscriptionCelebration.title')}
        </Display>

        <Text
          style={{
            marginTop: 22,
            maxWidth: 320,
            fontSize: 16,
            lineHeight: 24,
            fontFamily: theme.fonts.uiMed,
            color: theme.colors.textSecondary,
            textAlign: 'center',
          }}
        >
          {message}
        </Text>
      </Animated.View>
    </Modal>
  );
}

function CelebrationPulseRings({ reduceMotion }: { reduceMotion: boolean }) {
  const { theme } = useTheme();
  const rings = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  useEffect(() => {
    if (reduceMotion) return;
    const loops = rings.map((ring, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 400),
          Animated.timing(ring, {
            toValue: 1,
            duration: 1800,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(ring, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [reduceMotion, rings]);

  if (reduceMotion) return null;

  return (
    <>
      {rings.map((ring, index) => (
        <Animated.View
          key={index}
          style={{
            position: 'absolute',
            width: 96,
            height: 96,
            borderRadius: 48,
            borderWidth: 2,
            borderColor: theme.colors.primaryGlow,
            opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
            transform: [{
              scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.5] }),
            }],
          }}
        />
      ))}
    </>
  );
}
