import type { ResolvedUnits } from '../../types/units';
import { searchOnboardingCatalog, onboardingCatalogFoods, type OnboardingCustomFood } from '../../nutrition/catalog/onboardingCatalog';
import type { CustomFoodInput } from '../../services/nutritionFoods';
import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Timestamp } from 'firebase/firestore';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display, MonoLabel } from '../../components/ui/Display';
import { CtaButton } from '../../components/ui/CtaButton';
import { Icon } from '../../components/ui/Icon';
import { SelectableChip, SelectableRow } from '../../components/nutrition/NutritionPrimitives';
import { FoodRow } from '../../components/nutrition/FoodRow';
import { useAjFunnelDirector } from '../../components/onboarding/AjFunnelStage';
import { useTheme } from '../../theme';
import { useUnits } from '../../state/UnitsContext';
import { formatWeightFromKg, formatWeightInputFromKg, weightUnit } from '../../units/weightConversions';
import { useAuth } from '../../state/AuthContext';
import {
  NON_TRAINING_ACTIVITY_LEVELS, NUTRITION_FOOD_ALLERGENS, NUTRITION_GOAL_CATEGORIES,
  NUTRITION_MEAL_SLOTS, NUTRITION_PROGRESSION_PACES, NUTRITION_SUPPLEMENT_IDS, VARIETY_PREFERENCES,
  type NutritionGoal, type NutritionProfile,
} from '../../types/nutrition';
import {
  emptyProfileDraft, canContinueProfileStep, isProfileDraftComplete, parseTargetWeightInput, profileDraftFromSaved, profileStepOrder, toggleDietaryPattern, type ProfileDraft, type ProfileStepId,
} from '../../nutrition/ui/profileSteps';
import { loadCatalogFood, loadCustomFood } from '../../services/nutritionFoods';
import { CreateCustomFoodScreen } from './CreateCustomFoodScreen';
import { FoodSearchScreen, type NutritionFoodPick } from './FoodSearchScreen';

type FoodPickerTarget = 'preferredFoodIds' | 'excludedFoodIds' | null;

export function NutritionProfileScreen({
  profile, inheritedGoal, currentWeightKg, mode, onCancel, saving, saveError, onSubmit, favoriteFoodIds, onToggleFavoriteFood,
}: {
  profile: NutritionProfile<Timestamp> | null;
  inheritedGoal: NutritionGoal;
  currentWeightKg?: number | null;
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
  const { resolvedUnits } = useUnits();
  const [targetWeightText, setTargetWeightText] = useState(() => profile?.targetWeightKg != null
    ? formatWeightInputFromKg(profile.targetWeightKg, resolvedUnits) : '');
  const steps = useMemo(() => profileStepOrder(inheritedGoal), [inheritedGoal]);
  const [draft, setDraft] = useState<ProfileDraft>(
    () => (profile ? profileDraftFromSaved(profile) : emptyProfileDraft()),
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [reviewing, setReviewing] = useState(mode === 'edit');
  const step: ProfileStepId | null = reviewing ? null : steps[stepIndex] ?? null;
  const canContinue = step ? canContinueProfileStep(step, draft, inheritedGoal) : isProfileDraftComplete(inheritedGoal, draft);

  const goNext = () => {
    Keyboard.dismiss();
    if (stepIndex + 1 < steps.length) setStepIndex(stepIndex + 1);
    else setReviewing(true);
  };
  const goBack = () => {
    Keyboard.dismiss();
    if (reviewing) { setReviewing(false); setStepIndex(steps.length - 1); return; }
    if (stepIndex === 0) onCancel();
    else setStepIndex(stepIndex - 1);
  };

  async function handleSubmit() {
    if (!canContinue || saving) return;
    await onSubmit(draft);
  }

  return (
    <ScreenBg>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, paddingBottom: 40 }}>
          {reviewing ? (
            <>
              <ReviewSection draft={draft} currentWeightKg={currentWeightKg} saveError={saveError} />
              {!canContinue ? <Pressable accessibilityRole="button" onPress={() => {
                setStepIndex(steps.findIndex((id) => !canContinueProfileStep(id, draft, inheritedGoal)));
                setReviewing(false);
              }}><Text style={{ color: theme.colors.formErrorText, marginTop: 14 }}>{t('profile.errors.invalid')}</Text></Pressable> : null}
            </>
          ) : step ? <NutritionProfileQuestion step={step} draft={draft} onChange={setDraft}
            currentWeightKg={currentWeightKg} targetWeightText={targetWeightText} onTargetWeightText={setTargetWeightText}
            favoriteFoodIds={favoriteFoodIds} onToggleFavoriteFood={onToggleFavoriteFood} /> : null}
        </ScrollView>

        <View style={{ padding: 22 }}>
          {reviewing ? (
            <CtaButton onPress={handleSubmit} disabled={saving || !canContinue}>
              {t('profile.review.cta')}
            </CtaButton>
          ) : (
            <CtaButton onPress={goNext} disabled={!canContinue}>{t('profile.actions.next')}</CtaButton>
          )}
        </View>
      </SafeAreaView>
      </KeyboardAvoidingView>

    </ScreenBg>
  );
}


