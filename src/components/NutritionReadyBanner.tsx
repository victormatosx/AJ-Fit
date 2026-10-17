import { createNutritionNoticePresentation } from '../services/nutritionNoticePresentation';
import { isValidNutritionRolloutConfig, nutritionFlagEnabled } from '../nutrition/rollout';
import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, onSnapshot } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { auth, db } from '../lib/firebase';
import { useAuth } from '../state/AuthContext';
import { useTheme } from '../theme';
import { resolveNotificationPreference } from '../types/notificationPreferences';
import { getLastNotificationOpenEvent } from '../services/pushNotifications';
import { Icon } from './ui/Icon';

/** Job-driven fallback works even without notification permission or a device token. */
export function NutritionReadyBanner({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState<{ uid: string; generationId: string } | null>(null);

  const [rolloutAllowed, setRolloutAllowed] = useState(false);
  const allowed = resolveNotificationPreference(profile?.preferences.notificationPreferences, 'nutrition');
  useEffect(() => {
    setRolloutAllowed(false);
    if (!user) return;
    return onSnapshot(doc(db, 'nutritionRolloutConfig', 'active'), (snapshot) => {
      const config = snapshot.data();
      setRolloutAllowed(isValidNutritionRolloutConfig(config) && nutritionFlagEnabled(user.uid, 'nutritionEnabled', config));
    }, () => setRolloutAllowed(false));
  }, [user]);
  useEffect(() => {
    setReady(null);
    if (!user || !enabled || !allowed || !rolloutAllowed) return;
    const uid = user.uid;
    let cancelled = false;
    let generationId: string | null = null;
    let completed = false;
    let showing = false;
    let unsubscribeJob: (() => void) | undefined;
    const show = async () => {
      if (!completed || !generationId || showing || cancelled || AppState.currentState !== 'active') return;
      showing = true;
      const id = generationId;
      const key = `ajfit.nutrition-ready-seen.v1:${uid}:${id}`;
      try {
        const seen = await AsyncStorage.getItem(key);
        if (cancelled || auth.currentUser?.uid !== uid || generationId !== id) return;
        if (seen) return;
        if (AppState.currentState !== 'active') return;
        const opened = getLastNotificationOpenEvent()?.payload;

        // A push tap already navigates through DeepLinkContext; no redundant banner.
        if (opened?.generationId !== id || (opened.recipientUid && opened.recipientUid !== uid)) setReady({ uid, generationId: id });
      } finally { showing = false; }
    };
    const unsubscribe = onSnapshot(doc(db, 'users', uid, 'onboardingNutritionState', 'current'), (snapshot) => {
      const id = snapshot.data()?.latestGenerationId ?? snapshot.data()?.autoGenerationId;
      if (typeof id !== 'string' || id === generationId) return;
      generationId = id;
      unsubscribeJob?.();
      unsubscribeJob = onSnapshot(doc(db, 'users', uid, 'nutritionGenerationJobs', id), (job) => {
        completed = job.data()?.status === 'completed';
        if (completed) void show().catch(() => {});
      });
    });
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void show().catch(() => {}); });
    return () => { cancelled = true; unsubscribe(); unsubscribeJob?.(); subscription.remove(); };
  }, [user, enabled, allowed, rolloutAllowed]);
  const presentation = useMemo(() => createNutritionNoticePresentation({
    schedule: requestAnimationFrame,
    cancel: cancelAnimationFrame,
    isCurrent: () => Boolean(ready && auth.currentUser?.uid === ready.uid && enabled && allowed && rolloutAllowed && AppState.currentState === 'active'),
    markSeen: () => ready ? AsyncStorage.setItem(`ajfit.nutrition-ready-seen.v1:${ready.uid}:${ready.generationId}`, '1') : Promise.resolve(),
  }), [ready, enabled, allowed, rolloutAllowed]);
  useEffect(() => () => presentation.dispose(), [presentation]);
  if (!ready || ready.uid !== user?.uid || !enabled || !allowed || !rolloutAllowed) return null;
  // Opaque `toastBackground` (not `surfaceElevated`, which is a near-transparent
  // wash meant for cards sitting on an already-opaque screen background) — this
  // banner floats over arbitrary screen content, so it needs a fully solid
  // surface. `top: insets.top + ...` (not a fixed pixel) keeps it clear of the
  // status bar / Dynamic Island on every device.
  return <View onLayout={presentation.onLayout} accessibilityRole="alert" accessibilityLiveRegion="polite"
    style={{ position: 'absolute', top: insets.top + 12, left: 16, right: 16, zIndex: 90, elevation: 90,
      padding: 16, borderRadius: 14, backgroundColor: theme.colors.toastBackground, borderWidth: 1, borderColor: theme.colors.toastSuccessBorder,
      shadowColor: theme.colors.success, shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: 0 } }}>
    <Pressable accessibilityRole="button" onPress={() => { setReady(null); onOpen(); }} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="check" size={16} color={theme.colors.statusForeground} stroke={2.6} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi }}>{t('onboarding.readyTitle')}</Text>
        <Text style={{ color: theme.colors.textMuted, marginTop: 4 }}>{t('onboarding.readyBody')}</Text>
      </View>
    </Pressable>
    <Pressable onPress={() => setReady(null)} accessibilityRole="button"><Text style={{ color: theme.colors.primaryEmphasis, marginTop: 8 }}>{t('onboarding.dismiss')}</Text></Pressable>
  </View>;
}
