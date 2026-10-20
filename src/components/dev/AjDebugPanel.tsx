import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MissedSessionDecisionModal } from '../schedule/MissedSessionDecisionModal';
import { WorkoutSessionRecoveryModal } from '../workout/WorkoutSessionRecoveryModal';
import { AjCyclePausedMoment } from '../aj/AjCyclePausedMoment';
import { AjBot, type AjBotMood, type AjBotPhase } from '../aj/AjBot';
import { AJ_BOT_LOOK_NEUTRAL, ajBotLookAt } from '../aj/ajBotMotion';
import { useReducedMotionPreference } from '../../lib/reducedMotion';
import { AJ_DEBUG_RESOLVE_MS, AJ_DEBUG_SCENARIOS, type AjDebugScenario } from './ajDebugScenarios';
import type { MissDecision } from '../../scheduleEngine';

/**
 * `__DEV__`-only floating trigger that plays each of the AJ assistant's
 * three moments on demand, so the animations (entrance arc, typed speech,
 * hop, nod into the discard sub-step, exit) can be eyeballed on a real
 * device without waiting for a missed workout, killing the app mid-session,
 * or missing three prescribed days.
 *
 * It previews the REAL components with fabricated props — see
 * `ajDebugScenarios.ts` — so every guard, branch and string you see is the
 * production one. The only thing simulated is the OUTCOME of an answer: the
 * panel holds a local in-flight flag for `AJ_DEBUG_RESOLVE_MS` and then
 * reports success or failure. No decision is resolved, no callable runs,
 * nothing is written, and `console.log` is the full extent of the side
 * effects.
 *
 * Stripped from every release build: `if (!__DEV__) return null` means this
 * never even mounts in production/TestFlight, matching the `__DEV__` guard
 * convention `EvolutionDebugPanel` already established.
 */
