import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EVOLUTION_DEBUG_PRESETS, type EvolutionDebugPreset } from '../../home/evolutionDebugPresets';

/**
 * `__DEV__`-only floating trigger that previews every Home "evolution" state
 * (HomeEvoTicker/CycleProgressBlock/PendingEvolutionBanner) against mock
 * data from `evolutionDebugPresets.ts`, without needing to fake real
 * Firestore/progression data. Stripped from every release build — the
 * `if (!__DEV__) return null` below means this never even mounts in
 * production/TestFlight, matching the `__DEV__` guard convention already
 * used elsewhere in `AppShell.tsx`.
 *
 * Only overrides the two read-only props Home renders the evolution surface
 * from (`evolutionViewModel`/`streak`) — tapping into a mocked
 * PendingEvolutionBanner still opens the REAL EvolutionUnlockScreen (driven
 * by the real `evolution` hook), so its content can legitimately disagree
 * with the mocked card. That's an accepted limitation of a visual-only tool.
 */
export function EvolutionDebugPanel({
  visible,
  activePresetId,
  onSelect,
  canTriggerCelebration,
  onTriggerCelebration,
  onTriggerRingCelebration,
}: {
  /** Caller-computed visibility (e.g. only on the Home tab) — kept as a prop
   * rather than a conditional mount from the caller so this never
   * reintroduces the bare `{tab === 'x' && <Screen/>}` mount/unmount pattern
   * `appShellNavigationStructure.test.ts` guards against for main tabs. */
  visible: boolean;
  activePresetId: string | null;
  onSelect: (preset: EvolutionDebugPreset | null) => void;
  /** False while there's no real loaded plan to stand in as the celebration/reveal screen's `currentPlan`/`newPlan`. */
  canTriggerCelebration: boolean;
  onTriggerCelebration: (phase: 'celebrating' | 'reveal') => void;
  /** Plays only the Home cycle ring's "100%" celebration (waves/particles/✓) — when it finishes, chains into `onTriggerCelebration('celebrating')` for a full end-to-end preview. */
  onTriggerRingCelebration: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (typeof __DEV__ === 'undefined' || !__DEV__) return null;
  if (!visible) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Abrir presets de teste da evolução (somente dev)"
        hitSlop={8}
        style={{
          position: 'absolute',
          right: 16,
          bottom: 110,
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: activePresetId ? 'rgba(242,192,99,0.92)' : 'rgba(0,0,0,0.55)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.25)',
          zIndex: 65,
          elevation: 12,
        }}
      >
        <Text style={{ fontSize: 20 }}>🧪</Text>
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
              maxHeight: '75%',
            }}
          >
            <SafeAreaView edges={['bottom']}>
              <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 }}>
                <Text style={{ fontSize: 11, letterSpacing: 2, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrainsMono_400Regular' }}>
                  SOMENTE DEV · NÃO AFETA DADOS REAIS
                </Text>
                <Text style={{ fontSize: 18, fontFamily: 'Archivo_700Bold', color: '#fff', marginTop: 4 }}>
                  Presets de evolução
                </Text>
              </View>
              <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                <PresetRow
                  label="Dados reais (sair do preview)"
                  active={activePresetId === null}
                  onPress={() => { onSelect(null); setOpen(false); }}
                />
                {EVOLUTION_DEBUG_PRESETS.map((preset) => (
                  <PresetRow
                    key={preset.id}
                    label={preset.label}
                    active={activePresetId === preset.id}
                    onPress={() => { onSelect(preset); setOpen(false); }}
                  />
                ))}

                <Text style={{ fontSize: 11, letterSpacing: 1.5, color: 'rgba(255,255,255,0.35)', fontFamily: 'JetBrainsMono_400Regular', marginTop: 22, marginBottom: 4 }}>
                  ANIMAÇÃO DO ANEL
                </Text>
                <PresetRow
                  label="Anel atinge 100% (ondas + ✓) → fluxo completo"
                  active={false}
                  onPress={() => { onTriggerRingCelebration(); setOpen(false); }}
                />

                <Text style={{ fontSize: 11, letterSpacing: 1.5, color: 'rgba(255,255,255,0.35)', fontFamily: 'JetBrainsMono_400Regular', marginTop: 22, marginBottom: 4 }}>
                  TELAS DE DESBLOQUEIO (USA SEU TREINO ATUAL)
                </Text>
                <PresetRow
                  label={canTriggerCelebration ? 'Animação de celebração (100%) → revelação' : 'Animação de celebração (carregue um treino primeiro)'}
                  active={false}
                  disabled={!canTriggerCelebration}
                  onPress={() => { onTriggerCelebration('celebrating'); setOpen(false); }}
                />
                <PresetRow
                  label={canTriggerCelebration ? 'Pular direto p/ tela de novo treino' : 'Tela de novo treino (carregue um treino primeiro)'}
                  active={false}
                  disabled={!canTriggerCelebration}
                  onPress={() => { onTriggerCelebration('reveal'); setOpen(false); }}
                />
              </ScrollView>
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function PresetRow({
  label,
  active,
  disabled = false,
  onPress,
}: {
  label: string;
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
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 12,
        marginTop: 8,
        opacity: disabled ? 0.4 : 1,
        backgroundColor: active ? 'rgba(77,163,255,0.16)' : 'rgba(255,255,255,0.04)',
        borderWidth: 1,
        borderColor: active ? 'rgba(77,163,255,0.6)' : 'rgba(255,255,255,0.08)',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text style={{ fontSize: 14.5, fontFamily: 'Archivo_600SemiBold', color: '#fff', flexShrink: 1 }}>
        {label}
      </Text>
      {active && <Text style={{ fontSize: 16, color: '#4da3ff' }}>✓</Text>}
    </Pressable>
  );
}