/** Controlled question body shared by onboarding and the internal profile. */
/**
 * A chosen food, as the acquisition design draws it: a filled accent pill
 * that removes itself when tapped. Local to this file because the shared
 * `SelectableChip` is used across the nutrition area and must not change.
 */
function SelectedFoodChip({
  label, onPress, accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingVertical: 9,
        paddingHorizontal: 13,
        borderRadius: theme.radii.pill,
        backgroundColor: theme.colors.primary,
        borderWidth: 1,
        borderColor: theme.colors.primary,
        shadowColor: theme.colors.primaryGlowSoft,
        shadowOpacity: 1,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 0 },
      }}
    >
      <Text style={{ fontFamily: theme.fonts.uiMed, fontSize: 14, color: theme.colors.primaryForeground }}>
        {label}
      </Text>
      <Icon name="x" size={12} color={theme.colors.primaryForeground} stroke={2.4} />
    </Pressable>
  );
}

export function NutritionProfileQuestion({ step, draft, onChange, currentWeightKg, targetWeightText,
  onTargetWeightText: setTargetWeightText, favoriteFoodIds, onToggleFavoriteFood, localFoods, onCreateLocalFood, hideTitle = false, inputUnits,
  variant = 'profile',
}: {
  inputUnits?: ResolvedUnits;
  /**
   * Purely visual, mirroring `FoodSearchScreen`'s own switch. `'profile'`
   * keeps the standalone nutrition wizard exactly as it was; `'onboarding'`
   * is the acquisition design, used only by the funnel.
   */
  variant?: 'profile' | 'onboarding';
  hideTitle?: boolean;
  localFoods?: readonly OnboardingCustomFood[];
  onCreateLocalFood?: (input: CustomFoodInput) => Promise<string>;
  step: ProfileStepId; draft: ProfileDraft; onChange: (draft: ProfileDraft) => void;
  currentWeightKg?: number | null; targetWeightText: string; onTargetWeightText: (text: string) => void;
  favoriteFoodIds?: readonly string[]; onToggleFavoriteFood?: (id: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const { user } = useAuth();
  const { resolvedUnits: preferredUnits } = useUnits();
  const resolvedUnits = inputUnits ?? preferredUnits;
  const unit = weightUnit(resolvedUnits);
  const profile = draft;
  const onboarding = variant === 'onboarding';
  // The funnel's single persistent mascot. Outside the funnel this resolves
  // to an inert director, so the standalone wizard is unaffected.
  const aj = useAjFunnelDirector();
  const targetWeightValid = canContinueProfileStep('targetWeightKg', draft);
  const patch = (next: Partial<ProfileDraft>) => onChange({ ...draft, ...next });
  const [creatingFoodTarget, setCreatingFoodTarget] = useState<FoodPickerTarget>(null);
  const [foodNames, setFoodNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    const ids = [...new Set([...(profile?.preferredFoodIds ?? []), ...(profile?.excludedFoodIds ?? [])])];
    if (localFoods) {
      setFoodNames(Object.fromEntries([...onboardingCatalogFoods, ...localFoods].map((food) => [food.id, food.name])));
      return;
    }
    void Promise.allSettled(ids.map(async (id) => {
      const food = id.startsWith('custom_') && user?.uid ? await loadCustomFood(user.uid, id) : await loadCatalogFood(id);
      return food ? { id, name: food.name } : null;
    })).then((results) => {
      if (!active) return;
      const names: Record<string, string> = {};
      for (const result of results) if (result.status === 'fulfilled' && result.value) names[result.value.id] = result.value.name;
      setFoodNames((previous) => ({ ...names, ...previous }));
    });
    return () => { active = false; };
  }, [profile, user?.uid, localFoods]);


  const toggleListValue = (key: 'mealSlots' | 'excludedAllergens' | 'supplements', value: string) => {
    const current = (draft[key] as string[] | undefined) ?? [];
    patch({ [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] } as Partial<ProfileDraft>);
  };

  const addFoodId = (target: Exclude<FoodPickerTarget, null>, pick: NutritionFoodPick) => {
    const current = (draft[target] as string[] | undefined) ?? [];
    setFoodNames((prev) => ({ ...prev, [pick.foodId]: pick.name }));
    if (current.includes(pick.foodId) || current.length >= 10) return;
    patch({ [target]: [...current, pick.foodId] } as Partial<ProfileDraft>);
  };
  const removeFoodId = (target: Exclude<FoodPickerTarget, null>, foodId: string) => {
    const current = (draft[target] as string[] | undefined) ?? [];
    patch({ [target]: current.filter((id) => id !== foodId) } as Partial<ProfileDraft>);
  };

  function renderFoodIdListEditor({ target, titleKey, emptyKey, showTitle = true }: {
    target: Exclude<FoodPickerTarget, null>; titleKey: string; emptyKey: string; showTitle?: boolean;
  }) {
    const ids = (draft[target] as string[] | undefined) ?? [];
    const atLimit = ids.length >= 10;

    // The chosen foods. The acquisition design puts them directly under the
    // field as removable chips; the profile wizard keeps its original rows.
    // Both call the same `removeFoodId`.
    const chosen = onboarding ? (
      ids.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ids.map((id) => (
            <SelectedFoodChip
              key={id}
              label={foodNames[id] ?? id}
              accessibilityLabel={t('foodSearch.removeAccessibility', { food: foodNames[id] ?? id })}
              onPress={() => {
                aj.setLook([0, 2.2]);
                aj.play('nod');
                removeFoodId(target, id);
              }}
            />
          ))}
        </View>
      ) : null
    ) : null;

    if (onboarding) {
      return (
        <View style={{ gap: 18 }}>
          {atLimit ? (
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13.5, lineHeight: 19, color: theme.colors.textSubtleStrong }}>
              {t('foodSearch.selectionLimit', { count: 10 })}
            </Text>
          ) : null}
          {atLimit ? chosen : (
            <FoodSearchScreen
              key={target} catalogSearch={localFoods ? searchOnboardingCatalog : undefined} localFoods={localFoods}
              visible presentation="inline" variant="onboarding" catalog="generation" onClose={Keyboard.dismiss}
              excludeIds={ids} favoriteFoodIds={favoriteFoodIds} onToggleFavoriteFood={onToggleFavoriteFood}
              inlineBelowField={chosen}
              onSelect={(pick) => {
                aj.setLook([0, 2.2]);
                aj.play('hop');
                addFoodId(target, pick);
              }}
              onRequestCreateFood={() => setCreatingFoodTarget(target)}
            />
          )}
        </View>
      );
    }

    return (
      <View style={{ gap: 10 }}>
        {showTitle && !hideTitle ? <Text style={{ fontFamily: theme.fonts.display, fontSize: 22, color: theme.colors.textPrimary }}>
          {t(titleKey as never)}
        </Text> : null}
        {ids.length < 10 ? <FoodSearchScreen
          key={target} catalogSearch={localFoods ? searchOnboardingCatalog : undefined} localFoods={localFoods} visible presentation="inline" catalog="generation" onClose={Keyboard.dismiss}
          excludeIds={ids} favoriteFoodIds={favoriteFoodIds} onToggleFavoriteFood={onToggleFavoriteFood}
          onSelect={(pick) => addFoodId(target, pick)} onRequestCreateFood={() => setCreatingFoodTarget(target)}
        /> : <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textMuted }}>
          {t('foodSearch.selectionLimit', { count: 10 })}
        </Text>}
        {ids.length === 0 ? (
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>{t(emptyKey as never)}</Text>
        ) : ids.map((id) => (
          <FoodRow key={id} name={foodNames[id] ?? id} trailing={(
            <Icon name="x" size={16} color={theme.colors.textFaint} />
          )} onPress={() => removeFoodId(target, id)} />
        ))}
      </View>
    );
  }

  function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
    if (hideTitle) return null;
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
            <View style={{ gap: 16 }}>
              <View style={{ padding: 16, borderRadius: theme.radii.lg, backgroundColor: theme.colors.choiceBackground,
                borderWidth: 1, borderColor: theme.colors.choiceBorder }}>
                <MonoLabel color={theme.colors.textMuted}>{t('profile.questions.targetWeightKg.currentWeight')}</MonoLabel>
                <Text style={{ fontFamily: theme.fonts.display, fontSize: 32, color: theme.colors.textPrimary, marginTop: 6 }}>
                  {currentWeightKg != null ? `${formatWeightFromKg(currentWeightKg, resolvedUnits)} ${unit}` : t('profile.questions.targetWeightKg.unavailable')}
                </Text>
              </View>
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }}>
                  {t('profile.questions.targetWeightKg.label', { unit })}
                </Text>
                <TextInput value={targetWeightText}
                  onChangeText={(text) => { setTargetWeightText(text); patch({ targetWeightKg: parseTargetWeightInput(text, resolvedUnits) }); }}
                  keyboardType="decimal-pad" returnKeyType="done"
                  accessibilityLabel={t('profile.questions.targetWeightKg.label', { unit })}
                  placeholder={t('profile.questions.targetWeightKg.placeholder', { unit })}
                  placeholderTextColor={theme.colors.textFaint}
                  style={{ minHeight: 56, paddingHorizontal: 16, borderRadius: theme.radii.lg, borderWidth: 1,
                    borderColor: targetWeightValid ? theme.colors.inputBorder : theme.colors.inputBorderError,
                    backgroundColor: theme.colors.inputBackground, color: theme.colors.textPrimary,
                    fontFamily: theme.fonts.ui, fontSize: 20 }} />
                {!targetWeightValid ? <Text accessibilityRole="alert" style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.formErrorText }}>
                  {t('profile.questions.targetWeightKg.invalid', { max: formatWeightInputFromKg(500, resolvedUnits), unit })}
                </Text> : null}
              </View>
              <SelectableRow label={t('profile.questions.targetWeightKg.skip')} selected={draft.targetWeightKg == null}
                onPress={() => { setTargetWeightText(''); patch({ targetWeightKg: null }); }} />
            </View>
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
      case 'preferredFoodIds':
        return renderFoodIdListEditor({ target: 'preferredFoodIds', titleKey: 'profile.questions.preferredFoodIds.title',
          emptyKey: 'profile.questions.preferredFoodIds.empty' });
      case 'excludedFoodIds':
        return (
          <View style={{ gap: 24 }}>
            <View>
              <StepTitle title={t('profile.questions.excludedFoodIds.title')} subtitle={t('profile.questions.dietaryPattern.subtitle')} />
              <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textMuted, marginBottom: 10 }}>
                {t('profile.questions.dietaryPattern.title')}
              </Text>
              <View style={{ gap: 10 }}>
                {(['vegetarian', 'vegan', 'pescatarian'] as const).map((option) => (
                  <SelectableRow key={option} label={t(`profile.questions.dietaryPattern.options.${option}`)}
                    selected={draft.dietaryPattern === option}
                    onPress={() => patch({ dietaryPattern: toggleDietaryPattern(draft.dietaryPattern, option) })} />
                ))}
              </View>
            </View>
            {renderFoodIdListEditor({ target: 'excludedFoodIds', showTitle: false, titleKey: 'profile.questions.excludedFoodIds.title',
              emptyKey: 'profile.questions.excludedFoodIds.empty' })}
          </View>
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

  return <>{renderStep(step)}
    <Modal visible={creatingFoodTarget != null} onRequestClose={() => setCreatingFoodTarget(null)} animationType="slide">
      <CreateCustomFoodScreen createFood={onCreateLocalFood} visible={creatingFoodTarget != null} onClose={() => setCreatingFoodTarget(null)}
        onCreated={(food) => {
          if (creatingFoodTarget) addFoodId(creatingFoodTarget, { foodId: food.id, name: food.name, origin: 'custom', nutritionPer100g: food.nutritionPer100g });
          setCreatingFoodTarget(null);
        }} />
    </Modal>
  </>;
}

