import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { evaluateProgressionV2ForUserFull } from '../../services/workoutProgressionV2';
import { loadPendingEvolution } from '../../services/workoutLifecycle';
import { previewQaTransition, prepareQaTransitionEvolution, type QaTransitionPreview } from '../../services/workoutLifecycleApplication';
import { resolveWorkoutLifecycleQaMode, type WorkoutLifecycleQaMode } from '../../workoutLifecycle/qaPolicy';
import type { ProgressionDecision } from '../../progressionEngineV2/types';
import type { PendingEvolution } from '../../workoutLifecycle/types';
import type { Timestamp } from 'firebase/firestore';

type Row = { label: string; value: string };

type AcceleratedReadout =
  | { status: 'LOADING' }
  | { status: 'NO_LIFECYCLE' }
  | { status: 'ERROR'; message: string }
  | { status: 'READY'; rows: Row[] };

type TransitionReadout =
  | { status: 'LOADING' }
  | { status: 'NO_LIFECYCLE' }
  | { status: 'ERROR'; message: string }
  | { status: 'READY'; preview: QaTransitionPreview; pending: PendingEvolution<Timestamp> | null };

function formatDecision(decision: ProgressionDecision): string {
  switch (decision.type) {
    case 'NO_ACTION': return `NO_ACTION (${decision.reason})`;
    case 'PROGRESS_CONTINUES': return `PROGRESSING (${decision.reason})`;
    case 'EVOLUTION_ELIGIBLE': return `EVOLUTION_ELIGIBLE — ${decision.quality}`;
    case 'MOTIVATIONAL_RENEWAL_AVAILABLE': return 'MOTIVATIONAL_RENEWAL_AVAILABLE';
    case 'LEVEL_PROMOTION_ELIGIBLE': return `LEVEL_PROMOTION_ELIGIBLE — ${decision.from} → ${decision.to} (${decision.quality})`;
  }
}

const ROW_STYLE = {
  flexDirection: 'row' as const,
  justifyContent: 'space-between' as const,
  paddingVertical: 8,
  borderBottomWidth: 1,
};

/**
 * Dev/QA only, read-only diagnostics + ONE forcing action
 * (`prepareQaTransitionEvolution`), never a Start/Defer/Activate
 * reimplementation — those stay entirely in the real app UI (Home /
 * evolution unlock screen), which already reacts to the real
 * `PendingEvolution` this action creates via the real pipeline. This panel
 * can never grant QA_ACCELERATED or QA_TRANSITION itself (see
 * src/workoutLifecycle/qaPolicy.ts and firestore.rules'
 * `workoutLifecycleQaModeIsAccelerated()`); it only displays/triggers what
 * the backend already authorized for this account.
 * docs/workout-lifecycle/v2/qa/
 */