export function AjDebugPanel({
  visible,
}: {
  /**
   * Caller-computed visibility — reuses AppShell's `ajMomentsAllowed` gate,
   * so a preview can never be opened on top of a real overlay (a second
   * native `Modal` over the missed-decision or recovery modal is exactly the
   * stuck-overlay bug `AppShell`'s single `startWorkoutFlow` state machine
   * exists to prevent).
   */
  visible: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState<AjDebugScenario | null>(null);
  /** Remount token — replays a scenario (and resets `AjCyclePausedMoment`'s once-per-session ref) from scratch. */
  const [run, setRun] = useState(0);
  const [slowMotion, setSlowMotion] = useState(false);

  const start = (next: AjDebugScenario) => {
    setScenario(next);
    setRun((current) => current + 1);
    setOpen(false);
  };

  if (typeof __DEV__ === 'undefined' || !__DEV__) return null;
  if (!visible) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Abrir laboratório do assistente AJ (somente dev)"
        hitSlop={8}
        style={{
          position: 'absolute',
          right: 16,
          // Clears EvolutionDebugPanel's own trigger at bottom: 110.
          bottom: 164,
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: scenario ? 'rgba(11,112,249,0.92)' : 'rgba(0,0,0,0.55)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.25)',
          zIndex: 65,
          elevation: 12,
        }}
      >
        <Text style={{ fontSize: 20 }}>🤖</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              backgroundColor: '#0a0620',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: '82%',
            }}
          >
            <SafeAreaView edges={['bottom']}>
              <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 }}>
                <Text style={{ fontSize: 11, letterSpacing: 2, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrainsMono_400Regular' }}>
                  SOMENTE DEV · NÃO RESOLVE NADA DE VERDADE
                </Text>
                <Text style={{ fontSize: 18, fontFamily: 'Archivo_700Bold', color: '#fff', marginTop: 4 }}>
                  Assistente AJ
                </Text>
                <Text style={{ fontSize: 12.5, lineHeight: 18, fontFamily: 'Archivo_400Regular', color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>
                  Mostra os componentes reais com dados falsos. Para testar &quot;reduzir movimento&quot;, ligue a
                  opção do sistema (Ajustes › Acessibilidade) — ela é lida do SO, nunca simulada aqui.
                </Text>
              </View>
              <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderRadius: 12,
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.08)',
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontFamily: 'Archivo_600SemiBold', color: '#fff' }}>
                      Câmera lenta (4×)
                    </Text>
                    <Text style={{ fontSize: 11.5, fontFamily: 'Archivo_400Regular', color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                      Só estica a latência simulada, para ver o spinner com calma.
                    </Text>
                  </View>
                  <Switch value={slowMotion} onValueChange={setSlowMotion} />
                </View>

                {AJ_DEBUG_SCENARIOS.map((item) => (
                  <ScenarioRow
                    key={item.id}
                    label={item.label}
                    note={item.note}
                    active={scenario?.id === item.id}
                    onPress={() => start(item)}
                  />
                ))}

                <ScenarioRow
                  label="Fechar o preview aberto"
                  note="Volta para a Home real."
                  active={false}
                  disabled={scenario === null}
                  onPress={() => { setScenario(null); setOpen(false); }}
                />
              </ScrollView>
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </Modal>

      {scenario ? (
        <ScenarioHost
          // A new token fully remounts the preview, so every replay starts
          // from the entrance arc (and the paused moment's once-per-session
          // ref starts fresh).
          key={`${scenario.id}:${run}`}
          scenario={scenario}
          latencyMs={slowMotion ? AJ_DEBUG_RESOLVE_MS * 4 : AJ_DEBUG_RESOLVE_MS}
          onClose={() => setScenario(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Drives one scenario: holds the in-flight/error state a real caller would
 * hold, simulates a resolution after `latencyMs`, then either closes the
 * preview (success) or surfaces the retryable error (failure).
 */
function ScenarioHost({
  scenario,
  latencyMs,
  onClose,
}: {
  scenario: AjDebugScenario;
  latencyMs: number;
  onClose: () => void;
}) {
  const [pending, setPending] = useState<MissDecision | null>(null);
  const [error, setError] = useState(false);
  const [resolved, setResolved] = useState<{ decision: MissDecision; sessionIndex: number } | null>(
    // The "tela de confirmação" scenario opens straight on the second beat.
    scenario.kind === 'missedResolved' ? { decision: 'CONTINUE_SEQUENCE', sessionIndex: 2 } : null,
  );
  const [action, setAction] = useState<'resuming' | 'finishing' | 'discarding' | null>(null);
  const [finishError, setFinishError] = useState(false);
  const [discardError, setDiscardError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const after = (fn: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      fn();
    }, latencyMs);
  };

  if (scenario.kind === 'missed' || scenario.kind === 'missedResolved') {
    // Mirrors AppShell: a successful decision does not close the overlay, it
    // hands the SAME one its committed outcome, so AJ nods and switches from
    // asking to confirming. "Treino C" = index 2 in the prescribed rotation.
    return (
      <MissedSessionDecisionModal
        visible
        pending={pending}
        refreshing={scenario.kind === 'missed' ? scenario.refreshing ?? false : false}
        error={error}
        resolved={resolved}
        onChoose={(decision) => {
          console.log('[AjDebugPanel] onChoose (simulado, nada é resolvido):', decision);
          setError(false);
          setPending(decision);
          after(() => {
            setPending(null);
            if (scenario.kind === 'missed' && scenario.outcome === 'failure') setError(true);
            else setResolved({ decision, sessionIndex: 2 });
          });
        }}
        onStartResolved={() => {
          console.log('[AjDebugPanel] abriria StartWorkoutConfirmation (simulado)');
          onClose();
        }}
        onCancel={() => {
          console.log('[AjDebugPanel] onCancel (volta para idle, miss intacto)');
          onClose();
        }}
      />
    );
  }

  if (scenario.kind === 'recovery') {
    const simulate = (next: 'resuming' | 'finishing' | 'discarding', label: string) => {
      console.log(`[AjDebugPanel] ${label} (simulado, nada é escrito)`);
      setFinishError(false);
      setDiscardError(false);
      setAction(next);
      after(() => {
        setAction(null);
        if (scenario.outcome !== 'failure') {
          onClose();
          return;
        }
        if (next === 'discarding') setDiscardError(true);
        else setFinishError(true);
      });
    };
    return (
      <WorkoutSessionRecoveryModal
        state={scenario.state}
        canResume={scenario.canResume}
        canFinalize={scenario.canFinalize}
        resuming={action === 'resuming'}
        finishing={action === 'finishing'}
        discarding={action === 'discarding'}
        finishError={finishError}
        discardError={discardError}
        onResume={() => simulate('resuming', 'onResume')}
        onFinish={() => simulate('finishing', 'onFinish')}
        onDiscard={() => simulate('discarding', 'onDiscard')}
        onAcknowledgeMissing={() => {
          console.log('[AjDebugPanel] onAcknowledgeMissing (simulado)');
          onClose();
        }}
      />
    );
  }

  if (scenario.kind === 'paused') {
    return (
      <AjCyclePausedMoment
        eligible
        allowed
        onStartWorkout={() => {
          console.log('[AjDebugPanel] chamaria requestStartWorkout() — o mesmo da CTA da Home');
          onClose();
        }}
      />
    );
  }

  return <AjBotLab onClose={onClose} />;
}

const PHASES: AjBotPhase[] = ['enter', 'idle', 'hop', 'nod', 'exit'];
const MOODS: AjBotMood[] = ['idle', 'talk', 'think', 'happy'];

/**
 * The mascot on its own, big, with one control per animation — the fastest
 * way to check a single curve (or the face's `look` offset) without sitting
 * through a whole moment.
 */
function AjBotLab({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<AjBotPhase>('enter');
  const [mood, setMood] = useState<AjBotMood>('idle');
  const [talking, setTalking] = useState(false);
  const [lookIndex, setLookIndex] = useState<number | null>(null);
  /** Replays a one-shot phase even when it is already the current one. */
  const [token, setToken] = useState(0);
  // Same OS preference the real moments read — so "reduzir movimento" can be
  // verified here too, not just inside a full moment.
  const reduceMotion = useReducedMotionPreference();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#05030f' }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <AjBot
              key={`${phase}:${token}`}
              size={200}
              phase={phase}
              mood={mood}
              talking={talking}
              reduceMotion={reduceMotion}
              look={lookIndex === null ? AJ_BOT_LOOK_NEUTRAL : ajBotLookAt(lookIndex, 3)}
            />
            {reduceMotion ? (
              <Text
                style={{
                  marginTop: 18,
                  fontSize: 12,
                  fontFamily: 'JetBrainsMono_400Regular',
                  color: 'rgba(242,192,99,0.9)',
                  textAlign: 'center',
                }}
              >
                REDUZIR MOVIMENTO ESTÁ LIGADO NO SISTEMA
              </Text>
            ) : null}
          </View>
          <ScrollView style={{ maxHeight: '52%' }} contentContainerStyle={{ padding: 20, gap: 8 }}>
            <LabLabel>FASE</LabLabel>
            <LabRow>
              {PHASES.map((item) => (
                <Chip
                  key={item}
                  label={item}
                  active={phase === item}
                  onPress={() => { setPhase(item); setToken((n) => n + 1); }}
                />
              ))}
            </LabRow>

            <LabLabel>HUMOR</LabLabel>
            <LabRow>
              {MOODS.map((item) => (
                <Chip key={item} label={item} active={mood === item} onPress={() => setMood(item)} />
              ))}
            </LabRow>

            <LabLabel>OLHAR (COMO SE O DEDO ESTIVESSE NA RESPOSTA N DE 3)</LabLabel>
            <LabRow>
              <Chip label="neutro" active={lookIndex === null} onPress={() => setLookIndex(null)} />
              {[0, 1, 2].map((index) => (
                <Chip
                  key={index}
                  label={`#${index + 1}`}
                  active={lookIndex === index}
                  onPress={() => setLookIndex(index)}
                />
              ))}
            </LabRow>

            <LabLabel>BOCA</LabLabel>
            <LabRow>
              <Chip label="parada" active={!talking} onPress={() => setTalking(false)} />
              <Chip label="falando (loop)" active={talking} onPress={() => setTalking(true)} />
            </LabRow>

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={{
                marginTop: 14,
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: 'center',
                backgroundColor: 'rgba(255,255,255,0.08)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.14)',
              }}
            >
              <Text style={{ color: '#fff', fontFamily: 'Archivo_600SemiBold', fontSize: 14 }}>Fechar</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function LabLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontSize: 10,
        letterSpacing: 1.5,
        color: 'rgba(255,255,255,0.35)',
        fontFamily: 'JetBrainsMono_400Regular',
        marginTop: 12,
      }}
    >
      {children}
    </Text>
  );
}

function LabRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        backgroundColor: active ? 'rgba(11,112,249,0.22)' : 'rgba(255,255,255,0.05)',
        borderWidth: 1,
        borderColor: active ? '#0b70f9' : 'rgba(255,255,255,0.1)',
      }}
    >
      <Text style={{ color: '#fff', fontFamily: 'Archivo_500Medium', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function ScenarioRow({
  label,
  note,
  active,
  disabled = false,
  onPress,
}: {
  label: string;
  note: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={{
        paddingVertical: 13,
        paddingHorizontal: 16,
        borderRadius: 12,
        marginTop: 8,
        opacity: disabled ? 0.4 : 1,
        backgroundColor: active ? 'rgba(11,112,249,0.16)' : 'rgba(255,255,255,0.04)',
        borderWidth: 1,
        borderColor: active ? 'rgba(77,163,255,0.6)' : 'rgba(255,255,255,0.08)',
      }}
    >
      <Text style={{ fontSize: 14.5, fontFamily: 'Archivo_600SemiBold', color: '#fff' }}>{label}</Text>
      <Text
        style={{
          fontSize: 11.5,
          lineHeight: 16,
          fontFamily: 'Archivo_400Regular',
          color: 'rgba(255,255,255,0.45)',
          marginTop: 3,
        }}
      >
        {note}
      </Text>
    </Pressable>
  );
}
