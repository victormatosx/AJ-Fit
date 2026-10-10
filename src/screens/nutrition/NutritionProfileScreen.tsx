import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Timestamp } from 'firebase/firestore';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display, MonoLabel } from '../../components/ui/Display';
import { CtaButton } from '../../components/ui/CtaButton';
import { Icon } from '../../components/ui/Icon';
import { SelectableChip, SelectableRow } from '../../components/nutrition/NutritionPrimitives';
import { FoodRow } from '../../components/nutrition/FoodRow';
import { useTheme } from '../../theme';
import { useAppState } from '../../state/AppState';
import {
  DIETARY_PATTERNS, NON_TRAINING_ACTIVITY_LEVELS, NUTRITION_FOOD_ALLERGENS, NUTRITION_GOAL_CATEGORIES,
  NUTRITION_MEAL_SLOTS, NUTRITION_PROGRESSION_PACES, NUTRITION_SUPPLEMENT_IDS, VARIETY_PREFERENCES,
  type NutritionGoal, type NutritionProfile,
} from '../../types/nutrition';
import {
  canContinueProfileStep, isSafetyBlocked, profileStepOrder, type ProfileDraft, type ProfileStepId,
} from '../../nutrition/ui/profileSteps';
import { FoodSearchScreen, type NutritionFoodPick } from './FoodSearchScreen';

function emptyDraft(goal: NutritionGoal, pregnantDefault: boolean): ProfileDraft {
  return {
    questionnaireVersion: 1,
    nonTrainingActivityLevel: undefined, mealSlots: [], dietaryPattern: undefined,
    preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [], excludedAllergens: [],
    supplements: [], pregnant: pregnantDefault, breastfeeding: false, varietyPreference: undefined,
  };
}

type FoodPickerTarget = 'preferredFoodIds' | 'usualFoodIds' | 'excludedFoodIds' | null;