export function WorkoutLifecycleQaSheet({
  visible,
  uid,
  onDismiss,
}: {
  visible: boolean;
  uid: string;
  onDismiss: () => void;
}) {
  const { theme } = useTheme();
  const [qaMode, setQaMode] = useState<WorkoutLifecycleQaMode | 'LOADING'>('LOADING');
  const [accelerated, setAccelerated] = useState<AcceleratedReadout>({ status: 'LOADING' });
  const [transition, setTransition] = useState<TransitionReadout>({ status: 'LOADING' });
  const [preparing, setPreparing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadTransitionReadout = useCallback(async () => {
    setTransition({ status: 'LOADING' });
    try {
      const [preview, pending] = await Promise.all([previewQaTransition(uid), loadPendingEvolution(uid)]);
      if (!preview) { setTransition({ status: 'NO_LIFECYCLE' }); return; }
      setTransition({ status: 'READY', preview, pending });
    } catch (error) {
      setTransition({ status: 'ERROR', message: error instanceof Error ? error.message : String(error) });
    }
  }, [uid]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setQaMode('LOADING');
    setActionError(null);
    resolveWorkoutLifecycleQaMode(uid).then((mode) => {
      if (cancelled) return;
      setQaMode(mode);
      if (mode === 'QA_ACCELERATED') {
        setAccelerated({ status: 'LOADING' });
        evaluateProgressionV2ForUserFull(uid)
          .then((full) => {
            if (cancelled) return;
            if (!full) { setAccelerated({ status: 'NO_LIFECYCLE' }); return; }
            const { decision, snapshot, expectedSessions, cycleNumber, policyMode } = full;
            setAccelerated({
              status: 'READY',
              rows: [
                { label: 'Backend policy', value: policyMode },
                { label: 'Current level', value: snapshot.level },
                { label: 'Cycle', value: String(cycleNumber) },
                { label: 'Active days', value: String(snapshot.activeTime.activeDays) },
                { label: 'Prescribed opportunities', value: String(expectedSessions) },
                { label: 'Valid sessions', value: String(snapshot.validSessionCount) },
                { label: 'Adherence', value: `${(snapshot.adherence.ratio * 100).toFixed(1)}% (${snapshot.adherence.quality})` },
                { label: 'Earned Intermediate cycles', value: String(snapshot.earnedIntermediateCycleCount) },
                { label: 'Evolution', value: formatDecision(decision) },
              ],
            });
          })
          .catch((error: unknown) => {
            if (!cancelled) setAccelerated({ status: 'ERROR', message: error instanceof Error ? error.message : String(error) });
          });
      } else if (mode === 'QA_TRANSITION') {
        void loadTransitionReadout();
      }
    });
    return () => { cancelled = true; };
  }, [visible, uid, loadTransitionReadout]);

  const handlePrepare = useCallback(async () => {
    setPreparing(true);
    setActionError(null);
    try {
      const result = await prepareQaTransitionEvolution({ uid });
      if (result.status !== 'PREPARED' && result.status !== 'ALREADY_PENDING') {
        setActionError(`Preparação não avançou: ${result.status}${'reasonCodes' in result ? ` (${result.reasonCodes.join(', ')})` : ''}`);
      }
      await loadTransitionReadout();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreparing(false);
    }
  }, [uid, loadTransitionReadout]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable
        onPress={onDismiss}
        style={{ flex: 1, backgroundColor: theme.colors.sheetBackdrop, justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.colors.sheetBackground,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: 1,
            borderColor: theme.colors.sheetBorder,
            paddingBottom: 24,
            maxHeight: '85%',
          }}
        >
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: 18,
              paddingBottom: 14,
              borderBottomWidth: 1,
              borderColor: theme.colors.sheetDivider,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, letterSpacing: 1.8, color: theme.colors.textFaint }}>
              WORKOUT LIFECYCLE
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onDismiss} hitSlop={10}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, letterSpacing: 1.5, color: theme.colors.textFaint }}>
                CLOSE
              </Text>
            </Pressable>
          </View>

          <ScrollView style={{ paddingHorizontal: 22, paddingTop: 14 }}>
            <View style={{ ...ROW_STYLE, borderColor: theme.colors.sheetDivider }}>
              <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>Backend policy</Text>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.textPrimary }}>
                {qaMode === 'LOADING' ? '…' : qaMode}
              </Text>
            </View>

            {/* Exactly one of these three renders — never combined. */}

            {qaMode === 'NORMAL' ? (
              <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint, marginTop: 12 }}>
                NORMAL account — production behavior, no QA controls. Diagnostics only.
              </Text>
            ) : null}

            {qaMode === 'QA_ACCELERATED' ? (
              <>
                {accelerated.status === 'LOADING' ? (
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>Loading…</Text>
                ) : null}
                {accelerated.status === 'NO_LIFECYCLE' ? (
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>
                    This account has no Workout Lifecycle V2 state yet.
                  </Text>
                ) : null}
                {accelerated.status === 'ERROR' ? (
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>{accelerated.message}</Text>
                ) : null}
                {accelerated.status === 'READY'
                  ? accelerated.rows.map((row) => (
                    <View key={row.label} style={{ ...ROW_STYLE, borderColor: theme.colors.sheetDivider }}>
                      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>{row.label}</Text>
                      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.textPrimary }}>{row.value}</Text>
                    </View>
                  ))
                  : null}
              </>
            ) : null}

            {qaMode === 'QA_TRANSITION' ? (
              <>
                {transition.status === 'LOADING' ? (
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>Loading…</Text>
                ) : null}
                {transition.status === 'NO_LIFECYCLE' ? (
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>
                    This account has no Workout Lifecycle V2 state yet.
                  </Text>
                ) : null}
                {transition.status === 'ERROR' ? (
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>{transition.message}</Text>
                ) : null}
                {transition.status === 'READY' ? (
                  <>
                    {[
                      { label: 'Current level', value: transition.preview.currentLevel },
                      { label: 'Current cycle', value: String(transition.preview.currentCycleNumber) },
                      { label: 'Current ProgramInstance', value: transition.preview.currentProgramInstanceId },
                      { label: 'Current content identity', value: transition.preview.currentContentIdentity },
                      {
                        label: 'Expected transition',
                        value: transition.preview.targetType === 'LEVEL_PROMOTION'
                          ? `${transition.preview.currentLevel} → ${transition.preview.targetLevel}`
                          : `${transition.preview.currentLevel} Cycle ${transition.preview.currentCycleNumber} → Cycle ${transition.preview.currentCycleNumber + 1}`,
                      },
                    ].map((row) => (
                      <View key={row.label} style={{ ...ROW_STYLE, borderColor: theme.colors.sheetDivider }}>
                        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>{row.label}</Text>
                        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.textPrimary }}>{row.value}</Text>
                      </View>
                    ))}

                    {transition.pending ? (
                      <View style={{ marginTop: 14 }}>
                        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, letterSpacing: 1.2, color: theme.colors.textFaint }}>
                          PENDING EVOLUTION
                        </Text>
                        {[
                          { label: 'Type', value: transition.pending.type },
                          { label: 'Status', value: transition.pending.status },
                          { label: 'Deferral count', value: String(transition.pending.deferralCount) },
                        ].map((row) => (
                          <View key={row.label} style={{ ...ROW_STYLE, borderColor: theme.colors.sheetDivider }}>
                            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>{row.label}</Text>
                            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.textPrimary }}>{row.value}</Text>
                          </View>
                        ))}
                        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textFaint, marginTop: 8 }}>
                          Feche este painel e use a Home/tela de evolução normal do app para Start, Defer ou aguardar a ativação automática — este painel nunca simula essas ações.
                        </Text>
                        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.danger, marginTop: 8 }}>
                          ⚠ Não altere workoutLifecycleQaMode desta conta pelo Firebase Console enquanto esta Pending Evolution existir — resolva (Activate) ou deixe expirar antes de trocar o modo.
                        </Text>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        disabled={preparing}
                        onPress={() => void handlePrepare()}
                        style={{
                          marginTop: 16,
                          paddingVertical: 12,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: theme.colors.sheetBorder,
                          alignItems: 'center',
                          opacity: preparing ? 0.5 : 1,
                        }}
                      >
                        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, letterSpacing: 1.2, color: theme.colors.textPrimary }}>
                          {preparing ? 'PREPARANDO…' : 'PREPARAR PRÓXIMA EVOLUÇÃO'}
                        </Text>
                      </Pressable>
                    )}
                    {actionError ? (
                      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.danger, marginTop: 8 }}>
                        {actionError}
                      </Text>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
