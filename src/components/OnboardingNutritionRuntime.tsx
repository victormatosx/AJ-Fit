import { runInitialNutritionRequest, setInitialNutritionDisabled } from '../services/initialNutritionRequest';
import { loadNutritionRolloutConfig, nutritionFlagEnabled, loadOnboardingAutomaticGenerationFlag, onboardingAutomaticGenerationEnabled } from '../nutrition/rollout';
import React, { useEffect, useState } from 'react';
import { Alert, AppState, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { useAuth } from '../state/AuthContext';
import { useTheme } from '../theme';
import { readOnboardingDraft, clearOnboardingDraft } from '../onboarding/draftStorage';
import { transferOnboardingNutrition } from '../services/onboardingNutritionHandoff';
import { consumeCapturedOnboardingHealthChoice } from '../services/onboardingHealthHandoff';
import { requestInitialNutritionPlanGeneration } from '../services/nutritionGeneration';

/** Passive, identity-scoped recovery. Never holds the root navigation gate. */
export function OnboardingNutritionRuntime({ accessReady }: { accessReady: boolean }) {
  const { user, questionnaire } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user || !questionnaire) return;
    const uid = user.uid;
    let cancelled = false;
    let running = false;
    let enrollmentFinished = false;

    const current = () => !cancelled && auth.currentUser?.uid === uid;
    const recover = async () => {
      if (!current() || running || AppState.currentState !== 'active') return;
      running = true;
      try {
        const draft = await readOnboardingDraft();
        if (draft) {
          const result = await transferOnboardingNutrition(uid);
          if (!current()) return;
          await consumeCapturedOnboardingHealthChoice(uid, draft, result === 'transferred' || result === 'existing');
          if (result === 'foreign') {
            if (draft.transfer) setError(true);
            return; // Keep partial/legacy nutrition independently of the health choice.
          }
          if (!current()) return;
          await clearOnboardingDraft({ uid, sessionId: draft.sessionId });
        }
        if (!current()) return;
        setError(false);
        if (!accessReady || enrollmentFinished) return;
        const marker = await getDoc(doc(db, 'users', uid, 'onboardingNutritionState', 'current'));
        if (!current()) return;
        if (!marker.exists() || marker.data().autoGenerationId || marker.data().autoSkipped) { enrollmentFinished = true; return; }
        // A second device can finish the transfer; only the backend authorizes the request.
        const profile = await getDoc(doc(db, 'users', uid, 'nutritionProfile', 'current'));
        if (!profile.exists() || !current()) return;
        const rollout = await loadNutritionRolloutConfig();
        const automaticFlag = await loadOnboardingAutomaticGenerationFlag();
        if (!current()) return;
        if (!nutritionFlagEnabled(uid, 'nutritionPlanGenerationEnabled', rollout)
          || !onboardingAutomaticGenerationEnabled(uid, automaticFlag)) {
          await setInitialNutritionDisabled(uid); return;
        }
        await runInitialNutritionRequest(uid, async () => {
          if (!current()) throw new Error('ONBOARDING_IDENTITY_CHANGED');
          return requestInitialNutritionPlanGeneration();
        });
      } catch { if (current()) setError(true); }
      finally { running = false; }
    };
    void recover();
    const timer = setInterval(() => { void recover(); }, 30000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void recover(); });
    return () => { cancelled = true; clearInterval(timer); subscription.remove(); };
  }, [user, questionnaire, accessReady, retry]);
  if (!error) return null;
  return <View style={{ position: 'absolute', top: 56, left: 16, right: 16, zIndex: 100, elevation: 100,
    backgroundColor: theme.colors.surfaceElevated, padding: 14, borderRadius: 12 }}>
    <Text accessibilityRole="alert" style={{ color: theme.colors.textPrimary }}>{t('onboarding.recovery')}</Text>
    <Pressable onPress={() => setRetry((value) => value + 1)}><Text style={{ color: theme.colors.primaryEmphasis }}>{t('onboarding.retry')}</Text></Pressable>
    <Pressable onPress={() => Alert.alert(t('onboarding.discardTitle'), t('onboarding.discardBody'), [
      { text: t('onboarding.cancel'), style: 'cancel' },
      { text: t('onboarding.discard'), style: 'destructive', onPress: () => { void clearOnboardingDraft().then(() => { setError(false); setRetry((value) => value + 1); }); } },
    ])}><Text style={{ color: theme.colors.textMuted }}>{t('onboarding.discard')}</Text></Pressable>
  </View>;
}