export function NutritionProfileScreen({
  profile, inheritedGoal, mode, onCancel, saving, saveError, onSubmit, favoriteFoodIds, onToggleFavoriteFood,
}: {
  profile: NutritionProfile<Timestamp> | null;
  inheritedGoal: NutritionGoal;
  mode: 'create' | 'edit';
  onCancel: () => void;
  saving: boolean;
  saveError: string | null;
  onSubmit: (draft: ProfileDraft) => Promise<void>;
  favoriteFoodIds?: readonly string[];
  onToggleFavoriteFood?: (foodId: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const { quiz } = useAppState();
  const steps = useMemo(() => profileStepOrder(inheritedGoal), [inheritedGoal]);
  const [draft, setDraft] = useState<ProfileDraft>(
    () => (profile ? { ...profile } : emptyDraft(inheritedGoal, Boolean(quiz?.pregnancyScreening))),
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [reviewing, setReviewing] = useState(mode === 'edit');
  const [foodPicker, setFoodPicker] = useState<FoodPickerTarget>(null);
  const [foodNames, setFoodNames] = useState<Record<string, string>>({});

  const step: ProfileStepId | null = reviewing ? null : steps[stepIndex] ?? null;
  const canContinue = step ? canContinueProfileStep(step, draft) : true;
  const safetyBlocked = isSafetyBlocked(draft);

  const patch = (next: Partial<ProfileDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  const goNext = () => {
    if (stepIndex + 1 < steps.length) setStepIndex(stepIndex + 1);
    else setReviewing(true);
  };
  const goBack = () => {
    if (reviewing) { setReviewing(false); setStepIndex(steps.length - 1); return; }
    if (stepIndex === 0) onCancel();
    else setStepIndex(stepIndex - 1);
  };

  const toggleListValue = (key: 'mealSlots' | 'excludedAllergens' | 'supplements', value: string) => {
    const current = (draft[key] as string[] | undefined) ?? [];
    patch({ [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] } as Partial<ProfileDraft>);
  };

  const addFoodId = (target: Exclude<FoodPickerTarget, null>, pick: NutritionFoodPick) => {
    const current = (draft[target] as string[] | undefined) ?? [];
    setFoodNames((prev) => ({ ...prev, [pick.foodId]: pick.name }));
    if (current.includes(pick.foodId)) return;
    patch({ [target]: [...current, pick.foodId] } as Partial<ProfileDraft>);
  };
  const removeFoodId = (target: Exclude<FoodPickerTarget, null>, foodId: string) => {
    const current = (draft[target] as string[] | undefined) ?? [];
    patch({ [target]: current.filter((id) => id !== foodId) } as Partial<ProfileDraft>);
  };

  function FoodIdListEditor({ target, titleKey, addCtaKey, emptyKey }: {
    target: Exclude<FoodPickerTarget, null>; titleKey: string; addCtaKey: string; emptyKey: string;
  }) {
    const ids = (draft[target] as string[] | undefined) ?? [];
    return (
      <View style={{ gap: 10 }}>
        <Text style={{ fontFamily: theme.fonts.display, fontSize: 22, color: theme.colors.textPrimary }}>
          {t(titleKey as never)}
        </Text>
        {ids.length === 0 ? (
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>{t(emptyKey as never)}</Text>
        ) : ids.map((id) => (
          <FoodRow key={id} name={foodNames[id] ?? id} trailing={(
            <Icon name="x" size={16} color={theme.colors.textFaint} />
          )} onPress={() => removeFoodId(target, id)} />
        ))}
        <SelectableRow role="checkbox" label={t(addCtaKey as never)} selected={false} onPress={() => setFoodPicker(target)} />
      </View>
    );
  }

  function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
    return (
      <View style={{ gap: 6, marginBottom: 20 }}>
        <Display size={22}>{title}</Display>
        {subtitle ? <Text style={{ fontFamily: theme.fonts.ui, fontSize: 14, color: theme.colors.textMuted }}>{subtitle}</Text> : null}
      </View>
    );
  }

  function renderStep(current: ProfileStepId) {
    switch (current) {
      case 'nutritionGoalCategory':
        return (
          <>
            <StepTitle title={t('profile.questions.nutritionGoalCategory.title')} subtitle={t('profile.questions.nutritionGoalCategory.subtitle')} />
            <View style={{ gap: 10 }}>
              {NUTRITION_GOAL_CATEGORIES.map((option) => (
                <SelectableRow key={option} label={t(`profile.questions.nutritionGoalCategory.options.${option}`)}
                  selected={draft.nutritionGoalCategory === option} onPress={() => patch({ nutritionGoalCategory: option })} />
              ))}
            </View>
          </>
        );
      case 'progressionPace':
        return (
          <>
            <StepTitle title={t('profile.questions.progressionPace.title')} />
            <View style={{ gap: 10 }}>
              {NUTRITION_PROGRESSION_PACES.map((option) => (
                <SelectableRow key={option} label={t(`profile.questions.progressionPace.options.${option}`)}
                  selected={draft.progressionPace === option} onPress={() => patch({ progressionPace: option })} />
              ))}
            </View>
          </>
        );
      case 'targetWeightKg':
        return (
          <>
            <StepTitle title={t('profile.questions.targetWeightKg.title')} subtitle={t('profile.questions.targetWeightKg.subtitle')} />
            <SelectableRow label={t('profile.questions.targetWeightKg.skip')} selected={draft.targetWeightKg == null}
              onPress={() => patch({ targetWeightKg: null })} />
          </>
        );
      case 'nonTrainingActivityLevel':
        return (
          <>
            <StepTitle title={t('profile.questions.nonTrainingActivityLevel.title')} />
            <View style={{ gap: 10 }}>
              {NON_TRAINING_ACTIVITY_LEVELS.map((option) => (
                <SelectableRow key={option} label={t(`profile.questions.nonTrainingActivityLevel.options.${option}`)}
                  selected={draft.nonTrainingActivityLevel === option} onPress={() => patch({ nonTrainingActivityLevel: option })} />
              ))}
            </View>
          </>
        );
      case 'mealSlots':
        return (
          <>
            <StepTitle title={t('profile.questions.mealSlots.title')} subtitle={t('profile.questions.mealSlots.subtitle')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {NUTRITION_MEAL_SLOTS.map((slot) => (
                <SelectableChip key={slot} label={t(`mealSlots.${slot}`)}
                  selected={(draft.mealSlots ?? []).includes(slot)}
                  disabled={!(draft.mealSlots ?? []).includes(slot) && (draft.mealSlots ?? []).length >= 6}
                  onPress={() => toggleListValue('mealSlots', slot)} />
              ))}
            </View>
          </>
        );
      case 'dietaryPattern':
        return (
          <>
            <StepTitle title={t('profile.questions.dietaryPattern.title')} />
            <View style={{ gap: 10 }}>
              {DIETARY_PATTERNS.map((option) => (
                <SelectableRow key={option} label={t(`profile.questions.dietaryPattern.options.${option}`)}
                  selected={draft.dietaryPattern === option} onPress={() => patch({ dietaryPattern: option })} />
              ))}
            </View>
          </>
        );
      case 'preferredFoodIds':
        return (
          <FoodIdListEditor target="preferredFoodIds" titleKey="profile.questions.preferredFoodIds.title"
            addCtaKey="profile.questions.preferredFoodIds.addCta" emptyKey="profile.questions.preferredFoodIds.empty" />
        );
      case 'usualFoodIds':
        return (
          <FoodIdListEditor target="usualFoodIds" titleKey="profile.questions.usualFoodIds.title"
            addCtaKey="profile.questions.usualFoodIds.addCta" emptyKey="profile.questions.usualFoodIds.empty" />
        );
      case 'excludedFoodIds':
        return (
          <FoodIdListEditor target="excludedFoodIds" titleKey="profile.questions.excludedFoodIds.title"
            addCtaKey="profile.questions.excludedFoodIds.addCta" emptyKey="profile.questions.excludedFoodIds.empty" />
        );
      case 'excludedAllergens':
        return (
          <>
            <StepTitle title={t('profile.questions.excludedAllergens.title')} subtitle={t('profile.questions.excludedAllergens.subtitle')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {NUTRITION_FOOD_ALLERGENS.map((option) => (
                <SelectableChip key={option} label={t(`profile.questions.excludedAllergens.options.${option}`)}
                  selected={(draft.excludedAllergens ?? []).includes(option)} onPress={() => toggleListValue('excludedAllergens', option)} />
              ))}
            </View>
          </>
        );
      case 'supplements':
        return (
          <>
            <StepTitle title={t('profile.questions.supplements.title')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {NUTRITION_SUPPLEMENT_IDS.map((option) => (
                <SelectableChip key={option} label={t(`profile.questions.supplements.options.${option}`)}
                  selected={(draft.supplements ?? []).includes(option)} onPress={() => toggleListValue('supplements', option)} />
              ))}
            </View>
          </>
        );
      case 'pregnant':
        return (
          <>
            <StepTitle title={t('profile.questions.pregnant.title')} />
            <View style={{ gap: 10 }}>
              <SelectableRow label={t('profile.questions.pregnant.yes')} selected={draft.pregnant === true} onPress={() => patch({ pregnant: true })} />
              <SelectableRow label={t('profile.questions.pregnant.no')} selected={draft.pregnant === false} onPress={() => patch({ pregnant: false })} />
            </View>
          </>
        );
      case 'breastfeeding':
        return (
          <>
            <StepTitle title={t('profile.questions.breastfeeding.title')} />
            <View style={{ gap: 10 }}>
              <SelectableRow label={t('profile.questions.breastfeeding.yes')} selected={draft.breastfeeding === true} onPress={() => patch({ breastfeeding: true })} />
              <SelectableRow label={t('profile.questions.breastfeeding.no')} selected={draft.breastfeeding === false} onPress={() => patch({ breastfeeding: false })} />
            </View>
          </>
        );
      case 'varietyPreference':
        return (
          <>
            <StepTitle title={t('profile.questions.varietyPreference.title')} />
            <View style={{ gap: 10 }}>
              {VARIETY_PREFERENCES.map((option) => (
                <SelectableRow key={option} label={t(`profile.questions.varietyPreference.options.${option}`)}
                  selected={draft.varietyPreference === option} onPress={() => patch({ varietyPreference: option })} />
              ))}
            </View>
          </>
        );
      default:
        return null;
    }
  }

  async function handleSubmit() {
    await onSubmit(draft);
  }

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 6 }}>
          <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel={t('profile.actions.back')} hitSlop={10}>
            <Icon name="arrow-left" size={20} color={theme.colors.textPrimary} />
          </Pressable>
          <MonoLabel color={theme.colors.textFaint}>
            {reviewing ? t('profile.review.title') : t('profile.stepOf', { current: stepIndex + 1, total: steps.length })}
          </MonoLabel>
          <View style={{ width: 20 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 40 }}>
          {reviewing ? (
            <ReviewSection draft={draft} safetyBlocked={safetyBlocked} saveError={saveError} />
          ) : step ? renderStep(step) : null}
        </ScrollView>

        <View style={{ padding: 22 }}>
          {reviewing ? (
            <CtaButton onPress={handleSubmit} disabled={saving || safetyBlocked}>
              {t('profile.review.cta')}
            </CtaButton>
          ) : (
            <CtaButton onPress={goNext} disabled={!canContinue}>{t('profile.actions.next')}</CtaButton>
          )}
        </View>
      </SafeAreaView>

      <FoodSearchScreen
        visible={foodPicker != null}
        onClose={() => setFoodPicker(null)}
        excludeIds={foodPicker ? ((draft[foodPicker] as string[] | undefined) ?? []) : []}
        favoriteFoodIds={favoriteFoodIds}
        onToggleFavoriteFood={onToggleFavoriteFood}
        onSelect={(pick) => { if (foodPicker) addFoodId(foodPicker, pick); setFoodPicker(null); }}
      />
    </ScreenBg>
  );
}

function ReviewSection({ draft, safetyBlocked, saveError }: { draft: ProfileDraft; safetyBlocked: boolean; saveError: string | null }) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const row = (label: string, value: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13.5, color: theme.colors.textMuted }}>{label}</Text>
      <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13.5, color: theme.colors.textPrimary, flexShrink: 1, textAlign: 'right' }} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
  const none = t('profile.review.none');
  return (
    <View>
      <Display size={22} style={{ marginBottom: 6 }}>{t('profile.review.title')}</Display>
      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 14, color: theme.colors.textMuted, marginBottom: 18 }}>
        {t('profile.review.subtitle')}
      </Text>

      {safetyBlocked ? (
        <View style={{ padding: 16, borderRadius: theme.radii.lg, backgroundColor: theme.colors.feedbackCriticalBackground,
          borderWidth: 1, borderColor: theme.colors.feedbackCriticalBorder, marginBottom: 18 }}>
          <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 14, color: theme.colors.feedbackCriticalText }}>
            {t('home.pregnancyBlock.title')}
          </Text>
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.feedbackCriticalText, marginTop: 6, lineHeight: 19 }}>
            {t('home.pregnancyBlock.body')}
          </Text>
        </View>
      ) : null}

      {draft.nutritionGoalCategory ? row(t('profile.review.goal'), t(`profile.questions.nutritionGoalCategory.options.${draft.nutritionGoalCategory}`)) : null}
      {draft.nonTrainingActivityLevel ? row(t('profile.review.activity'), t(`profile.questions.nonTrainingActivityLevel.options.${draft.nonTrainingActivityLevel}`)) : null}
      {row(t('profile.review.meals'), (draft.mealSlots ?? []).map((slot) => t(`mealSlots.${slot}`)).join(', ') || none)}
      {draft.dietaryPattern ? row(t('profile.review.dietaryPattern'), t(`profile.questions.dietaryPattern.options.${draft.dietaryPattern}`)) : null}
      {row(t('profile.review.preferred'), String((draft.preferredFoodIds ?? []).length || none))}
      {row(t('profile.review.usual'), String((draft.usualFoodIds ?? []).length || none))}
      {row(t('profile.review.excluded'), String((draft.excludedFoodIds ?? []).length || none))}
      {row(t('profile.review.allergens'), (draft.excludedAllergens ?? []).length > 0
        ? (draft.excludedAllergens ?? []).map((item) => t(`profile.questions.excludedAllergens.options.${item}`)).join(', ') : none)}
      {row(t('profile.review.supplements'), (draft.supplements ?? []).length > 0
        ? (draft.supplements ?? []).map((item) => t(`profile.questions.supplements.options.${item}`)).join(', ') : none)}
      {draft.varietyPreference ? row(t('profile.review.variety'), t(`profile.questions.varietyPreference.options.${draft.varietyPreference}`)) : null}

      {saveError ? (
        <Text style={{ color: theme.colors.formErrorText, fontSize: 13, marginTop: 14 }}>{t('profile.errors.saveFailed')}</Text>
      ) : null}
    </View>
  );
}