function ReviewSection({ draft, currentWeightKg, saveError }: { draft: ProfileDraft; currentWeightKg?: number | null; saveError: string | null }) {
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
  const { resolvedUnits } = useUnits();
  const unit = weightUnit(resolvedUnits);
  const none = t('profile.review.none');
  return (
    <View>
      <Display size={22} style={{ marginBottom: 6 }}>{t('profile.review.title')}</Display>
      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 14, color: theme.colors.textMuted, marginBottom: 18 }}>
        {t('profile.review.subtitle')}
      </Text>

      {currentWeightKg != null ? row(t('profile.questions.targetWeightKg.currentWeight'), `${formatWeightFromKg(currentWeightKg, resolvedUnits)} ${unit}`) : null}
      {row(t('profile.questions.targetWeightKg.label', { unit }), draft.targetWeightKg != null ? `${formatWeightFromKg(draft.targetWeightKg, resolvedUnits)} ${unit}` : none)}
      {draft.nutritionGoalCategory ? row(t('profile.review.goal'), t(`profile.questions.nutritionGoalCategory.options.${draft.nutritionGoalCategory}`)) : null}
      {draft.nonTrainingActivityLevel ? row(t('profile.review.activity'), t(`profile.questions.nonTrainingActivityLevel.options.${draft.nonTrainingActivityLevel}`)) : null}
      {row(t('profile.review.meals'), (draft.mealSlots ?? []).map((slot) => t(`mealSlots.${slot}`)).join(', ') || none)}
      {draft.dietaryPattern ? row(t('profile.review.dietaryPattern'), t(`profile.questions.dietaryPattern.options.${draft.dietaryPattern}`)) : null}
      {row(t('profile.review.preferred'), String((draft.preferredFoodIds ?? []).length || none))}
      {(draft.usualFoodIds ?? []).length > 0 ? row(t('profile.review.usual'), String(draft.usualFoodIds!.length)) : null}
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
