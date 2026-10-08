import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { palette } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import type { EvolutionViewModel } from '../../workoutEvolution/types';
import type { PrescriptionDiffSummary } from '../../workoutEvolution/diff';

// Fixed-dark "poster" surface, independent of the app's theme setting —
// see EvoRing.tsx's trackColor comment for the rationale.
const ACCENT_COLOR = palette.blue500;

export function PendingEvolutionBanner({
  viewModel,
  diff,
  onPress,
}: {
  viewModel: Extract<EvolutionViewModel, { kind: 'EVOLUTION_READY' | 'EVOLUTION_DEFERRED' }>;
  /** `null` only acceptable transiently (Task 16 wires this with a placeholder `null` until Task 20 supplies the real value) — a `null` diff silently renders "0 new exercises" for the cycle-evolution title, so don't pass `null` from any new call site without a reason. */
  diff: PrescriptionDiffSummary | null;
  onPress: () => void;
}) {
  const { t } = useTranslation(['home', 'evolution']);
  const { pending, summary } = viewModel;
  const isDeferred = viewModel.kind === 'EVOLUTION_DEFERRED';

  const title = pending.type === 'LEVEL_PROMOTION'
    ? t('home:evoPending.levelTitle', { level: t(`evolution:level.${pending.toLevel}`) })
    : pending.type === 'MOTIVATIONAL_RENEWAL'
      ? t('home:evoPending.renewalTitle')
      : t('home:evoPending.cycleTitle', { count: diff?.exerciseReplacements.length ?? 0, number: summary.cycleNumber + 1 });

  if (isDeferred) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" style={{ marginTop: 14 }}>
        <Text style={{ fontSize: 13, color: ACCENT_COLOR, fontFamily: 'Archivo_600SemiBold' }}>
          {t('home:evoPending.deferredLink')}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{
        width: '100%',
        marginTop: 20,
        padding: 16,
        paddingVertical: 15,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: 'rgba(11,112,249,0.1)',
        borderWidth: 1,
        borderColor: 'rgba(11,112,249,0.45)',
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14.5, fontFamily: 'Archivo_600SemiBold', color: '#fff' }}>{title}</Text>
        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>{t('home:evoPending.subtitle')}</Text>
      </View>
      <Icon name="chevron-right" size={16} color={ACCENT_COLOR} />
    </Pressable>
  );
}
